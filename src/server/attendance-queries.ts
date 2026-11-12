import "server-only";
import { and, asc, between, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendance, employees, users } from "@/db/schema";
import {
  addDays, first, HORAS_PARA_CORREGIR_ASISTENCIA, monthEnd, monthStart, todayLima, weekdayOf, type SearchParamsRecord,
} from "@/lib/utils";

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
    // Una marca se puede corregir durante un día desde que se guardó por primera vez;
    // después queda cerrada. Se calcula aquí, con el reloj del servidor, y no en el
    // navegador, cuyo reloj puede estar mal puesto.
    bloqueado: sql<boolean>`coalesce(${attendance.createdAt} < now() - make_interval(hours => ${HORAS_PARA_CORREGIR_ASISTENCIA}::int), false)`,
    editableHasta: sql<string | null>`to_char((${attendance.createdAt} + make_interval(hours => ${HORAS_PARA_CORREGIR_ASISTENCIA}::int)) at time zone 'America/Lima', 'DD/MM HH24:MI')`,
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

/** El lunes de la semana de esa fecha. Un domingo pertenece a la semana que termina con él. */
export function lunesDe(ymd: string): string {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7));
}

export type DiaSemana = { status: AttendanceStatus; activity: string | null; reason: string | null };

/**
 * La semana completa, de lunes a domingo, una fila por trabajador.
 *
 * El día suelto dice quién vino hoy y el mes da totales, pero ninguno de los dos deja ver
 * la semana de un vistazo: quién faltó el martes, quién no tiene registro el sábado. Va
 * hasta el domingo porque también se trabaja y se pasa lista ese día.
 */
export async function attendanceWeek(lunes: string, f: { q?: string; area?: string } = {}) {
  const domingo = addDays(lunes, 6);
  const dias = Array.from({ length: 7 }, (_, i) => addDays(lunes, i));

  const trabajadores = await db.select({
    employeeId: employees.id,
    nombre: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
    firstName: employees.firstName,
    lastName: employees.lastName,
    dni: employees.dni,
    area: employees.area,
  })
    .from(employees)
    .where(and(
      eq(employees.active, true),
      f.area ? eq(employees.area, f.area) : undefined,
      f.q
        ? sql`(${employees.firstName} || ' ' || ${employees.lastName} || ' ' || ${employees.dni})
            ilike ${`%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`}`
        : undefined,
    ))
    .orderBy(asc(employees.lastName), asc(employees.firstName));

  const registros = trabajadores.length === 0 ? [] : await db.select({
    employeeId: attendance.employeeId,
    day: attendance.day,
    status: attendance.status,
    activity: attendance.activity,
    reason: attendance.reason,
  })
    .from(attendance)
    .where(between(attendance.day, lunes, domingo));

  const porTrabajador = new Map<string, Record<string, DiaSemana>>();
  for (const r of registros) {
    const fila = porTrabajador.get(r.employeeId) ?? {};
    fila[r.day] = { status: r.status as AttendanceStatus, activity: r.activity, reason: r.reason };
    porTrabajador.set(r.employeeId, fila);
  }

  // Los días con al menos un registro de alguien: en esos, un trabajador sin marca es un
  // olvido al pasar lista; en un día que nadie registró, simplemente no se pasó lista.
  const conLista = new Set(registros.map((r) => r.day));

  return {
    lunes,
    domingo,
    dias,
    conLista,
    filas: trabajadores.map((t) => {
      const semana = porTrabajador.get(t.employeeId) ?? {};
      const valores = Object.values(semana);
      return {
        ...t,
        semana,
        presentes: valores.filter((v) => v.status === "PRESENTE").length,
        faltas: valores.filter((v) => v.status === "FALTA").length,
        justificados: valores.filter((v) => v.status === "JUSTIFICADO").length,
      };
    }),
  };
}
