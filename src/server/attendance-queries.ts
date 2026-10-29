import "server-only";
import { and, asc, between, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees, users } from "@/db/schema";
import { first, monthEnd, monthStart, todayLima, type SearchParamsRecord } from "@/lib/utils";

/**
 * La asistencia diaria.
 *
 * Solo se guarda si vino o no: ni horas, ni tardanzas, ni turnos. Y los días que nadie
 * registró no existen, que es lo correcto para domingos y feriados: inventarlos como falta
 * sería mentir, y como presencia también.
 */

export type AttendanceStatus = "PRESENTE" | "FALTA" | "JUSTIFICADO";

export type AttendanceFilters = { day?: string; q?: string; area?: string };

export function readAttendanceFilters(sp: SearchParamsRecord): AttendanceFilters {
  const day = first(sp.dia);
  return {
    day: day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayLima(),
    q: first(sp.q)?.trim() || undefined,
    area: first(sp.area) || undefined,
  };
}

/**
 * Los trabajadores de un día, con lo que se les marcó (o nada, si no se les marcó).
 *
 * Devuelve a TODOS los activos, no solo a los que tienen asistencia: la pantalla sirve
 * para marcar, y para marcar hace falta ver a los que todavía no están marcados.
 */
export async function listAttendanceDay(f: AttendanceFilters) {
  const day = f.day ?? todayLima();

  const filas = await db.select({
    employeeId: employees.id,
    firstName: employees.firstName,
    lastName: employees.lastName,
    dni: employees.dni,
    position: employees.position,
    area: employees.area,
    status: attendance.status,
    reason: attendance.reason,
    activity: attendance.activity,
    recordedByName: users.name,
    recordedAt: attendance.updatedAt,
  })
    .from(employees)
    .leftJoin(attendance, and(eq(attendance.employeeId, employees.id), eq(attendance.day, day)))
    .leftJoin(users, eq(attendance.recordedBy, users.id))
    .where(and(
      eq(employees.active, true),
      f.area ? eq(employees.area, f.area) : undefined,
      f.q
        ? sql`(${employees.firstName} || ' ' || ${employees.lastName} || ' ' || ${employees.dni})
            ilike ${`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`
        : undefined,
    ))
    .orderBy(asc(employees.lastName), asc(employees.firstName));

  return filas.map((r) => ({
    ...r,
    nombre: `${r.firstName} ${r.lastName}`.trim(),
    status: (r.status ?? null) as AttendanceStatus | null,
  }));
}

/** Cuántos hay en cada estado ese día, incluyendo los que nadie marcó. */
export async function attendanceCounts(f: AttendanceFilters) {
  const filas = await listAttendanceDay(f);
  return {
    total: filas.length,
    presentes: filas.filter((r) => r.status === "PRESENTE").length,
    faltas: filas.filter((r) => r.status === "FALTA").length,
    justificados: filas.filter((r) => r.status === "JUSTIFICADO").length,
    sinMarcar: filas.filter((r) => r.status === null).length,
  };
}

/**
 * El resumen de un mes: cuántos días vino cada trabajador y cuántos faltó.
 *
 * Los días sin registrar no se cuentan en ningún lado. Por eso se muestra también cuántos
 * días del mes tienen registro: un trabajador con "0 faltas" en un mes donde solo se marcó
 * un día no está diciendo lo mismo que uno con 0 faltas en un mes marcado entero.
 */
export async function attendanceMonth(mes: string, f: { q?: string; area?: string } = {}) {
  const desde = monthStart(mes);
  const hasta = monthEnd(mes);

  const filas = await db.select({
    employeeId: employees.id,
    nombre: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
    dni: employees.dni,
    area: employees.area,
    position: employees.position,
    presentes: sql<number>`count(*) filter (where ${attendance.status} = 'PRESENTE')::int`,
    faltas: sql<number>`count(*) filter (where ${attendance.status} = 'FALTA')::int`,
    justificados: sql<number>`count(*) filter (where ${attendance.status} = 'JUSTIFICADO')::int`,
    registrados: sql<number>`count(${attendance.id})::int`,
  })
    .from(employees)
    .leftJoin(attendance, and(
      eq(attendance.employeeId, employees.id),
      between(attendance.day, desde, hasta),
    ))
    .where(and(
      eq(employees.active, true),
      f.area ? eq(employees.area, f.area) : undefined,
      f.q
        ? sql`(${employees.firstName} || ' ' || ${employees.lastName} || ' ' || ${employees.dni})
            ilike ${`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`
        : undefined,
    ))
    .groupBy(employees.id, employees.firstName, employees.lastName, employees.dni, employees.area, employees.position)
    .orderBy(asc(employees.lastName), asc(employees.firstName));

  // Cuántos días del mes tienen al menos un registro: es el denominador honesto.
  const [dias] = await db.select({ dias: sql<number>`count(distinct ${attendance.day})::int` })
    .from(attendance)
    .where(between(attendance.day, desde, hasta));

  return { filas, diasRegistrados: dias?.dias ?? 0, desde, hasta };
}

/** La asistencia de un trabajador, para su ficha. */
export async function attendanceFor(employeeId: string, limit = 60) {
  return db.select({
    day: attendance.day,
    status: attendance.status,
    reason: attendance.reason,
    activity: attendance.activity,
    recordedByName: users.name,
  })
    .from(attendance)
    .leftJoin(users, eq(attendance.recordedBy, users.id))
    .where(eq(attendance.employeeId, employeeId))
    .orderBy(sql`${attendance.day} desc`)
    .limit(limit);
}

/** Las áreas que existen, para el filtro. */
export async function areaOptions() {
  const filas = await db.select({ area: employees.area, cuantos: count() })
    .from(employees).where(eq(employees.active, true))
    .groupBy(employees.area).orderBy(asc(employees.area));
  return filas.map((f) => f.area);
}
