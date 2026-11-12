import "server-only";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { invoiceGuides, supplierInvoices, suppliers } from "@/db/schema";
import { PLAZO_TRANSPORTE_DIAS, separarGuias, vencimientoPorGuias, type GuiaTipo } from "@/lib/guias";
import { first, todayLima, type SearchParamsRecord } from "@/lib/utils";

/**
 * Las guías de las facturas de transporte y el viaje de terceros que se ve en Salidas.
 *
 * La regla: una factura de transporte con guías anotadas se paga 15 días después de que
 * llega la última. Todo lo que cambia una guía pasa por aplicarReglaGuias, que deja la
 * condición, la fecha de la guía y la fecha límite de la factura de acuerdo con eso.
 */

export function recepcionYmd(row: { receivedAt: Date | null; createdAt: Date }) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(row.receivedAt ?? row.createdAt);
}

/**
 * Las guías con las que nace una factura de transporte: la guía transportista que emite el
 * proveedor (la que tiene que entregar). La del remitente no se le pide: se guarda en la
 * factura como dato, pero no queda "por llegar". Si no hay número, queda una guía sin
 * número: así igual figura que falta traerla.
 */
export async function crearGuiasIniciales(
  tx: Tx,
  invoiceId: string,
  datos: { grtNumber?: string | null; dispatchNote?: string | null; guideReceivedAt?: string | null },
  userId: string | null,
) {
  const filas: { kind: GuiaTipo; number: string | null }[] =
    separarGuias(datos.grtNumber).map((n) => ({ kind: "TRANSPORTISTA" as const, number: n }));
  // Un mismo número en los dos campos es una sola guía.
  const unicas = filas.filter((f, i) => filas.findIndex((g) => g.number === f.number) === i);
  const aCrear = unicas.length ? unicas : [{ kind: "TRANSPORTISTA" as const, number: null }];
  await tx.insert(invoiceGuides).values(aCrear.map((g) => ({
    invoiceId,
    kind: g.kind,
    number: g.number,
    receivedAt: datos.guideReceivedAt ?? null,
    receivedBy: datos.guideReceivedAt ? userId : null,
    createdBy: userId,
  })));
}

/** Agrega las guías nuevas que aparezcan escritas en la factura, sin tocar las que ya están. */
export async function agregarGuiasEscritas(
  tx: Tx,
  invoiceId: string,
  datos: { grtNumber?: string | null; dispatchNote?: string | null },
  userId: string | null,
) {
  const actuales = await tx.select({ id: invoiceGuides.id, number: invoiceGuides.number, receivedAt: invoiceGuides.receivedAt })
    .from(invoiceGuides).where(eq(invoiceGuides.invoiceId, invoiceId));
  const ya = new Set(actuales.map((g) => g.number?.toUpperCase()).filter(Boolean));
  const nuevas = separarGuias(datos.grtNumber).map((n) => ({ kind: "TRANSPORTISTA" as const, number: n })).filter((g, i, arr) => !ya.has(g.number) && arr.findIndex((x) => x.number === g.number) === i);
  if (!nuevas.length) return;
  // Si solo había la guía sin número y todavía no llegó, la primera escrita ocupa su lugar.
  const sinNumero = actuales.find((g) => !g.number && !g.receivedAt);
  if (sinNumero) {
    const [primera, ...resto] = nuevas;
    await tx.update(invoiceGuides).set({ number: primera.number, kind: primera.kind, updatedAt: new Date() })
      .where(eq(invoiceGuides.id, sinNumero.id));
    nuevas.splice(0, nuevas.length, ...resto);
  }
  if (nuevas.length) {
    await tx.insert(invoiceGuides).values(nuevas.map((g) => ({ invoiceId, kind: g.kind, number: g.number, createdBy: userId })));
  }
}

/**
 * Deja la factura de acuerdo con sus guías: a crédito de 15 días, con la fecha de la última
 * guía y la fecha límite que da. Solo para facturas de transporte con guías anotadas; las
 * demás (y las de antes de este cambio) siguen con su condición.
 */
export async function aplicarReglaGuias(tx: Tx, invoiceId: string) {
  const [factura] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId)).limit(1);
  if (!factura || factura.serviceType !== "TRANSPORTE") return factura ?? null;
  const guias = await tx.select({ receivedAt: invoiceGuides.receivedAt }).from(invoiceGuides)
    .where(eq(invoiceGuides.invoiceId, invoiceId));
  if (!guias.length) return factura;

  const v = vencimientoPorGuias(guias, recepcionYmd(factura));
  const [row] = await tx.update(supplierInvoices).set({
    paymentTerm: "CREDITO",
    termDays: PLAZO_TRANSPORTE_DIAS,
    guideReceivedAt: v.guideReceivedAt,
    // Una ya pagada conserva la fecha con la que se pagó.
    ...(factura.status === "PENDIENTE" ? { payDueDate: v.payDueDate } : {}),
    updatedAt: new Date(),
  }).where(eq(supplierInvoices.id, invoiceId)).returning();
  return row;
}

export async function guiasDeFacturas(ids: string[]) {
  const mapa = new Map<string, GuiaFila[]>();
  if (!ids.length) return mapa;
  const filas = await db.select({
    id: invoiceGuides.id,
    invoiceId: invoiceGuides.invoiceId,
    kind: invoiceGuides.kind,
    number: invoiceGuides.number,
    receivedAt: sql<string | null>`${invoiceGuides.receivedAt}::text`,
    notes: invoiceGuides.notes,
  }).from(invoiceGuides)
    .where(inArray(invoiceGuides.invoiceId, ids))
    .orderBy(asc(invoiceGuides.createdAt), asc(invoiceGuides.number));
  for (const { invoiceId, ...g } of filas) mapa.set(invoiceId, [...(mapa.get(invoiceId) ?? []), g]);
  return mapa;
}

export type GuiaFila = { id: string; kind: GuiaTipo; number: string | null; receivedAt: string | null; notes: string | null };

// --- Viajes de terceros (la pestaña de Salidas) ---

export type TercerosFiltros = {
  /** GUIAS: falta alguna guía. POR_PAGAR: llegaron todas y falta pagar. TODAS. */
  estado: "GUIAS" | "POR_PAGAR" | "TODAS";
  q?: string;
  desde?: string;
  hasta?: string;
};

const isYmd = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function readTercerosFiltros(sp: SearchParamsRecord): TercerosFiltros {
  const estado = first(sp.estado);
  return {
    // El filtro abre en "Esperando guía", que llega vacío.
    estado: estado === "POR_PAGAR" ? "POR_PAGAR" : estado === "TODAS" ? "TODAS" : "GUIAS",
    q: first(sp.q)?.trim() || undefined,
    desde: isYmd(first(sp.desde)) ? first(sp.desde) : undefined,
    hasta: isYmd(first(sp.hasta)) ? first(sp.hasta) : undefined,
  };
}

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const faltaGuia = sql`exists (select 1 from invoice_guides g where g.invoice_id = "supplier_invoices"."id" and g.received_at is null)`;
// Las de antes de este cambio no tienen guías en la lista: cuenta la fecha de guía que se
// anotaba a mano, si la tienen.
const sinGuias = sql`(not exists (select 1 from invoice_guides g where g.invoice_id = "supplier_invoices"."id")
  and "supplier_invoices"."guide_received_at" is null)`;

function condicionesTerceros(f: TercerosFiltros): SQL | undefined {
  const fecha = sql`coalesce(${supplierInvoices.serviceDate}, ${supplierInvoices.issueDate})`;
  return and(
    eq(supplierInvoices.serviceType, "TRANSPORTE"),
    sql`${supplierInvoices.docType} <> 'NOTA_CREDITO'`,
    sql`${supplierInvoices.status} <> 'ANULADA'`,
    f.estado === "GUIAS" ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`(${faltaGuia} or ${sinGuias})`) : undefined,
    f.estado === "POR_PAGAR" ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`not (${faltaGuia} or ${sinGuias})`) : undefined,
    f.desde ? sql`${fecha} >= ${f.desde}` : undefined,
    f.hasta ? sql`${fecha} <= ${f.hasta}` : undefined,
    f.q
      ? sql`(upper(coalesce(${supplierInvoices.plate}, '') || ' ' || coalesce(${supplierInvoices.clientName}, '') || ' '
          || coalesce(${supplierInvoices.destinationCity}, '') || ' ' || coalesce(${supplierInvoices.originCity}, '') || ' '
          || ${suppliers.businessName} || ' ' || ${supplierInvoices.series} || '-' || ${supplierInvoices.number}) like upper(${like(f.q)})
          or exists (select 1 from invoice_guides g where g.invoice_id = "supplier_invoices"."id" and upper(coalesce(g.number, '')) like upper(${like(f.q)})))`
      : undefined,
  );
}

export async function listarViajesTerceros(f: TercerosFiltros, limit = 200) {
  const filas = await db.select({
    id: supplierInvoices.id,
    series: supplierInvoices.series,
    number: supplierInvoices.number,
    issueDate: supplierInvoices.issueDate,
    serviceDate: supplierInvoices.serviceDate,
    currency: supplierInvoices.currency,
    total: supplierInvoices.total,
    status: supplierInvoices.status,
    plate: supplierInvoices.plate,
    clientName: supplierInvoices.clientName,
    originCity: supplierInvoices.originCity,
    destinationCity: supplierInvoices.destinationCity,
    guideReceivedAt: supplierInvoices.guideReceivedAt,
    payDueDate: supplierInvoices.payDueDate,
    paidAt: supplierInvoices.paidAt,
    supplierName: suppliers.businessName,
  }).from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .where(condicionesTerceros(f))
    .orderBy(
      // Lo que espera guía, lo más antiguo primero; lo que está por pagar, lo que vence antes.
      f.estado === "POR_PAGAR" ? asc(supplierInvoices.payDueDate) : asc(sql`coalesce(${supplierInvoices.serviceDate}, ${supplierInvoices.issueDate})`),
      desc(supplierInvoices.createdAt),
    )
    .limit(limit);
  const guias = await guiasDeFacturas(filas.map((r) => r.id));
  const hoy = todayLima();
  return filas.map((r) => ({ ...r, guias: guias.get(r.id) ?? [], hoy }));
}

export type ViajeTercero = Awaited<ReturnType<typeof listarViajesTerceros>>[number];

/** Cuántas facturas esperan guía, para el botón de la pestaña. */
export async function resumenTerceros() {
  const [row] = await db.select({
    esperandoGuia: sql<number>`count(*) filter (where ${faltaGuia} or ${sinGuias})::int`,
    porPagar: sql<number>`count(*) filter (where not (${faltaGuia} or ${sinGuias}))::int`,
  }).from(supplierInvoices)
    .where(and(
      eq(supplierInvoices.serviceType, "TRANSPORTE"),
      eq(supplierInvoices.status, "PENDIENTE"),
      sql`${supplierInvoices.docType} <> 'NOTA_CREDITO'`,
    ));
  return row ?? { esperandoGuia: 0, porPagar: 0 };
}

