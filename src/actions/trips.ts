"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employees, vehicles, vehicleTrips } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { esAlicorp, formatDate, todayLima, TRIP_DOC_LABEL } from "@/lib/utils";
import { tripSchema, type TripInput } from "@/lib/validations";

/**
 * Las salidas diarias de la flota y la liquidación de su documento.
 *
 * Una salida se registra el día que sale la unidad, con el número del documento que la
 * respalda. Mientras está PENDIENTE se puede corregir o borrar; una vez LIQUIDADA queda
 * fija, porque ya se cobró con ese número: para tocarla hay que deshacer la liquidación,
 * y eso queda en auditoría.
 */

/** El tipo de documento: en Alicorp es FO siempre; en los demás, el elegido (o Guía). */
const tipoDe = (data: TripInput) => (esAlicorp(data.client) ? "FO" : data.docType ?? "GUIA");

const etiqueta = (t: { docType: string; docNumber: string; client: string }) =>
  `${TRIP_DOC_LABEL[t.docType] ?? t.docType} ${t.docNumber} de ${t.client}`;

/** Que la unidad exista y que el conductor, si viene, sea un trabajador activo. */
async function validarReferencias(data: TripInput) {
  const [unidad] = await db.select({ id: vehicles.id, plate: vehicles.plate }).from(vehicles)
    .where(eq(vehicles.id, data.vehicleId)).limit(1);
  if (!unidad) throw new BusinessError("Esa unidad no existe.");
  if (data.driverId) {
    const [chofer] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.id, data.driverId), eq(employees.active, true))).limit(1);
    if (!chofer) throw new BusinessError("Ese conductor no está activo.");
  }
  if (data.day > todayLima()) throw new BusinessError("No se puede registrar una salida de un día que todavía no llegó.");
  return unidad;
}

/** El mismo documento ya registrado para ese cliente, si lo hay. */
async function documentoRepetido(cliente: string, tipo: string, numero: string, sinId?: string) {
  const [otro] = await db.select({ id: vehicleTrips.id, day: vehicleTrips.day }).from(vehicleTrips)
    .where(and(
      sql`lower(btrim(${vehicleTrips.client})) = lower(btrim(${cliente}))`,
      eq(vehicleTrips.docType, tipo),
      sql`upper(btrim(${vehicleTrips.docNumber})) = upper(btrim(${numero}))`,
      sinId ? sql`${vehicleTrips.id} <> ${sinId}` : undefined,
    )).limit(1);
  return otro ?? null;
}

export async function createTrip(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const data = tripSchema.parse(formToObject(formData));
    const unidad = await validarReferencias(data);
    const docType = tipoDe(data);

    const repetido = await documentoRepetido(data.client, docType, data.docNumber);
    if (repetido) {
      throw new BusinessError(
        `El ${TRIP_DOC_LABEL[docType]} ${data.docNumber} de ${data.client} ya está registrado, en la salida del ${formatDate(repetido.day)}.`,
      );
    }

    const [row] = await db.insert(vehicleTrips).values({
      day: data.day,
      vehicleId: data.vehicleId,
      driverId: data.driverId,
      client: data.client.replace(/\s+/g, " ").trim(),
      destination: data.destination,
      docType,
      docNumber: data.docNumber,
      notes: data.notes,
      createdBy: user.id,
    }).returning();

    await logAudit({
      user, action: "CREAR", module: "SALIDAS", recordId: row.id,
      description: `${user.name} registró la salida de ${unidad.plate} del ${formatDate(row.day)}: ${etiqueta(row)}.`,
      newData: row,
    });

    revalidatePath("/salidas");
    return { ok: true, message: `Salida de ${unidad.plate} registrada con ${TRIP_DOC_LABEL[docType]} ${row.docNumber}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateTrip(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const data = tripSchema.parse(formToObject(formData));
    const [antes] = await db.select().from(vehicleTrips).where(eq(vehicleTrips.id, id)).limit(1);
    if (!antes) throw new BusinessError("Esa salida ya no existe.");
    if (antes.status === "LIQUIDADO") {
      throw new BusinessError("Esa salida ya está liquidada. Para corregirla, primero deshaz la liquidación.");
    }
    await validarReferencias(data);
    const docType = tipoDe(data);
    const repetido = await documentoRepetido(data.client, docType, data.docNumber, id);
    if (repetido) {
      throw new BusinessError(`El ${TRIP_DOC_LABEL[docType]} ${data.docNumber} de ${data.client} ya está en otra salida, del ${formatDate(repetido.day)}.`);
    }

    const [row] = await db.update(vehicleTrips).set({
      day: data.day,
      vehicleId: data.vehicleId,
      driverId: data.driverId,
      client: data.client.replace(/\s+/g, " ").trim(),
      destination: data.destination,
      docType,
      docNumber: data.docNumber,
      notes: data.notes,
      updatedAt: new Date(),
    }).where(eq(vehicleTrips.id, id)).returning();

    await logAudit({
      user, action: "EDITAR", module: "SALIDAS", recordId: id,
      description: `${user.name} corrigió la salida del ${formatDate(row.day)}: ${etiqueta(row)}.`,
      oldData: antes, newData: row,
    });

    revalidatePath("/salidas");
    return { ok: true, message: "Salida corregida." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteTrip(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const [antes] = await db.select().from(vehicleTrips).where(eq(vehicleTrips.id, id)).limit(1);
    if (!antes) throw new BusinessError("Esa salida ya no existe.");
    if (antes.status === "LIQUIDADO") {
      throw new BusinessError("Una salida liquidada no se borra. Si fue un error, primero deshaz la liquidación.");
    }
    await db.delete(vehicleTrips).where(eq(vehicleTrips.id, id));
    await logAudit({
      user, action: "ELIMINAR", module: "SALIDAS", recordId: id,
      description: `${user.name} eliminó la salida del ${formatDate(antes.day)}: ${etiqueta(antes)}.`,
      oldData: antes,
    });
    revalidatePath("/salidas");
    return { ok: true, message: "Salida eliminada." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Marca el documento como liquidado en la fecha indicada (hoy, si no se indica). */
export async function settleTrip(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const fecha = String(formData.get("settledAt") ?? "").trim() || todayLima();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new BusinessError("Fecha de liquidación inválida.");
    if (fecha > todayLima()) throw new BusinessError("La fecha de liquidación no puede ser futura.");

    const [antes] = await db.select().from(vehicleTrips).where(eq(vehicleTrips.id, id)).limit(1);
    if (!antes) throw new BusinessError("Esa salida ya no existe.");
    if (antes.status === "LIQUIDADO") throw new BusinessError("Ese documento ya estaba liquidado.");
    if (fecha < antes.day) throw new BusinessError("No se puede liquidar antes del día de la salida.");

    const [row] = await db.update(vehicleTrips)
      .set({ status: "LIQUIDADO", settledAt: fecha, settledBy: user.id, updatedAt: new Date() })
      .where(and(eq(vehicleTrips.id, id), eq(vehicleTrips.status, "PENDIENTE")))
      .returning();
    if (!row) throw new BusinessError("Ese documento ya estaba liquidado.");

    await logAudit({
      user, action: "EDITAR", module: "SALIDAS", recordId: id,
      description: `${user.name} liquidó el ${etiqueta(row)} el ${formatDate(fecha)}.`,
      oldData: { status: antes.status }, newData: { status: row.status, settledAt: row.settledAt },
    });
    revalidatePath("/salidas");
    return { ok: true, message: `${TRIP_DOC_LABEL[row.docType]} ${row.docNumber} liquidado.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Vuelve a dejar pendiente un documento liquidado por error. */
export async function unsettleTrip(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const [antes] = await db.select().from(vehicleTrips).where(eq(vehicleTrips.id, id)).limit(1);
    if (!antes) throw new BusinessError("Esa salida ya no existe.");
    if (antes.status !== "LIQUIDADO") throw new BusinessError("Ese documento no estaba liquidado.");
    await db.update(vehicleTrips)
      .set({ status: "PENDIENTE", settledAt: null, settledBy: null, updatedAt: new Date() })
      .where(eq(vehicleTrips.id, id));
    await logAudit({
      user, action: "EDITAR", module: "SALIDAS", recordId: id,
      description: `${user.name} deshizo la liquidación del ${etiqueta(antes)} (estaba liquidado el ${formatDate(antes.settledAt!)}).`,
      oldData: { status: antes.status, settledAt: antes.settledAt }, newData: { status: "PENDIENTE" },
    });
    revalidatePath("/salidas");
    return { ok: true, message: "La liquidación se deshizo: vuelve a estar pendiente." };
  } catch (e) {
    return toActionError(e);
  }
}
