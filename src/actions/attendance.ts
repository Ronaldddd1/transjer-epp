"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendance, employees } from "@/db/schema";
import { BusinessError, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { formatDate, todayLima } from "@/lib/utils";

/**
 * La asistencia de un día, guardada de una sola vez.
 *
 * Se manda la lista entera y no marca por marca: el encargado pasa lista de corrido, y una
 * petición por trabajador serían veinte peticiones para una tarea de treinta segundos,
 * con el riesgo de que a la quinta se le vaya el internet y quede media lista guardada.
 *
 * Volver a marcar un día ya marcado lo corrige: la fila es una por trabajador y día.
 */

const ESTADOS = ["PRESENTE", "FALTA", "JUSTIFICADO"] as const;
type Estado = (typeof ESTADOS)[number];

export async function saveAttendance(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("attendance.manage");

    const day = String(formData.get("day") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BusinessError("Elige el día de la asistencia.");
    if (day > todayLima()) {
      throw new BusinessError("No se puede pasar lista de un día que todavía no llegó.");
    }

    /**
     * Las marcas vienen como estado_<id> y motivo_<id>. Lo que no trae estado es un
     * trabajador que se dejó sin marcar, y eso NO se guarda: un día sin registrar es un
     * dato que falta, no una falta.
     */
    const marcas: { employeeId: string; status: Estado; reason: string | null }[] = [];
    for (const [clave, valor] of formData.entries()) {
      if (!clave.startsWith("estado_")) continue;
      const employeeId = clave.slice("estado_".length);
      const status = String(valor);
      if (!ESTADOS.includes(status as Estado)) continue;

      const motivo = String(formData.get(`motivo_${employeeId}`) ?? "").trim().slice(0, 160);
      marcas.push({
        employeeId,
        status: status as Estado,
        // El motivo solo significa algo en lo justificado; en lo demás ensucia el historial.
        reason: status === "JUSTIFICADO" ? (motivo || null) : null,
      });
    }

    if (marcas.length === 0) {
      throw new BusinessError("No marcaste a nadie. Marca al menos un trabajador antes de guardar.");
    }

    // Que los ids sean de trabajadores activos de verdad, y no lo que venga en el formulario.
    const ids = marcas.map((m) => m.employeeId);
    const validos = await db.select({ id: employees.id }).from(employees)
      .where(and(inArray(employees.id, ids), eq(employees.active, true)));
    const permitidos = new Set(validos.map((v) => v.id));
    const aGuardar = marcas.filter((m) => permitidos.has(m.employeeId));
    if (aGuardar.length === 0) throw new BusinessError("Ninguno de esos trabajadores está activo.");

    const resumen = { PRESENTE: 0, FALTA: 0, JUSTIFICADO: 0 };
    for (const m of aGuardar) resumen[m.status]++;

    await db.transaction(async (tx) => {
      await tx.insert(attendance).values(
        aGuardar.map((m) => ({
          employeeId: m.employeeId,
          day,
          status: m.status,
          reason: m.reason,
          recordedBy: user.id,
        })),
      ).onConflictDoUpdate({
        target: [attendance.employeeId, attendance.day],
        set: {
          // `excluded` es la fila que chocó: lo que se acaba de marcar pisa lo anterior.
          status: sql`excluded.status`,
          reason: sql`excluded.reason`,
          recordedBy: user.id,
          updatedAt: new Date(),
        },
      });

      await logAudit({
        user, action: "CREAR", module: "ASISTENCIA", recordId: day,
        description: `${user.name} pasó lista del ${formatDate(day)}: `
          + `${resumen.PRESENTE} presente(s), ${resumen.FALTA} falta(s)`
          + `${resumen.JUSTIFICADO > 0 ? `, ${resumen.JUSTIFICADO} justificado(s)` : ""}.`,
        newData: { dia: day, ...resumen, trabajadores: aGuardar.length },
      }, tx);
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Asistencia del ${formatDate(day)} guardada: ${resumen.PRESENTE} presente(s), `
        + `${resumen.FALTA} falta(s)`
        + `${resumen.JUSTIFICADO > 0 ? ` y ${resumen.JUSTIFICADO} justificado(s)` : ""}.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Borra la marca de un trabajador en un día: vuelve a quedar sin registrar. */
export async function clearAttendance(employeeId: string, day: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("attendance.manage");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BusinessError("Día inválido.");

    const [row] = await db.select().from(attendance)
      .where(and(eq(attendance.employeeId, employeeId), eq(attendance.day, day))).limit(1);
    if (!row) throw new BusinessError("Ese día no estaba marcado.");

    await db.delete(attendance)
      .where(and(eq(attendance.employeeId, employeeId), eq(attendance.day, day)));

    await logAudit({
      user, action: "ELIMINAR", module: "ASISTENCIA", recordId: row.id,
      description: `${user.name} borró la asistencia del ${formatDate(day)} de un trabajador.`,
      oldData: row,
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Ese día quedó sin registrar.` };
  } catch (e) {
    return toActionError(e);
  }
}
