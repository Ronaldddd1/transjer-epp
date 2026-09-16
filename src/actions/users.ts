"use server";

import bcrypt from "bcryptjs";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { auditLogs, eppDeliveries, inventoryMovements, users } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { passwordSchema, userBaseSchema, userCreateSchema } from "@/lib/validations";

const publicFields = { id: users.id, name: users.name, username: users.username, email: users.email, role: users.role, active: users.active };

async function assertUnique(username: string, email: string, exceptId?: string) {
  const match = or(eq(users.username, username), eq(users.email, email));
  const [dup] = await db.select({ username: users.username, email: users.email }).from(users)
    .where(exceptId ? and(match, ne(users.id, exceptId)) : match);
  if (dup) throw new BusinessError(dup.username === username ? "Ese nombre de usuario ya está en uso." : "Ese correo ya está registrado.");
}

/** Impide dejar el sistema sin ningún administrador activo. */
async function assertAnotherActiveAdmin(exceptId: string) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.role, "ADMIN"), eq(users.active, true), ne(users.id, exceptId)));
  if ((row?.n ?? 0) === 0) throw new BusinessError("Debe quedar al menos un administrador activo.");
}

export async function createUser(formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActionUser("users.manage");
    const { password, ...data } = userCreateSchema.parse(formToObject(formData));
    await assertUnique(data.username, data.email);
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db.insert(users).values({ ...data, passwordHash }).returning(publicFields);
    await logAudit({ user: actor, action: "CREAR", module: "USUARIOS", recordId: user.id, description: `${actor.name} creó el usuario ${user.username}.`, newData: user });
    revalidatePath("/usuarios");
    return { ok: true, message: "Usuario creado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateUser(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActionUser("users.manage");
    const data = userBaseSchema.parse(formToObject(formData));
    const [before] = await db.select(publicFields).from(users).where(eq(users.id, id));
    if (!before) throw new BusinessError("El usuario no existe.");
    await assertUnique(data.username, data.email, id);
    if (before.role === "ADMIN" && data.role !== "ADMIN") await assertAnotherActiveAdmin(id);
    const [after] = await db.update(users).set(data).where(eq(users.id, id)).returning(publicFields);
    await logAudit({ user: actor, action: "EDITAR", module: "USUARIOS", recordId: id, description: `${actor.name} modificó el usuario ${before.username}.`, oldData: before, newData: after });
    revalidatePath("/", "layout");
    return { ok: true, message: "Usuario actualizado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function toggleUser(id: string): Promise<ActionResult> {
  try {
    const actor = await requireActionUser("users.manage");
    if (id === actor.id) throw new BusinessError("No puedes desactivar tu propio usuario.");
    const [before] = await db.select(publicFields).from(users).where(eq(users.id, id));
    if (!before) throw new BusinessError("El usuario no existe.");
    const active = !before.active;
    if (!active && before.role === "ADMIN") await assertAnotherActiveAdmin(id);
    await db.update(users).set({ active }).where(eq(users.id, id));
    await logAudit({
      user: actor, action: active ? "ACTIVAR" : "DESACTIVAR", module: "USUARIOS", recordId: id,
      description: `${actor.name} ${active ? "activó" : "desactivó"} el usuario ${before.username}.`,
      oldData: { active: before.active }, newData: { active },
    });
    revalidatePath("/usuarios");
    return { ok: true, message: active ? "Usuario activado." : "Usuario desactivado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function changeUserPassword(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const actor = await requireActionUser("users.manage");
    const { password } = passwordSchema.parse(formToObject(formData));
    const [target] = await db.select(publicFields).from(users).where(eq(users.id, id));
    if (!target) throw new BusinessError("El usuario no existe.");
    await db.update(users).set({ passwordHash: await bcrypt.hash(password, 12) }).where(eq(users.id, id));
    await logAudit({ user: actor, action: "CONTRASEÑA", module: "USUARIOS", recordId: id, description: `${actor.name} cambió la contraseña de ${target.username}.` });
    return { ok: true, message: "Contraseña actualizada correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Solo se eliminan usuarios sin operaciones registradas; si tienen historial se deben desactivar. */
export async function deleteUser(id: string): Promise<ActionResult> {
  try {
    const actor = await requireActionUser("users.manage");
    if (id === actor.id) throw new BusinessError("No puedes eliminar tu propio usuario.");
    const [target] = await db.select(publicFields).from(users).where(eq(users.id, id));
    if (!target) throw new BusinessError("El usuario no existe.");
    if (target.role === "ADMIN" && target.active) await assertAnotherActiveAdmin(id);

    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements).where(eq(inventoryMovements.userId, id));
    const [d] = await db.select({ n: sql<number>`count(*)::int` }).from(eppDeliveries).where(eq(eppDeliveries.userId, id));
    if ((m?.n ?? 0) + (d?.n ?? 0) > 0) {
      throw new BusinessError("Este usuario tiene movimientos registrados. Desactívalo para conservar el historial.");
    }

    await db.transaction(async (tx) => {
      await tx.update(auditLogs).set({ userId: null }).where(eq(auditLogs.userId, id));
      await tx.delete(users).where(eq(users.id, id));
      await logAudit({ user: actor, action: "ELIMINAR", module: "USUARIOS", recordId: id, description: `${actor.name} eliminó el usuario ${target.username}.`, oldData: target }, tx);
    });
    revalidatePath("/usuarios");
    return { ok: true, message: "Usuario eliminado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}
