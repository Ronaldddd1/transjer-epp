"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { provinceClients } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { provinceClientSchema } from "@/lib/validations";

/**
 * El directorio de clientes de provincia.
 *
 * Es una agenda de trabajo: se consulta antes de un viaje y se corrige cuando cambia un
 * teléfono o un precio. Nada de esto afecta a facturas ni a pagos, así que no hay estados
 * ni aprobaciones; lo único que se cuida es que no haya dos fichas del mismo cliente en la
 * misma provincia, porque entonces hay dos teléfonos y nadie sabe cuál vale.
 *
 * No se borra: se da de baja. El cliente al que no se le vende hace un año puede volver, y
 * su teléfono y su precio siguen sirviendo.
 */

async function cargar(id: string) {
  const [row] = await db.select().from(provinceClients).where(eq(provinceClients.id, id)).limit(1);
  if (!row) throw new BusinessError("Ese cliente no existe.");
  return row;
}

/** Que no haya dos fichas del mismo cliente en la misma provincia. */
async function sinRepetir(province: string, clientName: string, excluirId?: string) {
  const [repetido] = await db.select({ id: provinceClients.id })
    .from(provinceClients)
    .where(and(
      sql`upper(${provinceClients.province}) = upper(${province})`,
      sql`upper(${provinceClients.clientName}) = upper(${clientName})`,
      excluirId ? ne(provinceClients.id, excluirId) : undefined,
    ))
    .limit(1);
  if (repetido) {
    throw new BusinessError(`${clientName} ya está registrado en ${province}. Busca su ficha y corrígela ahí.`);
  }
}

export async function createProvinceClient(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("provinceClients.manage");
    const data = provinceClientSchema.parse(formToObject(formData));
    await sinRepetir(data.province, data.clientName);

    const [row] = await db.insert(provinceClients).values({ ...data, createdBy: user.id }).returning();
    await logAudit({
      user, action: "CREAR", module: "CLIENTES_PROVINCIA", recordId: row.id,
      description: `${user.name} registró a ${row.clientName} (${row.province}) en los clientes de provincia.`,
      newData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `${row.clientName} quedó registrado en ${row.province}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProvinceClient(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("provinceClients.manage");
    const data = provinceClientSchema.parse(formToObject(formData));
    const before = await cargar(id);
    await sinRepetir(data.province, data.clientName, id);

    const [row] = await db.update(provinceClients).set(data)
      .where(eq(provinceClients.id, id)).returning();
    await logAudit({
      user, action: "EDITAR", module: "CLIENTES_PROVINCIA", recordId: id,
      description: `${user.name} actualizó la ficha de ${row.clientName} (${row.province}).`,
      oldData: before, newData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Ficha de ${row.clientName} actualizada.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Da de baja o reactiva. No se borra: el cliente al que no se le vende hace un año puede volver. */
export async function toggleProvinceClient(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("provinceClients.manage");
    const before = await cargar(id);
    const activo = !before.active;

    const [row] = await db.update(provinceClients).set({ active: activo })
      .where(eq(provinceClients.id, id)).returning();
    await logAudit({
      user, action: "EDITAR", module: "CLIENTES_PROVINCIA", recordId: id,
      description: `${user.name} ${activo ? "reactivó" : "dio de baja"} a ${row.clientName} (${row.province}).`,
      oldData: { activo: before.active }, newData: { activo: row.active },
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: activo
        ? `${row.clientName} vuelve a figurar en el directorio.`
        : `${row.clientName} quedó dado de baja. Sigue en el historial y se puede reactivar.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
