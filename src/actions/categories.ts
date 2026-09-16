"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { categorySchema } from "@/lib/validations";

async function assertUniqueName(name: string, exceptId?: string) {
  const conditions = [sql`lower(${categories.name}) = lower(${name})`];
  if (exceptId) conditions.push(ne(categories.id, exceptId));
  const [dup] = await db.select({ id: categories.id }).from(categories).where(and(...conditions));
  if (dup) throw new BusinessError(`Ya existe la categoría "${name}".`);
}

export async function createCategory(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("categories.manage");
    const data = categorySchema.parse(formToObject(formData));
    await assertUniqueName(data.name);
    const [cat] = await db.insert(categories).values(data).returning();
    await logAudit({ user, action: "CREAR", module: "CATEGORIAS", recordId: cat.id, description: `${user.name} creó la categoría ${cat.name}.`, newData: cat });
    revalidatePath("/", "layout");
    return { ok: true, message: "Categoría registrada correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateCategory(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("categories.manage");
    const data = categorySchema.parse(formToObject(formData));
    await assertUniqueName(data.name, id);
    const [before] = await db.select().from(categories).where(eq(categories.id, id));
    if (!before) throw new BusinessError("La categoría no existe.");
    const [after] = await db.update(categories).set(data).where(eq(categories.id, id)).returning();
    await logAudit({ user, action: "EDITAR", module: "CATEGORIAS", recordId: id, description: `${user.name} modificó la categoría ${before.name}.`, oldData: before, newData: after });
    revalidatePath("/", "layout");
    return { ok: true, message: "Categoría actualizada correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleCategory(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("categories.manage");
    const [before] = await db.select().from(categories).where(eq(categories.id, id));
    if (!before) throw new BusinessError("La categoría no existe.");
    const active = !before.active;
    await db.update(categories).set({ active }).where(eq(categories.id, id));
    await logAudit({
      user, action: active ? "ACTIVAR" : "DESACTIVAR", module: "CATEGORIAS", recordId: id,
      description: `${user.name} ${active ? "activó" : "desactivó"} la categoría ${before.name}.`,
      oldData: { active: before.active }, newData: { active },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: active ? "Categoría activada." : "Categoría desactivada." };
  } catch (e) {
    return toActionError(e);
  }
}
