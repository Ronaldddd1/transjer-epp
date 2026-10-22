/**
 * Asistencia diaria.
 *
 * El número que esta pantalla tiene que dar bien es uno solo: cuántas faltas lleva alguien.
 * Y el error que lo arruinaría es confundir "no vino" con "nadie pasó lista ese día". Un
 * domingo sin registrar no es una falta, y contarlo como tal convertiría a toda la empresa
 * en faltona.
 *
 *   npx tsx --conditions=react-server tests/asistencia.test.ts
 */
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { attendance, employees } from "../src/db/schema";
import { addDays, todayLima } from "../src/lib/utils";
import {
  attendanceCounts, attendanceFor, attendanceMonth, listAttendanceDay,
} from "../src/server/attendance-queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const HOY = todayLima();
const AREA = `Prueba ${SELLO}`;

async function main() {
  const creados: string[] = [];
  try {
    // Tres trabajadores en un área propia, para no mezclarse con los datos de verdad.
    const nombres = ["Ana", "Beto", "Carla"];
    const ids: string[] = [];
    for (const [i, nombre] of nombres.entries()) {
      const [e] = await db.insert(employees).values({
        dni: `${SELLO}${i}0`.slice(0, 8),
        firstName: nombre, lastName: `Prueba ${SELLO}`,
        position: "Operario de almacén", area: AREA, hireDate: HOY,
      }).returning();
      ids.push(e.id);
      creados.push(e.id);
    }
    const [ana, beto, carla] = ids;

    // ---------- Un día sin pasar lista ----------
    const sinLista = await listAttendanceDay({ day: HOY, area: AREA });
    check("sin pasar lista salen los tres, todos sin marcar",
      sinLista.length === 3 && sinLista.every((r) => r.status === null), sinLista.map((r) => r.status));

    const cuentas0 = await attendanceCounts({ day: HOY, area: AREA });
    check("y la cuenta dice que hay tres sin marcar, no tres faltas",
      cuentas0.sinMarcar === 3 && cuentas0.faltas === 0, cuentas0);

    // ---------- Se pasa lista ----------
    await db.insert(attendance).values([
      { employeeId: ana, day: HOY, status: "PRESENTE" },
      { employeeId: beto, day: HOY, status: "FALTA" },
      { employeeId: carla, day: HOY, status: "JUSTIFICADO", reason: "Descanso médico" },
    ]);

    const conLista = await listAttendanceDay({ day: HOY, area: AREA });
    const de = (nombre: string) => conLista.find((r) => r.firstName === nombre)!;
    check("Ana figura presente", de("Ana").status === "PRESENTE");
    check("Beto figura falta", de("Beto").status === "FALTA");
    check("Carla figura justificada, con su motivo",
      de("Carla").status === "JUSTIFICADO" && de("Carla").reason === "Descanso médico", de("Carla"));

    const cuentas = await attendanceCounts({ day: HOY, area: AREA });
    check("las cuentas del día cuadran",
      cuentas.presentes === 1 && cuentas.faltas === 1 && cuentas.justificados === 1 && cuentas.sinMarcar === 0,
      cuentas);

    // ---------- Volver a marcar corrige, no duplica ----------
    await db.insert(attendance)
      .values({ employeeId: beto, day: HOY, status: "PRESENTE" })
      .onConflictDoUpdate({
        target: [attendance.employeeId, attendance.day],
        set: { status: "PRESENTE", reason: null },
      });

    const filasBeto = await db.select().from(attendance)
      .where(and(eq(attendance.employeeId, beto), eq(attendance.day, HOY)));
    check("volver a marcar a alguien no deja dos filas del mismo día", filasBeto.length === 1, filasBeto.length);
    check("y queda lo último que se marcó", filasBeto[0].status === "PRESENTE");

    // ---------- El resumen del mes ----------
    // Tres días más de Ana, repartidos.
    await db.insert(attendance).values([
      { employeeId: ana, day: addDays(HOY, -1), status: "PRESENTE" },
      { employeeId: ana, day: addDays(HOY, -2), status: "FALTA" },
      { employeeId: ana, day: addDays(HOY, -3), status: "JUSTIFICADO", reason: "Permiso" },
    ]);

    const mes = await attendanceMonth(HOY.slice(0, 7), { area: AREA });
    const resumenAna = mes.filas.find((r) => r.nombre.startsWith("Ana"))!;
    // Los días -1, -2 y -3 pueden caer en el mes anterior si hoy es día 1, 2 o 3.
    const dentroDelMes = [HOY, addDays(HOY, -1), addDays(HOY, -2), addDays(HOY, -3)]
      .filter((d) => d.slice(0, 7) === HOY.slice(0, 7));
    check("el resumen del mes cuenta solo los días de ese mes",
      resumenAna.registrados === dentroDelMes.length, { resumen: resumenAna, esperado: dentroDelMes.length });
    check("y suma presentes, faltas y justificados por separado",
      resumenAna.presentes + resumenAna.faltas + resumenAna.justificados === resumenAna.registrados,
      resumenAna);

    const resumenCarla = mes.filas.find((r) => r.nombre.startsWith("Carla"))!;
    check("quien solo tiene un día marcado no aparece con faltas inventadas",
      resumenCarla.faltas === 0 && resumenCarla.justificados === 1, resumenCarla);

    check("el resumen dice cuántos días del mes tienen registro",
      mes.diasRegistrados >= 1, mes.diasRegistrados);

    // ---------- La ficha del trabajador ----------
    const suya = await attendanceFor(ana);
    check("la ficha trae los días de ese trabajador, lo último arriba",
      suya.length >= 1 && suya[0].day >= suya[suya.length - 1].day, suya.map((s) => s.day));
    check("y solo los suyos", suya.length === 1 + dentroDelMes.filter((d) => d !== HOY).length
      + [addDays(HOY, -1), addDays(HOY, -2), addDays(HOY, -3)].filter((d) => d.slice(0, 7) !== HOY.slice(0, 7)).length,
      suya.length);

    // ---------- Un trabajador desactivado sale de la lista ----------
    await db.update(employees).set({ active: false }).where(eq(employees.id, carla));
    const activos = await listAttendanceDay({ day: HOY, area: AREA });
    check("a un trabajador desactivado ya no se le pasa lista",
      activos.length === 2 && !activos.some((r) => r.firstName === "Carla"), activos.map((r) => r.firstName));

    // ---------- Un día que no se tocó sigue vacío ----------
    const otroDia = await listAttendanceDay({ day: addDays(HOY, -20), area: AREA });
    check("un día que nadie registró sale entero sin marcar",
      otroDia.every((r) => r.status === null), otroDia.map((r) => r.status));
  } finally {
    if (creados.length) await db.delete(employees).where(inArray(employees.id, creados));
  }

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
