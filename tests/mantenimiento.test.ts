/**
 * Mantenimiento de la flota: cuándo le toca a cada unidad.
 *
 * Lo que hay que acertar aquí es el cruce de los dos relojes: el de los kilómetros y el
 * del calendario. Un camión parado tres meses necesita su cambio de aceite aunque no haya
 * rodado los 10.000 km; uno que hace Lima-Arequipa todas las semanas los hace antes de los
 * seis meses. Quedarse con uno solo deja fuera la mitad de la flota.
 *
 *   npx tsx --conditions=react-server tests/mantenimiento.test.ts
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { maintenancePlans, maintenanceRecords, vehicles } from "../src/db/schema";
import {
  addDays, estadoMantenimiento, MAINTENANCE_DEFAULTS, MAINTENANCE_KINDS, todayLima,
} from "../src/lib/utils";
import { listMaintenance, maintenanceCounts } from "../src/server/maintenance-queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const HOY = todayLima();
const PLACA = `MN${SELLO[0]}-${SELLO.slice(1, 4)}`;

function calculo() {
  // ---------- Los dos relojes ----------
  const porKm = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -10), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 111000, hoy: HOY,
  });
  check("si se pasó de kilómetros, está vencido aunque falten meses",
    porKm.estado === "VENCIDO" && porKm.kmRestantes === -1000, porKm);

  const porTiempo = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -200), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 101000, hoy: HOY,
  });
  check("si se pasó de tiempo, está vencido aunque casi no haya rodado",
    porTiempo.estado === "VENCIDO" && porTiempo.diasRestantes === -20, porTiempo);

  const alDia = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -30), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 102000, hoy: HOY,
  });
  check("con margen en los dos, está al día", alDia.estado === "AL_DIA", alDia);
  check("y dice cuándo toca, por fecha y por kilómetro",
    alDia.proximaFecha === addDays(HOY, 150) && alDia.proximoKm === 110000, alDia);

  // ---------- El aviso, antes de que pase ----------
  const cercaKm = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -10), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 109500, hoy: HOY,
  });
  check("a 500 km del cambio, avisa antes de que se pase", cercaKm.estado === "POR_VENCER", cercaKm);

  const cercaFecha = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -175), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 100100, hoy: HOY,
  });
  check("a cinco días, también avisa", cercaFecha.estado === "POR_VENCER", cercaFecha);

  // ---------- Lo que no se puede calcular ----------
  const nunca = estadoMantenimiento({
    ultimaFecha: null, ultimoKm: null, everyKm: 10000, everyDays: 180, kmActual: 120000, hoy: HOY,
  });
  check("sin un solo registro no se inventa una fecha",
    nunca.estado === "SIN_REGISTRO" && nunca.proximaFecha === null && nunca.proximoKm === null, nunca);

  const sinOdometro = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -10), ultimoKm: 100000,
    everyKm: 10000, everyDays: null, kmActual: null, hoy: HOY,
  });
  check("sin kilometraje actual, lo que va por kilómetros no se puede juzgar",
    sinOdometro.estado === "AL_DIA" && sinOdometro.kmRestantes === null, sinOdometro);
  check("pero sí se sabe a qué kilómetro toca", sinOdometro.proximoKm === 110000, sinOdometro);

  const soloTiempo = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -20), ultimoKm: null,
    everyKm: null, everyDays: 15, kmActual: 50000, hoy: HOY,
  });
  check("un lavado solo mira el calendario",
    soloTiempo.estado === "VENCIDO" && soloTiempo.kmRestantes === null, soloTiempo);

  // ---------- El día justo ----------
  const justo = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -180), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 100000, hoy: HOY,
  });
  check("el día exacto en que toca todavía no está vencido",
    justo.estado === "POR_VENCER" && justo.diasRestantes === 0, justo);
  const unDiaDespues = estadoMantenimiento({
    ultimaFecha: addDays(HOY, -181), ultimoKm: 100000,
    everyKm: 10000, everyDays: 180, kmActual: 100000, hoy: HOY,
  });
  check("un día después, sí", unDiaDespues.estado === "VENCIDO", unDiaDespues);

  // ---------- Las periodicidades por defecto ----------
  check("todos los tipos tienen una periodicidad por defecto",
    MAINTENANCE_KINDS.every((k) => {
      const d = MAINTENANCE_DEFAULTS[k];
      return d.everyKm !== null || d.everyDays !== null;
    }));
  check("el lavado va solo por días, que es como se controla",
    MAINTENANCE_DEFAULTS.LAVADO.everyKm === null && MAINTENANCE_DEFAULTS.LAVADO.everyDays !== null);
}

async function main() {
  calculo();

  const creados: string[] = [];
  try {
    const [unidad] = await db.insert(vehicles).values({
      plate: PLACA, brand: "Volvo", model: "FH 440", year: 2018,
      odometerKm: 120000, odometerAt: HOY,
    }).returning();
    creados.push(unidad.id);

    // Un aceite hecho hace 40 días, a 112.000 km: ya rodó 8.000 de los 10.000.
    await db.insert(maintenanceRecords).values({
      vehicleId: unidad.id, kind: "ACEITE", servicedAt: addDays(HOY, -40), odometerKm: 112000,
    });
    // Un lavado de hace 20 días: su regla es cada 15.
    await db.insert(maintenanceRecords).values({
      vehicleId: unidad.id, kind: "LAVADO", servicedAt: addDays(HOY, -20),
    });

    const filas = await listMaintenance({ q: PLACA });
    const de = (kind: string) => filas.find((f) => f.kind === kind)!;

    check("la unidad aparece con un renglón por cada mantenimiento",
      filas.length === MAINTENANCE_KINDS.length, filas.length);

    const aceite = de("ACEITE");
    check("el aceite sabe cuándo se hizo y a qué kilómetro",
      aceite.ultimaFecha === addDays(HOY, -40) && aceite.ultimoKm === 112000, aceite);
    check("y que faltan 2.000 km", aceite.kmRestantes === 2000, aceite.kmRestantes);
    check("está al día, porque no se pasó de ninguno de los dos",
      aceite.estado === "AL_DIA", aceite.estado);

    const lavado = de("LAVADO");
    check("el lavado de hace 20 días está vencido", lavado.estado === "VENCIDO", lavado);

    const frenos = de("FRENOS");
    check("lo que nunca se hizo queda como tal", frenos.estado === "SIN_REGISTRO", frenos.estado);

    // ---------- La regla propia de la unidad ----------
    await db.insert(maintenancePlans).values({
      vehicleId: unidad.id, kind: "ACEITE", everyKm: 5000, everyDays: null,
    });
    const conRegla = (await listMaintenance({ q: PLACA })).find((f) => f.kind === "ACEITE")!;
    check("con una regla propia de 5.000 km, el mismo aceite pasa a estar vencido",
      conRegla.estado === "VENCIDO" && conRegla.kmRestantes === -3000, conRegla);
    check("y la pantalla sabe que esa periodicidad es propia de la unidad",
      conRegla.reglaPropia === true && conRegla.everyKm === 5000, conRegla);

    // ---------- Quitarle un mantenimiento a una unidad ----------
    await db.insert(maintenancePlans).values({
      vehicleId: unidad.id, kind: "LAVADO", everyDays: 15, active: false,
    });
    const sinLavado = await listMaintenance({ q: PLACA });
    check("un mantenimiento desactivado desaparece de la lista de esa unidad",
      !sinLavado.some((f) => f.kind === "LAVADO"), sinLavado.map((f) => f.kind));

    // ---------- El orden: primero lo que ya se pasó ----------
    const orden = sinLavado.map((f) => f.estado);
    const primerAlDia = orden.indexOf("AL_DIA");
    const ultimoVencido = orden.lastIndexOf("VENCIDO");
    check("lo vencido va antes que lo que está al día",
      primerAlDia === -1 || ultimoVencido === -1 || ultimoVencido < primerAlDia, orden);

    // ---------- Las cuentas de las pestañas ----------
    const cuentas = await maintenanceCounts({ q: PLACA });
    check("las cuentas suman lo mismo que las filas",
      cuentas.vencido + cuentas.porVencer + cuentas.alDia + cuentas.sinRegistro === cuentas.total,
      cuentas);
    check("y hay al menos uno vencido", cuentas.vencido >= 1, cuentas);

    // ---------- Una unidad de baja no reclama mantenimiento ----------
    await db.update(vehicles).set({ active: false }).where(eq(vehicles.id, unidad.id));
    const activas = await listMaintenance({ q: PLACA });
    check("una unidad dada de baja sale de la lista de mantenimiento",
      activas.length === 0, activas.length);
  } finally {
    if (creados.length) await db.delete(vehicles).where(inArray(vehicles.id, creados));
  }

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
