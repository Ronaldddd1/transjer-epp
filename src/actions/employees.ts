"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { employeeSchema } from "@/lib/validations";

export async function createEmployee(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("employees.manage");
    const data = employeeSchema.parse(formToObject(formData));
    const [dup] = await db.select({ id: employees.id }).from(employees).where(eq(employees.dni, data.dni));
    if (dup) throw new BusinessError(`Ya existe un trabajador con DNI ${data.dni}.`);
    const [emp] = await db.insert(employees).values(data).returning();
    await logAudit({ user, action: "CREAR", module: "TRABAJADORES", recordId: emp.id, description: `${user.name} registró al trabajador ${emp.firstName} ${emp.lastName} (DNI ${emp.dni}).`, newData: emp });
    revalidatePath("/", "layout");
    return { ok: true, message: "Trabajador registrado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateEmployee(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("employees.manage");
    const data = employeeSchema.parse(formToObject(formData));
    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    if (!before) throw new BusinessError("El trabajador no existe.");
    if (data.dni !== before.dni) {
      const [dup] = await db.select({ id: employees.id }).from(employees).where(eq(employees.dni, data.dni));
      if (dup) throw new BusinessError(`Ya existe un trabajador con DNI ${data.dni}.`);
    }
    const [after] = await db.update(employees).set(data).where(eq(employees.id, id)).returning();
    await logAudit({ user, action: "EDITAR", module: "TRABAJADORES", recordId: id, description: `${user.name} modificó al trabajador ${before.firstName} ${before.lastName}.`, oldData: before, newData: after });
    revalidatePath("/", "layout");
    return { ok: true, message: "Trabajador actualizado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Los trabajadores no se eliminan: se desactivan para conservar su historial de entregas. */
export async function toggleEmployee(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("employees.manage");
    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    if (!before) throw new BusinessError("El trabajador no existe.");
    const active = !before.active;
    await db.update(employees).set({ active }).where(eq(employees.id, id));
    await logAudit({
      user, action: active ? "ACTIVAR" : "DESACTIVAR", module: "TRABAJADORES", recordId: id,
      description: `${user.name} ${active ? "activó" : "desactivó"} al trabajador ${before.firstName} ${before.lastName}.`,
      oldData: { active: before.active }, newData: { active },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: active ? "Trabajador activado." : "Trabajador desactivado." };
  } catch (e) {
    return toActionError(e);
  }
}
