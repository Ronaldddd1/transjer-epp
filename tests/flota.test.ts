/**
 * La flota vista por unidad: una fila por placa, con sus papeles y su conductor.
 *
 * La pregunta que tiene que responder bien es una sola: ¿esta unidad puede salir hoy? Un
 * papel que falta pesa igual que uno vencido, porque en un control en la carretera dan lo
 * mismo. Y los papeles del conductor cuentan: sin licencia vigente no maneja, aunque el
 * camión esté impecable.
 *
 *   npx tsx --conditions=react-server tests/flota.test.ts
 */
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, vehicles } from "../src/db/schema";
import { addDays, anioPrimeraRevision, exigeRevisionTecnica, todayLima } from "../src/lib/utils";
import { estadoFlota, listFleet } from "../src/server/document-queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const HOY = todayLima();

/** Las cuatro placas de prueba. El sello evita chocar con datos de verdad. */
const PLACAS = {
  completa: `T1${SELLO.slice(-1)}-${SELLO.slice(0, 3)}`,
  falta: `T2${SELLO.slice(-1)}-${SELLO.slice(0, 3)}`,
  vencida: `T3${SELLO.slice(-1)}-${SELLO.slice(0, 3)}`,
  porVencer: `T4${SELLO.slice(-1)}-${SELLO.slice(0, 3)}`,
};

/** Los cuatro papeles clave, con la fecha que se le diga a cada uno. */
async function papeles(vehicleId: string, vence: string | null, conArchivo = true) {
  for (const kind of ["SOAT", "REVISION_TECNICA", "MTC", "TARJETA_PROPIEDAD"]) {
    await db.insert(documents).values({
      vehicleId, kind, expiresAt: vence,
      ...(conArchivo
        ? {
          filename: `${kind}-${SELLO}.pdf`, contentType: "application/pdf",
          sizeBytes: 12345, storageDriver: "db", content: Buffer.from("x"),
        }
        : {}),
    });
  }
}

/**
 * Comprobaciones de la regla de la revisión técnica, sin tocar la base.
 *
 * Recién se exige pasados tres años del año del vehículo: a uno del 2024 le toca desde el
 * 2027. Los bordes importan porque de ellos depende que una unidad nueva salga en rojo sin
 * motivo, o que una vieja deje de reclamarse.
 */
function reglaRevisionTecnica() {
  const casos: [number | null, string, boolean][] = [
    [2026, "2026-10-20", false],  // del año: no le toca
    [2025, "2026-10-20", false],  // un año
    [2024, "2026-10-20", false],  // dos años
    [2024, "2026-12-31", false],  // sigue sin tocarle hasta fin de año
    [2024, "2027-01-01", true],   // el 1 de enero del tercer año ya le toca
    [2023, "2026-10-20", true],   // tres años cumplidos
    [2010, "2026-10-20", true],   // vieja
    [null, "2026-10-20", true],   // sin año: se exige, no se adivina
  ];
  for (const [year, hoy, esperado] of casos) {
    check(`un vehículo ${year ?? "sin año"} ${esperado ? "ya necesita" : "todavía no necesita"} revisión técnica en ${hoy}`,
      exigeRevisionTecnica(year, hoy) === esperado, exigeRevisionTecnica(year, hoy));
  }
  check("y se dice desde qué año se le va a exigir", anioPrimeraRevision(2024) === 2027, anioPrimeraRevision(2024));
  check("sin año del vehículo no se inventa esa fecha", anioPrimeraRevision(null) === null);
}

async function main() {
  reglaRevisionTecnica();

  const creados: string[] = [];
  let choferId = "";

  try {
    // ---------- Un conductor con licencia vigente ----------
    const [chofer] = await db.insert(employees).values({
      firstName: "Conductor", lastName: `Prueba ${SELLO}`,
      dni: `9${SELLO}1`.slice(0, 8), position: "Conductor", area: "Operaciones",
      hireDate: HOY,
    }).returning();
    choferId = chofer.id;

    await db.insert(documents).values({
      employeeId: chofer.id, kind: "LICENCIA", expiresAt: addDays(HOY, 200),
      filename: `lic-${SELLO}.pdf`, contentType: "application/pdf",
      sizeBytes: 999, storageDriver: "db", content: Buffer.from("x"),
    });
    await db.insert(documents).values({
      employeeId: chofer.id, kind: "DNI",
      filename: `dni-${SELLO}.pdf`, contentType: "application/pdf",
      sizeBytes: 999, storageDriver: "db", content: Buffer.from("x"),
    });

    // ---------- Cuatro unidades, una por situación ----------
    const [completa] = await db.insert(vehicles).values({
      plate: PLACAS.completa, brand: "Volvo", model: "FH 440", year: 2018,
      capacityTn: "30.00", capacityM3: "85.00", mtcCode: `MTC-${SELLO}`, hasGps: true,
      driverId: chofer.id,
    }).returning();
    const [falta] = await db.insert(vehicles).values({ plate: PLACAS.falta }).returning();
    const [vencida] = await db.insert(vehicles).values({ plate: PLACAS.vencida }).returning();
    const [porVencer] = await db.insert(vehicles).values({ plate: PLACAS.porVencer }).returning();
    creados.push(completa.id, falta.id, vencida.id, porVencer.id);

    await papeles(completa.id, addDays(HOY, 300));
    // A la que le falta: solo dos de los cuatro.
    await db.insert(documents).values({
      vehicleId: falta.id, kind: "SOAT", expiresAt: addDays(HOY, 300),
      filename: `s-${SELLO}.pdf`, contentType: "application/pdf", sizeBytes: 1, storageDriver: "db", content: Buffer.from("x"),
    });
    await db.insert(documents).values({
      vehicleId: falta.id, kind: "REVISION_TECNICA", expiresAt: addDays(HOY, 300),
      filename: `r-${SELLO}.pdf`, contentType: "application/pdf", sizeBytes: 1, storageDriver: "db", content: Buffer.from("x"),
    });
    await papeles(vencida.id, addDays(HOY, -3));
    await papeles(porVencer.id, addDays(HOY, 10));

    // ---------- Lo que ve la pantalla ----------
    const flota = await listFleet({ q: SELLO.slice(0, 3) });
    const por = (plate: string) => flota.find((v) => v.plate === plate)!;

    check("las cuatro unidades de prueba salen en la flota", flota.length >= 4, flota.length);

    const c = por(PLACAS.completa);
    check("la unidad completa trae su SOAT con fecha y archivo",
      !!c.soat && c.soat.expiresAt === addDays(HOY, 300) && c.soat.tieneArchivo, c.soat);
    check("y sus otros tres papeles clave",
      !!c.revisionTecnica && !!c.mtc && !!c.tarjetaPropiedad,
      { rt: c.revisionTecnica, mtc: c.mtc, tp: c.tarjetaPropiedad });
    check("la ficha viene con marca, modelo, año y capacidad",
      c.brand === "Volvo" && c.model === "FH 440" && c.year === 2018 && Number(c.capacityTn) === 30,
      { brand: c.brand, model: c.model, year: c.year, tn: c.capacityTn });
    check("el GPS se refleja", c.hasGps === true);
    check("y puede salir", estadoFlota(c) === "AL_DIA", estadoFlota(c));

    check("el conductor aparece con su nombre y su DNI",
      c.driverName?.includes(`Prueba ${SELLO}`) === true && !!c.driverDni, { n: c.driverName, d: c.driverDni });
    check("su licencia viene con fecha y enlace al PDF",
      !!c.licencia && c.licencia.expiresAt === addDays(HOY, 200) && c.licencia.tieneArchivo, c.licencia);
    check("su DNI viene cargado aunque no tenga fecha",
      !!c.dniConductor && c.dniConductor.expiresAt === null && c.dniConductor.tieneArchivo, c.dniConductor);

    const f = por(PLACAS.falta);
    check("a la unidad incompleta le falta el MTC y la tarjeta",
      f.mtc === null && f.tarjetaPropiedad === null, { mtc: f.mtc, tp: f.tarjetaPropiedad });
    check("y el estado lo dice: falta un papel", estadoFlota(f) === "FALTA", estadoFlota(f));
    check("un papel que falta pesa igual que uno vencido: ninguna de las dos puede salir",
      estadoFlota(f) !== "AL_DIA" && estadoFlota(por(PLACAS.vencida)) !== "AL_DIA");
    check("la unidad sin conductor se ve como tal", f.driverId === null && f.driverName === null);

    const v = por(PLACAS.vencida);
    check("la unidad con los papeles vencidos cuenta cuatro vencidos", v.vencidos === 4, v.vencidos);
    check("y su estado es vencido", estadoFlota(v) === "VENCIDO", estadoFlota(v));

    const pv = por(PLACAS.porVencer);
    check("la que vence en diez días avisa antes de vencerse",
      estadoFlota(pv) === "POR_VENCER", estadoFlota(pv));

    // ---------- El estado es por unidad, no por documento ----------
    // De los cuatro papeles de la unidad completa, se vence uno solo: la unidad entera
    // tiene que dejar de estar "al día". Promediar fechas o mirar solo el SOAT dejaría
    // salir una unidad con la revisión técnica caducada.
    await db.update(documents)
      .set({ expiresAt: addDays(HOY, -1) })
      .where(eq(documents.id, (await db.select({ id: documents.id }).from(documents)
        .where(eq(documents.vehicleId, completa.id)).limit(1))[0].id));

    const [otraVez] = await listFleet({ id: completa.id });
    check("si se vence UN papel de cuatro, la unidad ya no puede salir",
      estadoFlota(otraVez) === "VENCIDO", estadoFlota(otraVez));

    // ---------- El conductor arrastra a la unidad ----------
    await db.update(documents)
      .set({ expiresAt: addDays(HOY, -5) })
      .where(eq(documents.employeeId, chofer.id));
    const [conChoferVencido] = await listFleet({ id: completa.id });
    check("la licencia vencida del conductor se cuenta en la unidad",
      conChoferVencido.conductorVencidos > 0, conChoferVencido.conductorVencidos);

    /**
     * Una unidad nueva sin revisión técnica NO está incompleta.
     *
     * Es el error que esto evita: la unidad del año pasado aparecía en rojo reclamando un
     * papel que la ley todavía no le pide, mezclada con las que sí tienen algo vencido.
     */
    const [nueva] = await db.insert(vehicles).values({
      plate: `T5${SELLO.slice(-1)}-${SELLO.slice(0, 3)}`,
      year: Number(HOY.slice(0, 4)),
      brand: "Volvo",
    }).returning();
    creados.push(nueva.id);
    for (const kind of ["SOAT", "MTC", "TARJETA_PROPIEDAD"]) {
      await db.insert(documents).values({
        vehicleId: nueva.id, kind, expiresAt: addDays(HOY, 300),
        filename: `${kind}.pdf`, contentType: "application/pdf",
        sizeBytes: 1, storageDriver: "db", content: Buffer.from("x"),
      });
    }

    const [recienComprada] = await listFleet({ id: nueva.id });
    check("una unidad del año no reclama la revisión técnica que todavía no le toca",
      estadoFlota(recienComprada) === "AL_DIA", estadoFlota(recienComprada));
    check("y su revisión técnica figura como no cargada, sin fecha",
      recienComprada.revisionTecnica === null);

    // La misma unidad, pero con cinco años: ahí sí se le reclama.
    await db.update(vehicles).set({ year: Number(HOY.slice(0, 4)) - 5 })
      .where(eq(vehicles.id, nueva.id));
    const [vieja] = await listFleet({ id: nueva.id });
    check("con cinco años, la misma unidad sí queda incompleta sin revisión técnica",
      estadoFlota(vieja) === "FALTA", estadoFlota(vieja));

    // Y si una unidad nueva TIENE su revisión técnica cargada, sus fechas cuentan igual.
    await db.update(vehicles).set({ year: Number(HOY.slice(0, 4)) })
      .where(eq(vehicles.id, nueva.id));
    await db.insert(documents).values({
      vehicleId: nueva.id, kind: "REVISION_TECNICA", expiresAt: addDays(HOY, -2),
      filename: "rt.pdf", contentType: "application/pdf",
      sizeBytes: 1, storageDriver: "db", content: Buffer.from("x"),
    });
    const [conRtVencida] = await listFleet({ id: nueva.id });
    check("una unidad nueva que sí tiene revisión técnica, y vencida, se marca como vencida",
      estadoFlota(conRtVencida) === "VENCIDO", estadoFlota(conRtVencida));

    // ---------- El filtro por estado ----------
    const soloVencidas = await listFleet({ q: SELLO.slice(0, 3), estado: "VENCIDO" });
    check("filtrando por vencidas no sale ninguna que esté al día",
      soloVencidas.every((u) => estadoFlota(u) === "VENCIDO"), soloVencidas.map((u) => u.plate));
    const soloFaltan = await listFleet({ q: SELLO.slice(0, 3), estado: "FALTA" });
    check("filtrando por 'falta un papel' sale la que le faltan dos",
      soloFaltan.some((u) => u.plate === PLACAS.falta), soloFaltan.map((u) => u.plate));

    // ---------- Una unidad de baja no se mete en los avisos ----------
    await db.update(vehicles).set({ active: false }).where(eq(vehicles.id, vencida.id));
    const [debaja] = await listFleet({ id: vencida.id });
    check("una unidad dada de baja no reclama papeles: queda como de baja",
      estadoFlota(debaja) === "BAJA", estadoFlota(debaja));
    const activas = await listFleet({ q: SELLO.slice(0, 3), soloActivos: true });
    check("y se puede pedir solo la flota activa",
      !activas.some((u) => u.plate === PLACAS.vencida), activas.map((u) => u.plate));

    // ---------- Se busca por lo que la gente recuerda ----------
    const porMarca = await listFleet({ q: "Volvo" });
    check("se busca por marca", porMarca.some((u) => u.plate === PLACAS.completa));
    const porChofer = await listFleet({ q: `Prueba ${SELLO}` });
    check("y por el nombre del conductor", porChofer.some((u) => u.plate === PLACAS.completa));
  } finally {
    // Limpieza: los documentos caen con el vehículo y con el trabajador.
    if (creados.length) await db.delete(vehicles).where(inArray(vehicles.id, creados));
    if (choferId) {
      await db.delete(documents).where(eq(documents.employeeId, choferId));
      await db.delete(employees).where(eq(employees.id, choferId));
    }
  }

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
