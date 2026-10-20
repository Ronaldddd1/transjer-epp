/**
 * Notas de crédito: la factura anulada que no desaparece.
 *
 * Una factura mal emitida existe ante SUNAT hasta que el proveedor emite la nota de
 * crédito. Si el sistema la borrara, o la anulara sin más, dentro de tres meses nadie
 * sabría por qué falta ese número ni que hay una NC pendiente de reclamar. Lo que se
 * prueba aquí es justo eso: que la factura quede anulada CON su nota al lado, que la que
 * todavía la espera se pueda encontrar, y que una NC por un importe distinto no anule nada.
 *
 *   npx tsx --conditions=react-server tests/notas-credito.test.ts
 */
import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { supplierInvoices, suppliers } from "../src/db/schema";
import { notaDeCreditoEn } from "../src/server/invoice-sheet";
import { countAwaitingCreditNote, listInvoices } from "../src/server/invoice-queries";
import { todayLima } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const SERIE = `NC${SELLO.slice(0, 2)}`;

async function main() {
  // ---------- Lo que la hoja de Excel anotaba dentro del estado ----------
  // En el control real la NC no tiene columna: se escribe en la celda de estado.
  const anotaciones: [string, string | null][] = [
    ["NC E001-29", "E001-29"],
    ["NC-01", "NC-01"],
    ["ANULADO NC 001-45", "001-45"],
    ["Nota de crédito FC01-123", "FC01-123"],
    ["N/C E001-7", "E001-7"],
    ["NC", "NC"],
    ["ANULADO", null],
    ["PAGADO", null],
    ["CANCELADO", null],
    ["BANCO DE LA NACION", null],
    ["", null],
  ];
  for (const [celda, esperado] of anotaciones) {
    check(`la celda ${JSON.stringify(celda)} ${esperado ? `da la nota ${esperado}` : "no inventa ninguna nota"}`,
      notaDeCreditoEn(celda) === esperado, notaDeCreditoEn(celda));
  }

  let supplierId = "";
  const creadas: string[] = [];

  try {
    const [proveedor] = await db.insert(suppliers).values({
      businessName: `Proveedor NC ${SELLO}`,
      ruc: `20${SELLO}${SELLO.slice(0, 3)}`.slice(0, 11),
    }).returning();
    supplierId = proveedor.id;

    const base = {
      supplierId: proveedor.id,
      docType: "FACTURA" as const,
      issueDate: todayLima(),
      currency: "PEN",
      total: "1180.00",
      detractionRate: "4.00",
      detractionAmount: "48.00",
      detractionStatus: "PENDIENTE" as const,
    };

    const [conNota] = await db.insert(supplierInvoices)
      .values({ ...base, series: SERIE, number: "1" }).returning();
    const [esperando] = await db.insert(supplierInvoices)
      .values({ ...base, series: SERIE, number: "2", status: "ANULADA", awaitingCreditNote: true }).returning();
    const [normal] = await db.insert(supplierInvoices)
      .values({ ...base, series: SERIE, number: "3" }).returning();
    creadas.push(conNota.id, esperando.id, normal.id);

    // ---------- La base impide los estados que no significan nada ----------
    // Una factura con nota de crédito está anulada, por definición. Guardar la nota sobre
    // una factura viva dejaría un número que resta en la cola de pagos.
    let rechazo = "";
    try {
      await db.update(supplierInvoices)
        .set({ creditNoteNumber: "NC-99" })
        .where(eq(supplierInvoices.id, normal.id));
    } catch (e) {
      rechazo = e instanceof Error ? e.message : String(e);
    }
    check("no se puede poner una nota de crédito en una factura que no está anulada",
      rechazo !== "", rechazo.slice(0, 80));

    // Y lo contrario: con la nota ya cargada, no se sigue esperando.
    let rechazo2 = "";
    try {
      await db.update(supplierInvoices)
        .set({ status: "ANULADA", creditNoteNumber: "NC-98", awaitingCreditNote: true })
        .where(eq(supplierInvoices.id, normal.id));
    } catch (e) {
      rechazo2 = e instanceof Error ? e.message : String(e);
    }
    check("una factura no puede tener su nota y seguir esperándola a la vez",
      rechazo2 !== "", rechazo2.slice(0, 80));

    // ---------- La anulación con nota ----------
    await db.update(supplierInvoices).set({
      status: "ANULADA",
      creditNoteNumber: "NC-01",
      creditNoteDate: todayLima(),
      creditNoteAmount: "1180.00",
      awaitingCreditNote: false,
      detractionStatus: "NO_APLICA",
    }).where(eq(supplierInvoices.id, conNota.id));

    const [guardada] = await db.select().from(supplierInvoices)
      .where(eq(supplierInvoices.id, conNota.id));
    check("la factura anulada conserva su importe y su número", guardada.total === "1180.00");
    check("y guarda con qué nota de crédito se anuló", guardada.creditNoteNumber === "NC-01");
    check("la nota cubre el total de la factura",
      Number(guardada.creditNoteAmount) === Number(guardada.total),
      { nota: guardada.creditNoteAmount, factura: guardada.total });
    check("y deja de generar detracción", guardada.detractionStatus === "NO_APLICA");

    // ---------- Las que todavía esperan la nota ----------
    const cuenta = await countAwaitingCreditNote();
    check("la que espera su nota de crédito se puede contar", cuenta >= 1, cuenta);

    const { rows } = await listInvoices({ awaitingCreditNote: true, q: SERIE }, 50, 0);
    const placas = rows.map((r) => r.number);
    check("y se puede listar para reclamársela al proveedor", placas.includes("2"), placas);
    check("la que ya tiene su nota no sale en esa lista", !placas.includes("1"), placas);

    /**
     * Una factura cuya detracción YA se depositó y después se anula.
     *
     * El dinero está en el Banco de la Nación y hay una constancia con ese número: poner
     * la detracción en "no aplica" dejaría al sistema diciendo que no se depositó nada.
     * Se conserva como está, y la base no permite otra cosa: su estado y su fecha de
     * depósito tienen que seguir cuadrando.
     */
    const [depositada] = await db.insert(supplierInvoices).values({
      ...base, series: SERIE, number: "4",
      detractionStatus: "PAGADA", detractionPaidAt: todayLima(), detractionReceipt: "12345678",
    }).returning();
    creadas.push(depositada.id);

    await db.update(supplierInvoices).set({
      status: "ANULADA",
      creditNoteNumber: "NC-02",
      creditNoteAmount: depositada.total,
      awaitingCreditNote: false,
    }).where(eq(supplierInvoices.id, depositada.id));

    const [conDeposito] = await db.select().from(supplierInvoices)
      .where(eq(supplierInvoices.id, depositada.id));
    check("una factura con la detracción ya depositada se puede anular con su nota",
      conDeposito.creditNoteNumber === "NC-02" && conDeposito.status === "ANULADA");
    check("y su detracción se queda como estaba, con su constancia",
      conDeposito.detractionStatus === "PAGADA" && conDeposito.detractionPaidAt !== null,
      { estado: conDeposito.detractionStatus, fecha: conDeposito.detractionPaidAt });

    // Y la base impide dejarla en un estado que no cuadre con la constancia.
    let incoherente = "";
    try {
      await db.update(supplierInvoices).set({ detractionStatus: "NO_APLICA" })
        .where(eq(supplierInvoices.id, depositada.id));
    } catch (e) {
      incoherente = e instanceof Error ? e.message : String(e);
    }
    check("no se puede decir que no aplica una detracción que ya se depositó",
      incoherente !== "", incoherente.slice(0, 70));

    // ---------- Anulada con nota y anulada esperándola no son lo mismo ----------
    const { rows: anuladas } = await listInvoices({ status: "ANULADA", q: SERIE }, 50, 0);
    const conNC = anuladas.filter((r) => r.creditNoteNumber);
    const sinNC = anuladas.filter((r) => !r.creditNoteNumber && r.awaitingCreditNote);
    check("las dos clases de anulada se distinguen en el listado",
      conNC.length >= 1 && sinNC.length >= 1, { conNC: conNC.length, sinNC: sinNC.length });
  } finally {
    if (creadas.length) await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, creadas));
    if (supplierId) {
      await db.delete(supplierInvoices).where(and(
        eq(supplierInvoices.supplierId, supplierId), eq(supplierInvoices.series, SERIE),
      ));
      await db.delete(suppliers).where(eq(suppliers.id, supplierId));
    }
  }

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
