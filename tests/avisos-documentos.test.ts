/**
 * Avisos de documentos de flota por vencer.
 *
 * Lo que tiene que cumplir: avisar con una semana de antelación, una sola vez, no avisar
 * de un papel que ya tiene reemplazo cargado, y volver a avisar cuando el documento se
 * renueva con otra fecha.
 *
 *   npx tsx --conditions=react-server tests/avisos-documentos.test.ts
 */
import "dotenv/config";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { documents, employees, vehicles } from "../src/db/schema";
import {
  avisosDeDocumentos, DIAS_DE_AVISO_DOCUMENTOS, marcarDocumentosAvisados, mensajeDeDocumentos,
} from "../src/server/document-reminders";
import { todayLima } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = `AVISODOC ${Date.now()}`;
const sufijo = String(Date.now()).slice(-3);
const enDias = (d: number) => {
  const f = new Date(`${todayLima()}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + d);
  return f.toISOString().slice(0, 10);
};

async function limpiar() {
  const viejos = await db.select({ id: vehicles.id }).from(vehicles).where(sql`${vehicles.notes} like 'AVISODOC %'`);
  if (viejos.length) await db.delete(vehicles).where(inArray(vehicles.id, viejos.map((v) => v.id)));
  await db.delete(employees).where(sql`${employees.position} like 'AVISODOC %'`);
}

async function main() {
  check("la antelación por defecto es una semana", DIAS_DE_AVISO_DOCUMENTOS === 7);
  await limpiar();

  const [chofer] = await db.insert(employees).values({
    dni: `9${String(Date.now()).slice(-7)}`, firstName: "Mario", lastName: "Quispe",
    position: SELLO, area: "Operaciones",
  }).returning();

  const [a, b, baja, demo] = await db.insert(vehicles).values([
    { plate: `ZQA-${sufijo}`, notes: SELLO, driverId: chofer.id },
    { plate: `ZQB-${sufijo}`, notes: SELLO },
    { plate: `ZQC-${sufijo}`, notes: SELLO, active: false },
    { plate: `ZQD-${sufijo}`, notes: SELLO, isDemo: true },
  ]).returning();

  const [soatA, revA, , polizaA, otroA] = await db.insert(documents).values([
    { vehicleId: a.id, kind: "SOAT", expiresAt: enDias(7) },                  // justo una semana
    { vehicleId: a.id, kind: "REVISION_TECNICA", expiresAt: enDias(0) },      // hoy
    { vehicleId: a.id, kind: "MTC", expiresAt: enDias(8) },                   // aún no
    { vehicleId: a.id, kind: "POLIZA", title: "Rímac", expiresAt: enDias(3) },// con título
    { vehicleId: a.id, kind: "OTRO", title: "Permiso municipal", expiresAt: enDias(5) },
    { vehicleId: a.id, kind: "OTRO", title: "Fumigación", expiresAt: enDias(200) }, // otro "Otro", no lo reemplaza
    { vehicleId: a.id, kind: "TARJETA_PROPIEDAD" },                           // no vence
    { vehicleId: b.id, kind: "SOAT", expiresAt: enDias(-2) },                 // ya venció
    { vehicleId: b.id, kind: "REVISION_TECNICA", expiresAt: enDias(4) },      // ya renovado:
    { vehicleId: b.id, kind: "REVISION_TECNICA", expiresAt: enDias(369) },    //   el nuevo vence en un año
    { vehicleId: baja.id, kind: "SOAT", expiresAt: enDias(2) },               // unidad de baja
    { vehicleId: demo.id, kind: "SOAT", expiresAt: enDias(2) },               // demostración
  ]).returning();

  const mios = async (dias?: number) =>
    (await avisosDeDocumentos(dias)).filter((d) => d.placa.endsWith(`-${sufijo}`) && d.placa.startsWith("ZQ"));

  // ---------- Qué se avisa ----------
  let avisos = await mios();
  const claves = avisos.map((d) => `${d.placa.slice(0, 3)}:${d.tipo}`).sort();
  check("avisa de hoy hasta dentro de 7 días, de unidades activas",
    claves.join(",") === "ZQA:OTRO,ZQA:POLIZA,ZQA:REVISION_TECNICA,ZQA:SOAT", claves);
  check("no avisa lo que vence en 8 días", !avisos.some((d) => d.tipo === "MTC"));
  check("no avisa lo ya vencido", !avisos.some((d) => d.dias < 0), avisos.map((d) => d.dias));
  check("no avisa un documento que ya tiene reemplazo", !avisos.some((d) => d.placa.startsWith("ZQB")));
  check("ignora unidades de baja y de demostración",
    !avisos.some((d) => d.placa.startsWith("ZQC") || d.placa.startsWith("ZQD")));
  check("un 'Otro' con distinto título no tapa al que vence", avisos.some((d) => d.id === otroA.id));
  check("ordena por lo que vence antes", avisos[0]?.id === revA.id && avisos.at(-1)?.id === soatA.id,
    avisos.map((d) => d.vence));
  check("trae los días que faltan", avisos.find((d) => d.id === soatA.id)?.dias === 7);
  check("trae el conductor", avisos.find((d) => d.id === soatA.id)?.conductor === "Mario Quispe");
  check("junta tipo y título", avisos.find((d) => d.id === polizaA.id)?.documento === "Póliza (Rímac)"
    || avisos.find((d) => d.id === polizaA.id)?.documento.includes("(Rímac)") === true,
    avisos.find((d) => d.id === polizaA.id));

  // ---------- El mensaje ----------
  const texto = mensajeDeDocumentos(avisos, "https://transjer-epp.vercel.app/")!;
  check("el mensaje nombra la placa y el documento", texto.includes(`ZQA-${sufijo}`) && texto.includes("SOAT"), texto);
  check("dice cuándo vence en palabras", texto.includes("vence HOY") && texto.includes("en 7 días"), texto);
  check("nombra al conductor", texto.includes("Conductor: Mario Quispe"));
  check("cuenta documentos y unidades", texto.includes("4 documento(s) de 1 unidad(es)"), texto);
  check("deja el enlace a la flota sin doble barra",
    texto.includes("https://transjer-epp.vercel.app/documentos/vehiculos"), texto);
  check("sin nada por vencer no hay mensaje", mensajeDeDocumentos([]) === null);

  // ---------- Una sola vez ----------
  const marcados = await marcarDocumentosAvisados(avisos.map((d) => d.id));
  check("marca los cuatro avisados", marcados === 4, marcados);
  check("al día siguiente no los vuelve a avisar", (await mios()).length === 0);
  check("marcar de nuevo no cuenta lo ya avisado", (await marcarDocumentosAvisados([soatA.id])) === 0);
  check("ignora identificadores inventados", (await marcarDocumentosAvisados(["x", "' or 1=1 --"])) === 0);

  // ---------- Con más antelación aparece el siguiente ----------
  const a30 = await mios(30);
  check("con 30 días aparece el MTC", a30.length === 1 && a30[0].tipo === "MTC", a30);

  // ---------- Renovado en el mismo registro: se vuelve a avisar ----------
  // Es lo que hace updateDocument (y el importador) al cambiar la fecha: limpiar la marca.
  await db.update(documents).set({ expiresAt: enDias(6), reminderSentAt: null }).where(eq(documents.id, soatA.id));
  avisos = await mios();
  check("con fecha nueva se vuelve a avisar", avisos.length === 1 && avisos[0].id === soatA.id, avisos);

  await limpiar();
  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); });
