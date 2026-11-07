"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { supplierSchema } from "@/lib/validations";

async function assertUniqueRuc(ruc: string | null, exceptId?: string) {
  // Sin RUC no hay nada que comprobar: varios proveedores pueden estar pendientes de él.
  if (!ruc) return;
  const conditions = [eq(suppliers.ruc, ruc)];
  if (exceptId) conditions.push(ne(suppliers.id, exceptId));
  const [dup] = await db.select({ id: suppliers.id, name: suppliers.businessName }).from(suppliers).where(and(...conditions));
  if (dup) throw new BusinessError(`El RUC ${ruc} ya está registrado para ${dup.name}.`);
}

export async function createSupplier(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("suppliers.manage");
    const data = supplierSchema.parse(formToObject(formData));
    await assertUniqueRuc(data.ruc);
    const [row] = await db.insert(suppliers).values(data).returning();
    await logAudit({
      user, action: "CREAR", module: "PROVEEDORES", recordId: row.id,
      description: `${user.name} registró al proveedor ${row.businessName}${row.ruc ? ` (RUC ${row.ruc})` : " (sin RUC todavía)"}.`, newData: row,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Proveedor registrado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateSupplier(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("suppliers.manage");
    const data = supplierSchema.parse(formToObject(formData));
    await assertUniqueRuc(data.ruc, id);
    const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!before) throw new BusinessError("El proveedor no existe.");
    const [after] = await db.update(suppliers).set(data).where(eq(suppliers.id, id)).returning();
    await logAudit({
      user, action: "EDITAR", module: "PROVEEDORES", recordId: id,
      description: `${user.name} modificó al proveedor ${before.businessName}.`, oldData: before, newData: after,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Proveedor actualizado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Los proveedores no se borran: se desactivan para conservar el historial de facturas. */
export async function toggleSupplier(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("suppliers.manage");
    const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    if (!before) throw new BusinessError("El proveedor no existe.");

    if (before.active) {
      const [{ pendientes }] = await db
        .select({ pendientes: sql<number>`count(*)::int` })
        .from(supplierInvoices)
        .where(and(eq(supplierInvoices.supplierId, id), eq(supplierInvoices.status, "PENDIENTE")));
      if (pendientes > 0) {
        throw new BusinessError(`${before.businessName} tiene ${pendientes} factura(s) pendiente(s) de pago. Regístralas como pagadas u observadas antes de desactivarlo.`);
      }
    }

    const active = !before.active;
    await db.update(suppliers).set({ active }).where(eq(suppliers.id, id));
    await logAudit({
      user, action: active ? "ACTIVAR" : "DESACTIVAR", module: "PROVEEDORES", recordId: id,
      description: `${user.name} ${active ? "activó" : "desactivó"} al proveedor ${before.businessName}.`,
      oldData: { active: before.active }, newData: { active },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: active ? "Proveedor activado." : "Proveedor desactivado." };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Une dos proveedores que en realidad son uno: pasa todas las facturas del duplicado
 * (`origenId`) al correcto (`destinoId` en el formulario) y borra el duplicado.
 *
 * Pasa sobre todo con lo que vino del Excel, donde el mismo transportista quedó escrito
 * de dos maneras ("Transportes Pérez SAC" y "TRANSPORTES PEREZ S.A.C.") y el sistema los
 * contaba como dos, con sus facturas y su deuda partidas.
 *
 * No se hace si:
 *  - los dos tienen RUC y son distintos: entonces sí son dos proveedores;
 *  - la misma factura (tipo, serie y número) está registrada en los dos: unirlos la
 *    duplicaría; primero hay que anular o corregir la repetida.
 *
 * Al correcto se le completan los datos que le falten y el duplicado sí tenga (RUC,
 * correo, teléfono, contacto). Todo, con el detalle del borrado, queda en auditoría.
 */
export async function mergeSuppliers(origenId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("suppliers.manage");
    const destinoId = String(formData.get("destinoId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(destinoId)) throw new BusinessError("Elige a qué proveedor pasar las facturas.");
    if (destinoId === origenId) throw new BusinessError("Elige otro proveedor: es el mismo.");

    const resultado = await db.transaction(async (tx) => {
      const [origen] = await tx.select().from(suppliers).where(eq(suppliers.id, origenId)).for("update");
      const [destino] = await tx.select().from(suppliers).where(eq(suppliers.id, destinoId)).for("update");
      if (!origen || !destino) throw new BusinessError("Uno de los dos proveedores ya no existe.");

      if (origen.ruc && destino.ruc && origen.ruc !== destino.ruc) {
        throw new BusinessError(
          `${origen.businessName} (RUC ${origen.ruc}) y ${destino.businessName} (RUC ${destino.ruc}) tienen RUC distinto: son dos proveedores.`,
        );
      }

      const choques = await tx.execute<{ doc: string }>(sql`
        select a.series || '-' || a.number as doc
        from supplier_invoices a
        join supplier_invoices b on b.supplier_id = ${destinoId}
          and b.doc_type = a.doc_type and b.series = a.series and b.number = a.number
        where a.supplier_id = ${origenId}
        order by 1 limit 6
      `);
      const repetidas = [...choques].map((c) => c.doc);
      if (repetidas.length > 0) {
        throw new BusinessError(
          `Las dos fichas tienen registrada la misma factura (${repetidas.slice(0, 5).join(", ")}${repetidas.length > 5 ? "…" : ""}). `
          + "Anula o corrige la repetida y vuelve a unirlos.",
        );
      }

      const movidas = await tx.update(supplierInvoices)
        .set({ supplierId: destinoId, updatedAt: new Date() })
        .where(eq(supplierInvoices.supplierId, origenId))
        .returning({ id: supplierInvoices.id });

      // Lo que al correcto le falta y el duplicado sí tiene.
      const completar: Partial<typeof suppliers.$inferInsert> = {};
      if (!destino.ruc && origen.ruc) completar.ruc = origen.ruc;
      if (!destino.email && origen.email) completar.email = origen.email;
      if (!destino.phone && origen.phone) completar.phone = origen.phone;
      if (!destino.contactName && origen.contactName) completar.contactName = origen.contactName;
      if (!destino.tradeName && origen.tradeName) completar.tradeName = origen.tradeName;

      // El RUC es único: se libera del duplicado antes de pasarlo.
      await tx.delete(suppliers).where(eq(suppliers.id, origenId));
      if (Object.keys(completar).length > 0) {
        await tx.update(suppliers).set({ ...completar, updatedAt: new Date() }).where(eq(suppliers.id, destinoId));
      }

      await logAudit({
        user, action: "EDITAR", module: "PROVEEDORES", recordId: destinoId,
        description: `${user.name} unió "${origen.businessName}" con "${destino.businessName}": `
          + `pasaron ${movidas.length} factura(s) y se borró la ficha duplicada`
          + (Object.keys(completar).length ? ` (se le completó: ${Object.keys(completar).join(", ")}).` : "."),
        oldData: { duplicado: origen },
        newData: { proveedor: destinoId, facturas: movidas.map((m) => m.id), completado: completar },
      }, tx);

      return { movidas: movidas.length, origen: origen.businessName, destino: destino.businessName };
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Listo: ${resultado.movidas} factura(s) de "${resultado.origen}" quedaron en "${resultado.destino}".`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
