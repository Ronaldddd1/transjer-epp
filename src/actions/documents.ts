"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents, employees, vehicles } from "@/db/schema";
import { revisarArchivo } from "@/server/archivo-legible";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { DOCUMENT_KIND_LABEL, formatDate, normalizePlate } from "@/lib/utils";
import { documentSchema, vehicleSchema } from "@/lib/validations";
import { maxBytesFor, putFile, removeFile, safeName } from "@/server/storage";

/**
 * Documentos de trabajadores y vehículos.
 *
 * El archivo se guarda con el mismo almacén que los adjuntos de las facturas, así que no
 * hay dos maneras distintas de guardar un PDF en el sistema: lo que esté configurado para
 * uno sirve para el otro.
 */

const TIPOS_PERMITIDOS = [
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic",
];

/** Lee el archivo del formulario y comprueba que se pueda guardar. */
async function leerArchivo(formData: FormData) {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    throw new BusinessError("Adjunta el archivo del documento.");
  }

  const limite = maxBytesFor();
  if (archivo.size > limite) {
    const mb = Math.floor(limite / 1024 / 1024);
    throw new BusinessError(
      `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${mb} MB.`
      + " Escanéalo en menor calidad o súbelo como PDF.",
    );
  }

  const tipo = archivo.type || "application/octet-stream";
  // Se admite PDF y fotos: es lo que sale de un escáner o de la cámara del celular, que es
  // como llegan estos papeles en la práctica.
  if (!TIPOS_PERMITIDOS.includes(tipo)) {
    throw new BusinessError("Solo se aceptan archivos PDF o imágenes (JPG, PNG).");
  }

  const data = Buffer.from(await archivo.arrayBuffer());

  /**
   * Antes de guardarlo, que se pueda ver.
   *
   * Un PDF cortado, una foto de 300 píxeles o un archivo con otra cosa adentro se
   * guardan igual de bien y el problema aparece meses después, cuando alguien necesita
   * mostrar el documento y ya no hay a quién pedírselo de nuevo.
   */
  const revision = revisarArchivo(data, tipo, archivo.name || "el archivo");
  if (!revision.ok) throw new BusinessError(revision.motivo);

  return {
    filename: archivo.name || "documento",
    contentType: tipo,
    data,
  };
}

/** A quién pertenece el documento, comprobando que exista. */
async function duenio(data: { employeeId: string | null; vehicleId: string | null }) {
  if (data.vehicleId) {
    const [v] = await db.select({ id: vehicles.id, plate: vehicles.plate })
      .from(vehicles).where(eq(vehicles.id, data.vehicleId)).limit(1);
    if (!v) throw new BusinessError("Ese vehículo ya no existe.");
    return { tipo: "vehículo" as const, etiqueta: v.plate, employeeId: null, vehicleId: v.id };
  }
  if (data.employeeId) {
    const [e] = await db.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees).where(eq(employees.id, data.employeeId)).limit(1);
    if (!e) throw new BusinessError("Ese trabajador ya no existe.");
    return {
      tipo: "trabajador" as const,
      etiqueta: `${e.firstName} ${e.lastName}`.trim(),
      employeeId: e.id,
      vehicleId: null,
    };
  }
  throw new BusinessError("Indica de qué trabajador o de qué vehículo es el documento.");
}

export async function createDocument(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = documentSchema.parse(formToObject(formData));
    const quien = await duenio(data);
    const archivo = await leerArchivo(formData);

    const key = `documentos/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName(archivo.filename)}`;
    const guardado = await putFile({ key, data: archivo.data, contentType: archivo.contentType });

    await db.transaction(async (tx) => {
      const [row] = await tx.insert(documents).values({
        employeeId: quien.employeeId,
        vehicleId: quien.vehicleId,
        kind: data.kind,
        title: data.title,
        issuedAt: data.issuedAt,
        expiresAt: data.expiresAt,
        notes: data.notes,
        filename: archivo.filename.slice(0, 250),
        contentType: archivo.contentType.slice(0, 120),
        sizeBytes: archivo.data.byteLength,
        storageDriver: guardado.storageDriver,
        storageKey: guardado.storageKey,
        content: guardado.content,
        uploadedBy: user.id,
      }).returning();

      await logAudit({
        user, action: "CREAR", module: "DOCUMENTOS", recordId: row.id,
        description: `${user.name} subió ${DOCUMENT_KIND_LABEL[data.kind] ?? data.kind} de ${quien.tipo} ${quien.etiqueta}`
          + (data.expiresAt ? `, vence el ${formatDate(data.expiresAt)}.` : "."),
        newData: { tipo: data.kind, archivo: row.filename, vence: data.expiresAt },
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: data.expiresAt
        ? `Documento guardado. Vence el ${formatDate(data.expiresAt)}.`
        : "Documento guardado. No tiene fecha de vencimiento, así que no se avisará de nada.",
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Corrige los datos de un documento y, si hace falta, le adjunta el archivo.
 *
 * El archivo es opcional porque hay documentos cargados solo con su fecha —los que salen
 * del Excel de mantenimiento— y el PDF llega después. Sin esto habría que subirlo como un
 * documento nuevo y la unidad quedaría con dos SOAT: uno con la fecha y otro con el papel,
 * y nadie sabría cuál es el bueno.
 */
export async function updateDocument(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = documentSchema.parse(formToObject(formData));
    const [antes] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!antes) throw new BusinessError("Ese documento ya no existe.");

    const subido = formData.get("archivo");
    const hayArchivoNuevo = subido instanceof File && subido.size > 0;
    const archivo = hayArchivoNuevo ? await leerArchivo(formData) : null;

    let guardado: Awaited<ReturnType<typeof putFile>> | null = null;
    if (archivo) {
      const key = `documentos/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName(archivo.filename)}`;
      guardado = await putFile({ key, data: archivo.data, contentType: archivo.contentType });
    }

    const [row] = await db.update(documents).set({
      kind: data.kind,
      title: data.title,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      notes: data.notes,
      ...(archivo && guardado ? {
        filename: archivo.filename.slice(0, 250),
        contentType: archivo.contentType.slice(0, 120),
        sizeBytes: archivo.data.byteLength,
        storageDriver: guardado.storageDriver,
        storageKey: guardado.storageKey,
        content: guardado.content,
        uploadedBy: user.id,
      } : {}),
      updatedAt: new Date(),
    }).where(eq(documents.id, id)).returning();

    // El archivo viejo se borra solo después de que el nuevo quedó guardado y la fila
    // apunta a él: al revés, un fallo dejaría el documento sin nada que descargar.
    if (archivo && antes.storageDriver) {
      await removeFile({ ...antes, storageDriver: antes.storageDriver }).catch(() => {});
    }

    await logAudit({
      user, action: "EDITAR", module: "DOCUMENTOS", recordId: id,
      description: archivo
        ? `${user.name} ${antes.filename ? "reemplazó el archivo de" : "adjuntó el archivo a"} `
          + `${DOCUMENT_KIND_LABEL[row.kind] ?? row.kind}: "${archivo.filename}".`
        : `${user.name} corrigió los datos de "${row.filename ?? DOCUMENT_KIND_LABEL[row.kind] ?? row.kind}".`,
      oldData: { tipo: antes.kind, vence: antes.expiresAt, archivo: antes.filename },
      newData: { tipo: row.kind, vence: row.expiresAt, archivo: row.filename },
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: archivo
        ? (antes.filename ? "Documento actualizado y archivo reemplazado." : "Documento actualizado y archivo adjuntado.")
        : "Documento actualizado.",
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row) throw new BusinessError("Ese documento ya no existe.");

    await db.delete(documents).where(eq(documents.id, id));
    // El archivo se borra después de la fila: si falla el borrado del archivo queda uno
    // huérfano en el almacén, que es molesto pero inofensivo. Al revés quedaría una fila
    // apuntando a un archivo que ya no está, y eso sí rompe la descarga.
    // Un documento puede no tener archivo (solo la fecha de vencimiento): ahí no hay
    // nada que borrar del almacén.
    if (row.storageDriver) await removeFile({ ...row, storageDriver: row.storageDriver }).catch(() => {});

    await logAudit({
      user, action: "ELIMINAR", module: "DOCUMENTOS", recordId: id,
      description: `${user.name} eliminó el documento "${row.filename ?? row.title ?? row.kind}".`,
      oldData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Documento eliminado." };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------- Vehículos ----------

/**
 * Comprueba que el conductor exista y pueda tenerlo asignado.
 *
 * Un trabajador cesado no debería quedar como conductor de una unidad: el día que la paren
 * en la carretera, la licencia que figura en el sistema es de alguien que ya no trabaja.
 */
async function conductor(driverId: string | null) {
  if (!driverId) return null;
  const [e] = await db.select({ id: employees.id, active: employees.active })
    .from(employees).where(eq(employees.id, driverId)).limit(1);
  if (!e) throw new BusinessError("Ese trabajador ya no existe.");
  if (!e.active) throw new BusinessError("Ese trabajador está cesado: no se le puede asignar una unidad.");
  return e.id;
}

/** Los campos de la ficha del vehículo, iguales al crear y al editar. */
function datosVehiculo(data: ReturnType<typeof vehicleSchema.parse>, plate: string, driverId: string | null) {
  return {
    plate,
    description: data.description,
    brand: data.brand,
    model: data.model,
    year: data.year,
    capacityTn: data.capacityTn,
    capacityM3: data.capacityM3,
    mtcCode: data.mtcCode,
    hasGps: data.hasGps,
    driverId,
    notes: data.notes,
  };
}

export async function createVehicle(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = vehicleSchema.parse(formToObject(formData));
    const plate = normalizePlate(data.plate);

    const [existe] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(eq(vehicles.plate, plate)).limit(1);
    if (existe) throw new BusinessError(`La placa ${plate} ya está registrada.`);

    const driverId = await conductor(data.driverId);
    const [row] = await db.insert(vehicles)
      .values(datosVehiculo(data, plate, driverId)).returning();

    await logAudit({
      user, action: "CREAR", module: "DOCUMENTOS", recordId: row.id,
      description: `${user.name} registró el vehículo ${plate}.`,
      newData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Vehículo ${plate} registrado.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateVehicle(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = vehicleSchema.parse(formToObject(formData));
    const plate = normalizePlate(data.plate);

    const [otro] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(eq(vehicles.plate, plate)).limit(1);
    if (otro && otro.id !== id) throw new BusinessError(`La placa ${plate} ya está en otro vehículo.`);

    const driverId = await conductor(data.driverId);
    const [row] = await db.update(vehicles)
      .set({ ...datosVehiculo(data, plate, driverId), updatedAt: new Date() })
      .where(eq(vehicles.id, id)).returning();
    if (!row) throw new BusinessError("Ese vehículo ya no existe.");

    await logAudit({
      user, action: "EDITAR", module: "DOCUMENTOS", recordId: id,
      description: `${user.name} modificó el vehículo ${plate}.`,
      newData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Vehículo actualizado." };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Da de baja un vehículo sin borrarlo.
 *
 * No se elimina porque sus documentos son el respaldo de lo que circuló: una unidad
 * vendida sigue necesitando que se pueda mostrar su SOAT de cuando estaba en la flota.
 */
export async function toggleVehicle(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const [antes] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    if (!antes) throw new BusinessError("Ese vehículo ya no existe.");

    const [row] = await db.update(vehicles)
      .set({ active: !antes.active, updatedAt: new Date() })
      .where(eq(vehicles.id, id)).returning();

    await logAudit({
      user, action: row.active ? "ACTIVAR" : "DESACTIVAR", module: "DOCUMENTOS", recordId: id,
      description: `${user.name} ${row.active ? "reactivó" : "dio de baja"} el vehículo ${row.plate}.`,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: row.active ? `${row.plate} vuelve a estar activo.` : `${row.plate} quedó dado de baja. Sus documentos se conservan.` };
  } catch (e) {
    return toActionError(e);
  }
}
