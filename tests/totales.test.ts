/**
 * Los totales que se muestran en pantalla.
 *
 * Dos números que la gente usa para decidir: cuánto se le debe a cada proveedor y cuánto
 * cuesta cada tipo de obligación al mes. Lo que se prueba es que midan lo que dicen
 * medir —la detracción fuera, porque esa no se le paga al proveedor; el total del mes
 * sin encogerse a medida que se va pagando— y que los filtros los acoten de verdad.
 *
 *   npx tsx --conditions=react-server tests/totales.test.ts
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { obligationInstallments, obligations, supplierInvoices, suppliers } from "../src/db/schema";
import { netoAPagar, saldoAPagar, todayLima } from "../src/lib/utils";
import { detractionFields } from "../src/server/invoice-service";
import { listObligations } from "../src/server/obligation-queries";
import { listSuppliers, supplierTotals } from "../src/server/invoice-queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const RUC = `20${SELLO}777`.slice(0, 11);
const MES = todayLima().slice(0, 7);

async function limpiar() {
  const prov = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.ruc, RUC));
  for (const p of prov) {
    await db.delete(supplierInvoices).where(eq(supplierInvoices.supplierId, p.id));
    await db.delete(suppliers).where(eq(suppliers.id, p.id));
  }
  const obl = await db.select({ id: obligations.id }).from(obligations)
    .where(sql`${obligations.name} like ${"TOT " + SELLO + "%"}`);
  for (const o of obl) {
    await db.delete(obligationInstallments).where(eq(obligationInstallments.obligationId, o.id));
    await db.delete(obligations).where(eq(obligations.id, o.id));
  }
}

async function main() {
  await limpiar();

  // ---------- Lo que se le debe a un proveedor ----------
  const [proveedor] = await db.insert(suppliers).values({
    ruc: RUC, businessName: `TRANSPORTES TOTALES ${SELLO} S.A.C.`,
  }).returning();

  // Tres facturas: una por pagar con detracción, una pagada y una anulada.
  const base = {
    supplierId: proveedor.id, docType: "FACTURA" as const, currency: "PEN",
    issueDate: `${MES}-10`, termDays: 15,
  };
  await db.insert(supplierInvoices).values([
    { ...base, series: "TT01", number: `${SELLO}1`, total: "1180.00", detractionAmount: "47.00", status: "PENDIENTE", destinationCity: "TRUJILLO" },
    { ...base, series: "TT01", number: `${SELLO}2`, total: "2360.00", detractionAmount: "94.00", status: "PAGADA", paidAt: `${MES}-20`, destinationCity: "AREQUIPA" },
    // Una anulada no se le debe a nadie: si entrara en el total, se estaría reclamando
    // plata que ya se decidió que no se paga.
    { ...base, series: "TT01", number: `${SELLO}3`, total: "5000.00", detractionAmount: "200.00", status: "ANULADA", destinationCity: "TRUJILLO" },
  ]);

  const { rows } = await listSuppliers({ q: `TOTALES ${SELLO}` });
  const fila = rows.find((r) => r.ruc === RUC);
  check("el proveedor aparece con sus totales", !!fila, rows.length);
  check("lo pendiente descuenta la detracción", fila?.pendingPen === "1133.00", fila?.pendingPen);
  check("lo pagado también", fila?.paidPen === "2266.00", fila?.paidPen);
  check("la factura anulada no cuenta", fila?.invoiceCount === 2, fila?.invoiceCount);
  check("una sola pendiente", fila?.pendingCount === 1, fila?.pendingCount);
  check("y una sola pagada", fila?.paidCount === 1, fila?.paidCount);
  check("sin dólares de por medio, el total en dólares es cero",
    fila?.pendingUsd === "0" || Number(fila?.pendingUsd) === 0, fila?.pendingUsd);

  // Con un adelanto entregado, lo que se le debe baja: esa parte ya la recibió.
  await db.update(supplierInvoices).set({ advances: "600.00" })
    .where(and(eq(supplierInvoices.series, "TT01"), eq(supplierInvoices.number, `${SELLO}1`)));
  const conAdelanto = await supplierTotals({ q: `TOTALES ${SELLO}` });
  check("el adelanto baja lo que se le debe", conAdelanto.pendingPen === "533.00", conAdelanto.pendingPen);
  check("pero lo pagado no cambia: el adelanto también se le pagó",
    conAdelanto.paidPen === "2266.00", conAdelanto.paidPen);
  await db.update(supplierInvoices).set({ advances: null })
    .where(and(eq(supplierInvoices.series, "TT01"), eq(supplierInvoices.number, `${SELLO}1`)));

  // El neto que muestra la pantalla sale de la misma cuenta.
  check("el neto a pagar coincide con lo que muestra la factura",
    netoAPagar("1180.00", "47.00") === "1133.00", netoAPagar("1180.00", "47.00"));

  // ---------- Segmentar por destino y por fecha ----------
  const porDestino = await supplierTotals({ q: `TOTALES ${SELLO}`, destino: "TRUJILLO" });
  check("filtrando por destino solo queda lo de ese destino",
    porDestino.pendingPen === "1133.00" && porDestino.paidPen === "0", porDestino);

  const otroDestino = await supplierTotals({ q: `TOTALES ${SELLO}`, destino: "AREQUIPA" });
  check("y el otro destino trae lo suyo",
    otroDestino.paidPen === "2266.00" && otroDestino.pendingPen === "0", otroDestino);

  const fuera = await supplierTotals({ q: `TOTALES ${SELLO}`, from: `${MES}-20`, to: `${MES}-28` });
  check("un rango de fechas sin facturas da cero", Number(fuera.pendingPen) === 0 && fuera.facturas === 0, fuera);

  const dentro = await supplierTotals({ q: `TOTALES ${SELLO}`, from: `${MES}-01`, to: `${MES}-28` });
  check("y el rango que las contiene las trae todas", dentro.facturas === 2, dentro);

  // ---------- El adelanto se descuenta del pago ----------
  // Un adelanto es plata que el proveedor ya recibió: pagarle el neto completo sería
  // pagarle dos veces la misma parte.
  check("sin adelanto, el saldo es el neto",
    saldoAPagar("1180.00", "47.00", null) === "1133.00", saldoAPagar("1180.00", "47.00", null));
  check("con adelanto, el saldo lo descuenta",
    saldoAPagar("1180.00", "47.00", "500.00") === "633.00", saldoAPagar("1180.00", "47.00", "500.00"));
  check("un adelanto que cubre todo deja saldo cero, no negativo",
    saldoAPagar("1180.00", "47.00", "2000.00") === "0.00", saldoAPagar("1180.00", "47.00", "2000.00"));
  check("sin detracción ni adelanto, el saldo es el total",
    saldoAPagar("500.00", null, null) === "500.00", saldoAPagar("500.00", null, null));

  // ---------- La detracción es solo del transporte ----------
  const flete = detractionFields("5000.00", "PEN", "TRANSPORTE");
  check("un flete sobre el umbral se detrae",
    flete.detractionStatus === "PENDIENTE" && Number(flete.detractionAmount) === 200, flete);

  const servicio = detractionFields("5000.00", "PEN", "SERVICIO");
  check("el mismo importe, siendo servicio, no se detrae",
    servicio.detractionStatus === "NO_APLICA" && Number(servicio.detractionAmount) === 0, servicio);

  // El umbral de SUNAT son S/ 400: por debajo no se deposita nada.
  const chico = detractionFields("400.00", "PEN", "TRANSPORTE");
  check("un flete por debajo del umbral tampoco se detrae",
    chico.detractionStatus === "NO_APLICA", chico);

  const dolares = detractionFields("5000.00", "USD", "TRANSPORTE");
  check("en dólares se sigue tratando a mano", dolares.detractionStatus === "NO_APLICA", dolares);

  const sinClasificar = detractionFields("5000.00", "PEN", null);
  check("sin clasificar se calcula como antes, para no perder las viejas",
    sinClasificar.detractionStatus === "PENDIENTE", sinClasificar);

  // ---------- El total del mes de una obligación ----------
  // Una cochera de 300 al mes: dos cuotas en el mes, una pagada y otra no. Lo pendiente
  // dice 300, pero el mes cuesta 600, y eso es lo que antes no se podía ver.
  const [cochera] = await db.insert(obligations).values({
    name: `TOT ${SELLO} Cochera`, creditor: "Estacionamiento de prueba", type: "COCHERA", status: "ACTIVA",
    currency: "PEN", fixedAmount: "300.00", billingDay: 5,
  }).returning();
  await db.insert(obligationInstallments).values([
    { obligationId: cochera.id, number: 1, dueDate: `${MES}-05`, total: "300.00", status: "PAGADA", paidAt: `${MES}-05`, paidAmount: "300.00" },
    { obligationId: cochera.id, number: 2, dueDate: `${MES}-20`, total: "300.00", status: "PENDIENTE" },
  ]);

  const obligaciones = await listObligations({ q: `TOT ${SELLO}` });
  const esta = obligaciones.find((o) => o.id === cochera.id);
  check("la obligación trae su total del mes", esta?.monthTotal === "600.00", esta?.monthTotal);
  check("y lo que ya se pagó de ese mes", esta?.monthPaid === "300.00", esta?.monthPaid);
  check("lo pendiente sigue siendo lo pendiente", esta?.monthAmount === "300.00", esta?.monthAmount);

  // Al pagar lo que faltaba, el pendiente se va a cero pero el mes sigue costando 600:
  // es justo el caso en que antes la pantalla decía cero y no había dónde mirar el gasto.
  await db.update(obligationInstallments)
    .set({ status: "PAGADA", paidAt: `${MES}-20`, paidAmount: "300.00" })
    .where(eq(obligationInstallments.obligationId, cochera.id));
  const [despues] = await listObligations({ q: `TOT ${SELLO}` });
  check("pagado todo, no queda nada pendiente", Number(despues?.monthAmount) === 0, despues?.monthAmount);
  check("pero el total del mes sigue siendo el mismo", despues?.monthTotal === "600.00", despues?.monthTotal);

  await limpiar();
  console.log(fails === 0 ? "\nTOTALES: todo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
