"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents, employees, vehicles } from "@/db/schema";
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

  return {
    filename: archivo.name || "documento",
    contentType: tipo,
    data: Buffer.from(await archivo.arrayBuffer()),
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

/** Corrige los datos de un documento. El archivo no se reemplaza: se sube otro. */
export async function updateDocument(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = documentSchema.parse(formToObject(formData));
    const [antes] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!antes) throw new BusinessError("Ese documento ya no existe.");

    const [row] = await db.update(documents).set({
      kind: data.kind,
      title: data.title,
      issuedAt: data.issuedAt,
      expiresAt: data.expiresAt,
      notes: data.notes,
      updatedAt: new Date(),
    }).where(eq(documents.id, id)).returning();

    await logAudit({
      user, action: "EDITAR", module: "DOCUMENTOS", recordId: id,
      description: `${user.name} corrigió los datos de "${row.filename}".`,
      oldData: { tipo: antes.kind, vence: antes.expiresAt },
      newData: { tipo: row.kind, vence: row.expiresAt },
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Documento actualizado." };
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
    await removeFile(row).catch(() => {});

    await logAudit({
      user, action: "ELIMINAR", module: "DOCUMENTOS", recordId: id,
      description: `${user.name} eliminó el documento "${row.filename}".`,
      oldData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Documento eliminado." };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------- Vehículos ----------

export async function createVehicle(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("documents.manage");
    const data = vehicleSchema.parse(formToObject(formData));
    const plate = normalizePlate(data.plate);

    const [existe] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(eq(vehicles.plate, plate)).limit(1);
    if (existe) throw new BusinessError(`La placa ${plate} ya está registrada.`);

    const [row] = await db.insert(vehicles).values({
      plate, description: data.description, notes: data.notes,
    }).returning();

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

    const [row] = await db.update(vehicles)
      .set({ plate, description: data.description, notes: data.notes, updatedAt: new Date() })
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
