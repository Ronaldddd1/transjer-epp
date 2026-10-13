/**
 * Avisos de vencimiento por WhatsApp.
 *
 * Lo que importa de un aviso automático es que no se repita y que no se adelante: si llega
 * todos los días hasta que se pague, la gente deja de leerlo, y entonces no sirve para nada.
 *
 *   npx tsx --conditions=react-server tests/avisos.test.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { obligationInstallments, obligations } from "../src/db/schema";
import { avisosPendientes, marcarAvisadas, mensajeDeAvisos } from "../src/server/reminders";
import { todayLima } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = `AVISO ${Date.now()}`;
/**
 * Días contados desde hoy en Lima, no desde hoy en UTC.
 *
 * La consulta de avisos compara contra la fecha de Lima. Partir de UTC hacía que la
 * prueba fallara todas las tardes: pasadas las 19:00 de Lima ya es el día siguiente en
 * UTC, así que cada vencimiento quedaba un día corrido y los de "en 2 días" se salían
 * de la ventana.
 */
const enDias = (d: number) => {
  const f = new Date(`${todayLima()}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + d);
  return f.toISOString().slice(0, 10);
};

async function main() {
  await db.delete(obligations).where(sql`${obligations.name} like 'AVISO %'`);

  const [prestamo] = await db.insert(obligations).values({
    type: "PRESTAMO", name: `${SELLO} prestamo`, creditor: "Interbank", currency: "PEN",
    principal: "100000.00", annualRate: "11.000", disbursedAt: enDias(-30),
  }).returning();
  const [servicio] = await db.insert(obligations).values({
    type: "SERVICIO", name: `${SELLO} celular`, creditor: "Entel", currency: "PEN", billingDay: 5,
  }).returning();
  const [cerrada] = await db.insert(obligations).values({
    type: "SERVICIO", name: `${SELLO} cerrada`, creditor: "Claro", currency: "PEN",
    billingDay: 5, status: "CERRADA",
  }).returning();

  // Un abanico de vencimientos alrededor de hoy.
  await db.insert(obligationInstallments).values([
    { obligationId: prestamo.id, number: 1, dueDate: enDias(-3), total: "900.00" },   // ya venció
    { obligationId: prestamo.id, number: 2, dueDate: enDias(1), total: "1200.00" },   // mañana
    { obligationId: prestamo.id, number: 3, dueDate: enDias(2), total: "1200.00" },   // en 2 días
    { obligationId: prestamo.id, number: 4, dueDate: enDias(5), total: "1200.00" },   // más adelante
    { obligationId: servicio.id, number: 1, dueDate: enDias(0), total: "33.71" },     // hoy
    { obligationId: servicio.id, number: 2, dueDate: enDias(2), total: null },        // sin importe
    { obligationId: cerrada.id, number: 1, dueDate: enDias(1), total: "50.00" },      // obligación cerrada
  ]);

  const mios = (filas: Awaited<ReturnType<typeof avisosPendientes>>) => filas.filter((f) => f.obligacion.startsWith(SELLO));

  // ---------- A quién se avisa ----------
  let avisos = mios(await avisosPendientes(2));
  const numeros = avisos.map((a) => `${a.obligacion.split(" ").at(-1)}#${a.numero}`).sort();
  check("avisa de lo que vence hoy y hasta dentro de 2 días",
    numeros.join(",") === "celular#1,celular#2,prestamo#2,prestamo#3", numeros);
  check("no avisa de lo ya vencido", !avisos.some((a) => a.dias < 0), avisos.map((a) => a.dias));
  check("no avisa de lo que vence más adelante", !avisos.some((a) => a.dias > 2), avisos.map((a) => a.dias));
  check("ignora las obligaciones que no están activas", !avisos.some((a) => a.entidad === "Claro"));
  check("trae los días que faltan", avisos.find((a) => a.numero === 2 && a.tipo === "PRESTAMO")?.dias === 1, avisos);

  // ---------- El mensaje ----------
  const texto = mensajeDeAvisos(avisos)!;
  check("el mensaje nombra la obligación y la entidad", texto.includes("prestamo") && texto.includes("Interbank"));
  check("dice cuándo vence cada una en palabras", texto.includes("mañana") && texto.includes("hoy"));
  // 1200 + 1200 + 33.71; la cuota sin importe no se puede sumar.
  check("suma solo lo que tiene importe", texto.includes("2,433.71"), texto);
  check("avisa de la que no tiene importe", texto.includes("1 sin importe"), texto);
  check("sin nada por vencer no hay mensaje", mensajeDeAvisos([]) === null);

  // ---------- No se repite ----------
  const marcadas = await marcarAvisadas(avisos.map((a) => a.id));
  check("marca las cuatro cuotas avisadas", marcadas === 4, marcadas);

  avisos = mios(await avisosPendientes(2));
  check("al día siguiente no las vuelve a avisar", avisos.length === 0, avisos.map((a) => a.obligacion));

  // ---------- Cuando se amplía la ventana ----------
  const aSieteDias = mios(await avisosPendientes(7));
  check("con más días de antelación aparece la cuota siguiente",
    aSieteDias.length === 1 && aSieteDias[0].numero === 4, aSieteDias);

  // Se marcan todas las del préstamo, incluidas la vencida y la de dentro de cinco días:
  // solo deben contar las dos que aún no tenían marca.
  const repetido = await marcarAvisadas((await db.select({ id: obligationInstallments.id })
    .from(obligationInstallments).where(eq(obligationInstallments.obligationId, prestamo.id))).map((r) => r.id));
  check("marcar dos veces no cuenta de nuevo lo ya avisado", repetido === 2, repetido);

  check("ignora identificadores inventados", (await marcarAvisadas(["no-es-un-uuid", "' or 1=1 --"])) === 0);

  await db.delete(obligations).where(sql`${obligations.name} like 'AVISO %'`);
  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); process.exit(1); });
