"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { supplierSchema } from "@/lib/validations";

async function assertUniqueRuc(ruc: string, exceptId?: string) {
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
      description: `${user.name} registró al proveedor ${row.businessName} (RUC ${row.ruc}).`, newData: row,
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
