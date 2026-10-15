/**
 * Documentos de trabajadores y vehículos.
 *
 * Lo que hace que esto no sea una carpeta compartida es la fecha de vencimiento: un SOAT
 * vencido es una multa y un seguro que no responde. Así que lo que más se prueba aquí es
 * que el estado de cada documento sea el correcto en los bordes —el día que vence, el día
 * después— y que la base impida guardar cosas que no tienen sentido.
 *
 *   npx tsx --conditions=react-server tests/documentos.test.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, vehicles } from "../src/db/schema";
import {
  addDays, documentKindFromFilename, documentStatus, daysToExpiry, DOCUMENT_WARNING_DAYS,
  normalizePlate, todayLima,
} from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const HOY = todayLima();

async function main() {
  // ---------- La placa ----------
  // Sin normalizar, "bja838" y "BJA-838" quedarían como dos unidades distintas y los
  // papeles de una no aparecerían al buscar la otra.
  const placas: [string, string][] = [
    ["bja838", "BJA-838"],
    ["BJA-838", "BJA-838"],
    ["BJA 838", "BJA-838"],
    [" bja-838 ", "BJA-838"],
    ["C5Q932", "C5Q-932"],
  ];
  for (const [entrada, esperado] of placas) {
    check(`la placa ${JSON.stringify(entrada)} se guarda como ${esperado}`,
      normalizePlate(entrada) === esperado, normalizePlate(entrada));
  }

  // ---------- El tipo, deducido del nombre ----------
  const nombres: [string, string][] = [
    ["CERTIFICADO_SOAT_BJA838.pdf", "SOAT"],
    ["SOAT.pdf", "SOAT"],
    ["REVISION TECNICA .pdf", "REVISION_TECNICA"],
    ["Revisión Técnica 1.pdf", "REVISION_TECNICA"],
    ["RT-BNG908.pdf", "REVISION_TECNICA"],
    ["TARJETA DE PROPIEDAD.pdf", "TARJETA_PROPIEDAD"],
    ["TARJETA PROPIEDAD.pdf", "TARJETA_PROPIEDAD"],
    ["BVR727-RP.pdf", "TARJETA_PROPIEDAD"],
    ["TARJETA DE CIRCULACION.pdf", "TARJETA_CIRCULACION"],
    ["TARJETA UNICA DE CIRCULACION.pdf", "TARJETA_CIRCULACION"],
    ["CMA814_TIVE.pdf", "TARJETA_CIRCULACION"],
    ["MTC BNG908.pdf", "MTC"],
    ["CamScanner 26-09-2025 12.33.pdf", "OTRO_VEHICULO"],
  ];
  for (const [archivo, esperado] of nombres) {
    check(`"${archivo}" se reconoce como ${esperado}`,
      documentKindFromFilename(archivo) === esperado, documentKindFromFilename(archivo));
  }

  // ---------- El estado, en los bordes ----------
  // Los bordes son donde se equivocan estas cosas: el día que vence todavía vale, y el
  // día siguiente ya no.
  check("el día que vence todavía cuenta como vigente, no como vencido",
    documentStatus(HOY, HOY) === "POR_VENCER", documentStatus(HOY, HOY));
  check("el día siguiente al vencimiento ya está vencido",
    documentStatus(addDays(HOY, -1), HOY) === "VENCIDO");
  check(`a ${DOCUMENT_WARNING_DAYS} días justos avisa`,
    documentStatus(addDays(HOY, DOCUMENT_WARNING_DAYS), HOY) === "POR_VENCER");
  check(`a ${DOCUMENT_WARNING_DAYS + 1} días todavía no avisa`,
    documentStatus(addDays(HOY, DOCUMENT_WARNING_DAYS + 1), HOY) === "VIGENTE");
  check("sin fecha no está ni vigente ni vencido",
    documentStatus(null, HOY) === "SIN_FECHA");

  check("los días que faltan se cuentan bien", daysToExpiry(addDays(HOY, 7), HOY) === 7);
  check("y los días que pasaron salen en negativo", daysToExpiry(addDays(HOY, -3), HOY) === -3);
  check("sin fecha no hay días que contar", daysToExpiry(null, HOY) === null);

  // ---------- Lo que la base no debe permitir ----------
  await db.delete(vehicles).where(sql`${vehicles.plate} like 'ZZ%'`);

  const [unidad] = await db.insert(vehicles).values({ plate: `ZZ-${SELLO.slice(-3)}` }).returning();
  const [trabajador] = await db.select({ id: employees.id }).from(employees).limit(1);

  const base = {
    kind: "SOAT", filename: "prueba.pdf", contentType: "application/pdf",
    sizeBytes: 1024, storageDriver: "db", content: Buffer.from("x"),
  };

  /**
   * El motivo por el que la base rechazó algo.
   *
   * Drizzle envuelve el error de Postgres, así que el nombre de la restricción no está en
   * el mensaje sino en la causa. Sin mirar ahí, una prueba de este tipo pasa igual aunque
   * la fila se haya guardado, que es justo lo contrario de lo que se quiere comprobar.
   */
  const falla = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "NO FALLÓ: la fila se guardó";
    } catch (e) {
      const causa = (e as { cause?: { constraint_name?: string; message?: string } })?.cause;
      return causa?.constraint_name ?? causa?.message ?? (e instanceof Error ? e.message : String(e));
    }
  };

  // Un documento tiene que ser de alguien, y de uno solo: si fuera de un trabajador y de
  // un vehículo a la vez, no habría forma de decidir en qué ficha mostrarlo.
  let motivo = await falla(() => db.insert(documents).values({ ...base }));
  check("un documento sin dueño se rechaza", motivo.includes("documents_owner"), motivo);

  if (trabajador) {
    motivo = await falla(() => db.insert(documents).values({
      ...base, vehicleId: unidad.id, employeeId: trabajador.id,
    }));
    check("un documento de un trabajador y un vehículo a la vez se rechaza",
      motivo.includes("documents_owner"), motivo);
  }

  motivo = await falla(() => db.insert(documents).values({
    ...base, vehicleId: unidad.id, issuedAt: "2026-06-01", expiresAt: "2026-01-01",
  }));
  check("un documento que vence antes de emitirse se rechaza", motivo.includes("fechas_coherentes"), motivo);

  motivo = await falla(() => db.insert(documents).values({ ...base, vehicleId: unidad.id, sizeBytes: 0 }));
  check("un archivo vacío se rechaza", motivo.includes("size_positive"), motivo);

  // La placa es única: dos unidades con la misma placa serían la misma unidad.
  motivo = await falla(() => db.insert(vehicles).values({ plate: unidad.plate }));
  check("no se puede repetir una placa", motivo.includes("plate"), motivo);

  // ---------- Al borrar la unidad se van sus papeles ----------
  await db.insert(documents).values({ ...base, vehicleId: unidad.id, expiresAt: addDays(HOY, 10) });
  const antes = await db.select({ id: documents.id }).from(documents).where(eq(documents.vehicleId, unidad.id));
  check("el documento quedó guardado", antes.length === 1, antes.length);

  await db.delete(vehicles).where(eq(vehicles.id, unidad.id));
  const despues = await db.select({ id: documents.id }).from(documents).where(eq(documents.vehicleId, unidad.id));
  check("al borrar la unidad no quedan documentos huérfanos", despues.length === 0, despues.length);

  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
