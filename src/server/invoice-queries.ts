import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  invoiceAdvances, invoiceAttachments, invoiceEmails, supplierInvoices, suppliers, users,
  type DetractionStatus, type InvoiceDocType, type InvoiceEmailStatus, type InvoiceStatus,
} from "@/db/schema";
import { first, INVOICE_EMAIL_STATUSES, isYmd, type SearchParamsRecord } from "@/lib/utils";

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** Fecha en que llegó la factura, en horario de Lima. Desde aquí corre el plazo de pago. */
const reception = sql`((coalesce(${supplierInvoices.receivedAt}, ${supplierInvoices.createdAt}) at time zone 'America/Lima')::date)`;

/** Hoy en Lima. Las fechas límite se comparan siempre contra esto, no contra UTC. */
const today = sql`((now() at time zone 'America/Lima')::date)`;

/**
 * Drizzle escribe `${tabla.columna}` dentro de un sql`` crudo como `"columna"`, sin el
 * nombre de la tabla. Dentro de una subconsulta correlacionada eso se resuelve contra la
 * tabla interna: `a.invoice_id = ${laFactura}` comparaba el adjunto consigo
 * mismo y el contador daba siempre cero. Hay que calificar la columna a mano.
 */
const laFactura = sql.raw('"supplier_invoices"."id"');
const elProveedor = sql.raw('"suppliers"."id"');

const payer = alias(users, "payer");
const creator = alias(users, "creator");

export type InvoiceFilters = {
  q?: string;
  supplierId?: string;
  status?: InvoiceStatus;
  docType?: InvoiceDocType;
  currency?: "PEN" | "USD";
  source?: "MANUAL" | "CORREO";
  from?: string;
  to?: string;
  /** Solo las pendientes cuya fecha límite de pago ya pasó. */
  overdue?: boolean;
  /** Solo las pendientes que vencen hoy o en los próximos tres días. */
  dueSoon?: boolean;
  /** Solo las de crédito que aún esperan la entrega física de la guía. */
  awaitingGuide?: boolean;
  /** Solo contado o solo crédito. */
  paymentTerm?: "CONTADO" | "CREDITO";
  /** Estado del depósito de la detracción. */
  detraction?: DetractionStatus;
  /** Cliente de Transjer para el que se hizo el flete. */
  client?: string;
  /** Solo las anuladas que todavía esperan la nota de crédito del proveedor. */
  awaitingCreditNote?: boolean;
};

const STATUSES: InvoiceStatus[] = ["PENDIENTE", "PAGADA", "OBSERVADA", "ANULADA"];
const DOC_TYPES: InvoiceDocType[] = ["FACTURA", "BOLETA", "NOTA_CREDITO", "NOTA_DEBITO"];
const DETRACTION_STATUSES: DetractionStatus[] = ["NO_APLICA", "PENDIENTE", "EN_PROCESO", "PAGADA", "OBSERVADA"];

export function readInvoiceFilters(sp: SearchParamsRecord): InvoiceFilters {
  // La pestaña "SIN_NC" no es un estado de la factura: es un filtro aparte, el de las
  // anuladas a las que todavía les falta la nota de crédito.
  const pestana = first(sp.estado);
  const status = pestana as InvoiceStatus | undefined;
  const docType = first(sp.tipo) as InvoiceDocType | undefined;
  const currency = first(sp.moneda);
  const source = first(sp.origen);
  const from = first(sp.from);
  const to = first(sp.to);
  const paymentTerm = first(sp.condicion);
  const detraction = first(sp.detraccion) as DetractionStatus | undefined;
  return {
    detraction: detraction && DETRACTION_STATUSES.includes(detraction) ? detraction : undefined,
    client: first(sp.cliente) || undefined,
    paymentTerm: paymentTerm === "CONTADO" || paymentTerm === "CREDITO" ? paymentTerm : undefined,
    q: first(sp.q)?.trim() || undefined,
    supplierId: first(sp.proveedor) || undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    docType: docType && DOC_TYPES.includes(docType) ? docType : undefined,
    currency: currency === "PEN" || currency === "USD" ? currency : undefined,
    source: source === "MANUAL" || source === "CORREO" ? source : undefined,
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
    overdue: first(sp.vencidas) === "1" || undefined,
    dueSoon: first(sp.porvencer) === "1" || undefined,
    awaitingGuide: first(sp.singuia) === "1" || undefined,
    // "SIN_NC" no es un estado de la factura sino una pestaña: las anuladas a las que
    // todavía les falta la nota de crédito del proveedor.
    awaitingCreditNote: first(sp.sinnc) === "1" || pestana === "SIN_NC" || undefined,
  };
}

function invoiceConditions(f: InvoiceFilters): SQL | undefined {
  return and(
    f.supplierId ? eq(supplierInvoices.supplierId, f.supplierId) : undefined,
    f.status ? eq(supplierInvoices.status, f.status) : undefined,
    f.docType ? eq(supplierInvoices.docType, f.docType) : undefined,
    f.currency ? eq(supplierInvoices.currency, f.currency) : undefined,
    f.source ? eq(supplierInvoices.source, f.source) : undefined,
    f.from ? gte(supplierInvoices.issueDate, f.from) : undefined,
    f.to ? lte(supplierInvoices.issueDate, f.to) : undefined,
    f.paymentTerm ? eq(supplierInvoices.paymentTerm, f.paymentTerm) : undefined,
    f.awaitingCreditNote ? eq(supplierInvoices.awaitingCreditNote, true) : undefined,
    // Una factura anulada no genera depósito, así que no estorba en la lista de detracciones.
    f.detraction ? and(eq(supplierInvoices.detractionStatus, f.detraction), ne(supplierInvoices.status, "ANULADA")) : undefined,
    f.client ? eq(supplierInvoices.clientName, f.client) : undefined,
    f.overdue
      ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`${supplierInvoices.payDueDate} < ${today}`)
      : undefined,
    f.dueSoon
      ? and(
          eq(supplierInvoices.status, "PENDIENTE"),
          sql`${supplierInvoices.payDueDate} between ${today} and ${today} + 3`,
        )
      : undefined,
    f.awaitingGuide
      ? and(
          eq(supplierInvoices.status, "PENDIENTE"),
          eq(supplierInvoices.paymentTerm, "CREDITO"),
          sql`${supplierInvoices.guideReceivedAt} is null`,
        )
      : undefined,
    f.q
      ? or(
          ilike(sql`${supplierInvoices.series} || '-' || ${supplierInvoices.number}`, like(f.q)),
          ilike(supplierInvoices.number, like(f.q)),
          ilike(suppliers.businessName, like(f.q)),
          ilike(suppliers.ruc, like(f.q)),
          ilike(supplierInvoices.grtNumber, like(f.q)),
          ilike(supplierInvoices.description, like(f.q)),
          ilike(supplierInvoices.plate, like(f.q)),
          ilike(supplierInvoices.clientName, like(f.q)),
          ilike(supplierInvoices.detractionReceipt, like(f.q)),
        )
      : undefined,
  );
}

const invoiceColumns = {
  id: supplierInvoices.id,
  docType: supplierInvoices.docType,
  series: supplierInvoices.series,
  number: supplierInvoices.number,
  issueDate: supplierInvoices.issueDate,
  dueDate: supplierInvoices.dueDate,
  serviceDate: supplierInvoices.serviceDate,
  currency: supplierInvoices.currency,
  subtotal: supplierInvoices.subtotal,
  igv: supplierInvoices.igv,
  total: supplierInvoices.total,
  description: supplierInvoices.description,
  grtNumber: supplierInvoices.grtNumber,
  status: supplierInvoices.status,
  paidAt: supplierInvoices.paidAt,
  paymentReference: supplierInvoices.paymentReference,
  paymentNotes: supplierInvoices.paymentNotes,
  statusReason: supplierInvoices.statusReason,
  // La nota de crédito que anula la factura, y la marca de que todavía se la espera.
  creditNoteNumber: supplierInvoices.creditNoteNumber,
  creditNoteDate: supplierInvoices.creditNoteDate,
  creditNoteAmount: supplierInvoices.creditNoteAmount,
  creditNoteRegisteredAt: supplierInvoices.creditNoteRegisteredAt,
  awaitingCreditNote: supplierInvoices.awaitingCreditNote,
  source: supplierInvoices.source,
  receivedAt: supplierInvoices.receivedAt,
  serviceType: supplierInvoices.serviceType,
  dispatchNote: supplierInvoices.dispatchNote,
  contactName: supplierInvoices.contactName,
  plate: supplierInvoices.plate,
  clientName: supplierInvoices.clientName,
  originCity: supplierInvoices.originCity,
  destinationCity: supplierInvoices.destinationCity,
  volumeM3: supplierInvoices.volumeM3,
  weightTn: supplierInvoices.weightTn,
  advances: supplierInvoices.advances,
  detractionRate: supplierInvoices.detractionRate,
  detractionAmount: supplierInvoices.detractionAmount,
  detractionStatus: supplierInvoices.detractionStatus,
  detractionPaidAt: supplierInvoices.detractionPaidAt,
  detractionReceipt: supplierInvoices.detractionReceipt,
  detractionOperation: supplierInvoices.detractionOperation,
  detractionNotes: supplierInvoices.detractionNotes,
  detractionProofId: supplierInvoices.detractionProofId,
  paymentProofId: supplierInvoices.paymentProofId,
  paymentTerm: supplierInvoices.paymentTerm,
  termDays: supplierInvoices.termDays,
  guideReceivedAt: supplierInvoices.guideReceivedAt,
  payDueDate: supplierInvoices.payDueDate,
  notes: supplierInvoices.notes,
  isDemo: supplierInvoices.isDemo,
  createdAt: supplierInvoices.createdAt,
  supplierId: suppliers.id,
  supplierRuc: suppliers.ruc,
  supplierName: suppliers.businessName,
  paidByName: payer.name,
  createdByName: creator.name,
  attachmentCount: sql<number>`(select count(*)::int from ${invoiceAttachments} a where a.invoice_id = ${laFactura})`,
  receptionDate: sql<string>`${reception}::text`,
};

export async function listInvoices(f: InvoiceFilters, limit = 20, offset = 0) {
  const where = invoiceConditions(f);
  const [rows, [totals]] = await Promise.all([
    db.select(invoiceColumns)
      .from(supplierInvoices)
      .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .leftJoin(payer, eq(supplierInvoices.paidBy, payer.id))
      .leftJoin(creator, eq(supplierInvoices.createdBy, creator.id))
      .where(where)
      .orderBy(desc(supplierInvoices.issueDate), desc(supplierInvoices.createdAt))
      .limit(limit).offset(offset),
    db.select({ total: count() })
      .from(supplierInvoices)
      .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

/** Totales por moneda y estado para las tarjetas de resumen. */
export async function invoiceTotals(f: InvoiceFilters) {
  const rows = await db
    .select({
      currency: supplierInvoices.currency,
      status: supplierInvoices.status,
      cantidad: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}), 0)::text`,
    })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(invoiceConditions(f))
    .groupBy(supplierInvoices.currency, supplierInvoices.status);
  return rows;
}

export async function getInvoice(id: string) {
  const [row] = await db.select(invoiceColumns)
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .leftJoin(payer, eq(supplierInvoices.paidBy, payer.id))
    .leftJoin(creator, eq(supplierInvoices.createdBy, creator.id))
    .where(eq(supplierInvoices.id, id))
    .limit(1);
  return row ?? null;
}

export async function listInvoiceAttachments(invoiceId: string) {
  return db.select({
    id: invoiceAttachments.id,
    kind: invoiceAttachments.kind,
    filename: invoiceAttachments.filename,
    contentType: invoiceAttachments.contentType,
    sizeBytes: invoiceAttachments.sizeBytes,
    createdAt: invoiceAttachments.createdAt,
    uploadedByName: users.name,
  })
    .from(invoiceAttachments)
    .leftJoin(users, eq(invoiceAttachments.uploadedBy, users.id))
    .where(eq(invoiceAttachments.invoiceId, invoiceId))
    .orderBy(asc(invoiceAttachments.kind), asc(invoiceAttachments.createdAt));
}

/**
 * Los adelantos entregados a cuenta de una factura, del más reciente al más antiguo.
 *
 * Cada uno trae su voucher, que es lo que se mira cuando el proveedor dice que no le
 * llegó: la captura está al lado del importe y de la fecha, no suelta entre los archivos.
 */
export async function listInvoiceAdvances(invoiceId: string) {
  return db.select({
    id: invoiceAdvances.id,
    amount: invoiceAdvances.amount,
    paidAt: invoiceAdvances.paidAt,
    paymentReference: invoiceAdvances.paymentReference,
    notes: invoiceAdvances.notes,
    proofId: invoiceAdvances.proofId,
    paidByName: users.name,
    createdAt: invoiceAdvances.createdAt,
  })
    .from(invoiceAdvances)
    .leftJoin(users, eq(invoiceAdvances.paidBy, users.id))
    .where(eq(invoiceAdvances.invoiceId, invoiceId))
    .orderBy(desc(invoiceAdvances.paidAt), desc(invoiceAdvances.createdAt));
}

/** Correo del que provino la factura, si llegó por el buzón. */
const verificador = alias(users, "verificador");

export async function getInvoiceEmail(invoiceId: string) {
  const [row] = await db.select({
    id: invoiceEmails.id,
    subject: invoiceEmails.subject,
    fromAddress: invoiceEmails.fromAddress,
    fromName: invoiceEmails.fromName,
    receivedAt: invoiceEmails.receivedAt,
    status: invoiceEmails.status,
    // El rechazo, para poder explicarlo desde la factura sin ir a buscar el correo: por
    // qué se devolvió, qué se le dijo al proveedor, y si el aviso llegó a salir.
    rejectReason: invoiceEmails.rejectReason,
    rejectComment: invoiceEmails.rejectComment,
    // El filtro del monto que pasó antes de aceptarse: cuánto se había pactado y qué se
    // dijo si no coincidía. Es lo que explica, desde la factura, por qué se pagó esto.
    agreedAmount: invoiceEmails.agreedAmount,
    amountStatus: invoiceEmails.amountStatus,
    amountNote: invoiceEmails.amountNote,
    amountCheckedByName: verificador.name,
    amountCheckedAt: invoiceEmails.amountCheckedAt,
    decidedAt: invoiceEmails.decidedAt,
    decidedByName: users.name,
    replyTo: invoiceEmails.replyTo,
    replyBody: invoiceEmails.replyBody,
    replySentAt: invoiceEmails.replySentAt,
    replyError: invoiceEmails.replyError,
  }).from(invoiceEmails)
    .leftJoin(users, eq(invoiceEmails.decidedBy, users.id))
    .leftJoin(verificador, eq(invoiceEmails.amountCheckedBy, verificador.id))
    .where(eq(invoiceEmails.invoiceId, invoiceId)).limit(1);
  return row ?? null;
}

// ---------- Proveedores ----------

export type SupplierFilters = {
  q?: string;
  active?: boolean;
  /** Las facturas que entran en los totales: por fecha de emisión y por destino. */
  from?: string;
  to?: string;
  destino?: string;
};

/**
 * Los totales de cada proveedor, acotados a lo que se esté mirando.
 *
 * El mismo tramo de SQL se usa para la fila de cada proveedor y para el resumen de
 * arriba, para que los dos números no puedan contradecirse. La detracción se descuenta
 * porque es lo que de verdad se le paga al proveedor: lo otro va al Banco de la Nación.
 */
function facturasDelProveedor(f: SupplierFilters, columna = elProveedor) {
  const condiciones = [sql`i.supplier_id = ${columna}`, sql`i.status <> 'ANULADA'`];
  if (f.from) condiciones.push(sql`i.issue_date >= ${f.from}::date`);
  if (f.to) condiciones.push(sql`i.issue_date <= ${f.to}::date`);
  if (f.destino) condiciones.push(sql`i.destination_city = ${f.destino}`);
  return sql.join(condiciones, sql` and `);
}

/** Lo que se le transfiere al proveedor: sin la detracción, que va al banco. */
const neto = sql`(i.total - coalesce(i.detraction_amount, 0))`;
/** Y lo que todavía falta transferirle: además, sin lo que ya se le adelantó. */
const saldo = sql`greatest(i.total - coalesce(i.detraction_amount, 0) - coalesce(i.advances, 0), 0)`;

export async function listSuppliers(opts: SupplierFilters = {}, limit = 20, offset = 0) {
  const where = and(
    opts.active !== undefined ? eq(suppliers.active, opts.active) : undefined,
    opts.q ? or(ilike(suppliers.businessName, like(opts.q)), ilike(suppliers.ruc, like(opts.q)), ilike(suppliers.tradeName, like(opts.q))) : undefined,
  );
  const suyas = facturasDelProveedor(opts);
  // Cada moneda por su lado: sumar soles con dólares daría un número que no es plata.
  const importe = (estado: "PENDIENTE" | "PAGADA", moneda: "PEN" | "USD") => sql<string>`(
    select coalesce(sum(${estado === "PAGADA" ? neto : saldo}), 0)::text from ${supplierInvoices} i
    where ${suyas} and i.currency = ${moneda}
      and ${estado === "PAGADA" ? sql`i.status = 'PAGADA'` : sql`i.status in ('PENDIENTE','OBSERVADA')`})`;
  const [rows, [totals]] = await Promise.all([
    db.select({
      id: suppliers.id,
      ruc: suppliers.ruc,
      businessName: suppliers.businessName,
      tradeName: suppliers.tradeName,
      email: suppliers.email,
      phone: suppliers.phone,
      contactName: suppliers.contactName,
      notes: suppliers.notes,
      defaultPaymentTerm: suppliers.defaultPaymentTerm,
      defaultTermDays: suppliers.defaultTermDays,
      active: suppliers.active,
      isDemo: suppliers.isDemo,
      invoiceCount: sql<number>`(select count(*)::int from ${supplierInvoices} i where ${suyas})`,
      pendingCount: sql<number>`(select count(*)::int from ${supplierInvoices} i where ${suyas} and i.status in ('PENDIENTE','OBSERVADA'))`,
      paidCount: sql<number>`(select count(*)::int from ${supplierInvoices} i where ${suyas} and i.status = 'PAGADA')`,
      pendingPen: importe("PENDIENTE", "PEN"),
      pendingUsd: importe("PENDIENTE", "USD"),
      paidPen: importe("PAGADA", "PEN"),
      paidUsd: importe("PAGADA", "USD"),
    }).from(suppliers).where(where).orderBy(asc(suppliers.businessName)).limit(limit).offset(offset),
    db.select({ total: count() }).from(suppliers).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

/**
 * El resumen de arriba: lo mismo que suman las filas, pero de TODOS los proveedores que
 * cumplen el filtro, no solo de los que caben en la página.
 */
export async function supplierTotals(f: SupplierFilters = {}) {
  const condiciones: SQL[] = [sql`${supplierInvoices.status} <> 'ANULADA'`];
  if (f.from) condiciones.push(sql`${supplierInvoices.issueDate} >= ${f.from}::date`);
  if (f.to) condiciones.push(sql`${supplierInvoices.issueDate} <= ${f.to}::date`);
  if (f.destino) condiciones.push(sql`${supplierInvoices.destinationCity} = ${f.destino}`);
  if (f.active !== undefined) condiciones.push(sql`${suppliers.active} = ${f.active}`);
  if (f.q) {
    condiciones.push(sql`(${ilike(suppliers.businessName, like(f.q))} or ${ilike(suppliers.ruc, like(f.q))})`);
  }

  // Lo pendiente descuenta además los adelantos ya entregados; lo pagado no, porque ese
  // adelanto también se le pagó a él.
  const importe = (estado: "PENDIENTE" | "PAGADA", moneda: "PEN" | "USD") => sql<string>`coalesce(sum(
    case when ${supplierInvoices.currency} = ${moneda}
      and ${estado === "PAGADA" ? sql`${supplierInvoices.status} = 'PAGADA'` : sql`${supplierInvoices.status} in ('PENDIENTE','OBSERVADA')`}
    then ${estado === "PAGADA"
      ? sql`(${supplierInvoices.total} - coalesce(${supplierInvoices.detractionAmount}, 0))`
      : sql`greatest(${supplierInvoices.total} - coalesce(${supplierInvoices.detractionAmount}, 0) - coalesce(${supplierInvoices.advances}, 0), 0)`}
    else 0 end), 0)::text`;

  const [fila] = await db.select({
    facturas: sql<number>`count(*)::int`,
    pendientes: sql<number>`count(*) filter (where ${supplierInvoices.status} in ('PENDIENTE','OBSERVADA'))::int`,
    pagadas: sql<number>`count(*) filter (where ${supplierInvoices.status} = 'PAGADA')::int`,
    pendingPen: importe("PENDIENTE", "PEN"),
    pendingUsd: importe("PENDIENTE", "USD"),
    paidPen: importe("PAGADA", "PEN"),
    paidUsd: importe("PAGADA", "USD"),
  })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(and(...condiciones));

  return fila ?? {
    facturas: 0, pendientes: 0, pagadas: 0,
    pendingPen: "0", pendingUsd: "0", paidPen: "0", paidUsd: "0",
  };
}

/** Los destinos ya usados, para el filtro. */
export async function getDestinationOptions() {
  const rows = await db.selectDistinct({ name: supplierInvoices.destinationCity })
    .from(supplierInvoices)
    .where(sql`${supplierInvoices.destinationCity} is not null and ${supplierInvoices.destinationCity} <> ''`)
    .orderBy(asc(supplierInvoices.destinationCity));
  return rows.map((r) => r.name!).filter(Boolean);
}

export async function getSupplierOptions() {
  return db.select({
    id: suppliers.id,
    ruc: suppliers.ruc,
    name: suppliers.businessName,
    active: suppliers.active,
    defaultPaymentTerm: suppliers.defaultPaymentTerm,
    defaultTermDays: suppliers.defaultTermDays,
  }).from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.businessName));
}

// ---------- Bandeja de correos ----------

export type EmailFilters = {
  q?: string;
  status?: InvoiceEmailStatus;
  /** En qué punto del filtro del monto está: lo que separa las dos primeras pestañas. */
  amount?: "POR_VERIFICAR" | "CONFORME";
  from?: string;
  to?: string;
};
const EMAIL_STATUSES: InvoiceEmailStatus[] = INVOICE_EMAIL_STATUSES;

/**
 * "Por verificar" no es un estado del correo, es un punto del camino.
 *
 * El comprobante que espera decisión pasa por dos manos seguidas: primero se compara el
 * importe con lo pactado, y recién después se acepta o se rechaza. Los dos momentos viven
 * dentro del mismo estado POR_APROBAR, así que la pestaña los separa por el filtro del
 * monto y no por el estado, que es lo que el resto del sistema ya entiende.
 */
export function readEmailFilters(sp: SearchParamsRecord): EmailFilters {
  const pestaña = first(sp.estado);
  const from = first(sp.from);
  const to = first(sp.to);
  const base = {
    q: first(sp.q)?.trim() || undefined,
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
  };
  if (pestaña === "POR_VERIFICAR") {
    return { ...base, status: "POR_APROBAR", amount: "POR_VERIFICAR" };
  }
  if (pestaña === "POR_APROBAR") {
    return { ...base, status: "POR_APROBAR", amount: "CONFORME" };
  }
  const status = pestaña as InvoiceEmailStatus | undefined;
  return { ...base, status: status && EMAIL_STATUSES.includes(status) ? status : undefined };
}

export async function listInvoiceEmails(f: EmailFilters, limit = 20, offset = 0) {
  // "Por revisar" junta REVISAR y ERROR: para quien mira son lo mismo —correos que el
  // sistema no pudo leer y alguien tiene que resolver— y separarlos haría que la pestaña
  // dijera un número y la lista mostrara otro.
  const where = and(
    f.status === "REVISAR" ? inArray(invoiceEmails.status, ["REVISAR", "ERROR"])
      : f.status ? eq(invoiceEmails.status, f.status) : undefined,
    f.amount === "POR_VERIFICAR" ? inArray(invoiceEmails.amountStatus, ["PENDIENTE", "OBSERVADO"])
      : f.amount === "CONFORME" ? eq(invoiceEmails.amountStatus, "CONFORME") : undefined,
    f.from ? gte(invoiceEmails.receivedAt, new Date(`${f.from}T00:00:00-05:00`)) : undefined,
    f.to ? lte(invoiceEmails.receivedAt, new Date(`${f.to}T23:59:59.999-05:00`)) : undefined,
    f.q ? or(ilike(invoiceEmails.subject, like(f.q)), ilike(invoiceEmails.fromAddress, like(f.q)), ilike(invoiceEmails.fromName, like(f.q))) : undefined,
  );
  const [rows, [totals]] = await Promise.all([
    db.select({
      id: invoiceEmails.id,
      subject: invoiceEmails.subject,
      fromAddress: invoiceEmails.fromAddress,
      fromName: invoiceEmails.fromName,
      receivedAt: invoiceEmails.receivedAt,
      status: invoiceEmails.status,
      detail: invoiceEmails.detail,
      attachmentCount: invoiceEmails.attachmentCount,
      invoiceId: invoiceEmails.invoiceId,
      invoiceSeries: supplierInvoices.series,
      invoiceNumber: supplierInvoices.number,
      supplierName: suppliers.businessName,
      // Los datos leídos del XML. Son los que se miran para aceptar o rechazar, así que
      // viajan con la fila: sin ellos habría que abrir cada correo para saber qué trae.
      parsed: invoiceEmails.parsed,
      agreedAmount: invoiceEmails.agreedAmount,
      amountStatus: invoiceEmails.amountStatus,
      amountNote: invoiceEmails.amountNote,
      amountCheckedAt: invoiceEmails.amountCheckedAt,
      rejectReason: invoiceEmails.rejectReason,
      rejectComment: invoiceEmails.rejectComment,
      replyTo: invoiceEmails.replyTo,
      replySentAt: invoiceEmails.replySentAt,
      replyError: invoiceEmails.replyError,
      decidedAt: invoiceEmails.decidedAt,
      decidedByName: users.name,
      internetMessageId: invoiceEmails.internetMessageId,
    })
      .from(invoiceEmails)
      .leftJoin(supplierInvoices, eq(invoiceEmails.invoiceId, supplierInvoices.id))
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .leftJoin(users, eq(invoiceEmails.decidedBy, users.id))
      .where(where)
      .orderBy(desc(invoiceEmails.receivedAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(invoiceEmails).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

/**
 * Cuántos correos hay en cada estado, para las pestañas.
 *
 * Lo que importa de verdad es el primer número: los comprobantes que están esperando que
 * alguien decida. Mientras ese número no sea cero, hay proveedores esperando respuesta.
 */
export async function emailCounts() {
  const [row] = await db.select({
    // Los dos pasos del camino: primero el filtro del monto, después la decisión.
    porVerificar: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'POR_APROBAR' and ${invoiceEmails.amountStatus} in ('PENDIENTE','OBSERVADO'))::int`,
    observados: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'POR_APROBAR' and ${invoiceEmails.amountStatus} = 'OBSERVADO')::int`,
    porAprobar: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'POR_APROBAR' and ${invoiceEmails.amountStatus} = 'CONFORME')::int`,
    esperando: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'POR_APROBAR')::int`,
    revisar: sql<number>`count(*) filter (where ${invoiceEmails.status} in ('REVISAR','ERROR'))::int`,
    aceptados: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'PROCESADO')::int`,
    rechazados: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'RECHAZADO')::int`,
    descartados: sql<number>`count(*) filter (where ${invoiceEmails.status} = 'DESCARTADO')::int`,
    total: sql<number>`count(*)::int`,
  }).from(invoiceEmails);
  return row ?? {
    porVerificar: 0, observados: 0, porAprobar: 0, esperando: 0,
    revisar: 0, aceptados: 0, rechazados: 0, descartados: 0, total: 0,
  };
}

/**
 * Correos que esperan a una persona: los que hay que aprobar y los que no se pudieron
 * leer. Es el número que sale en el menú, y mientras no sea cero hay trabajo pendiente.
 */
export async function countEmailsToReview() {
  const [row] = await db.select({ total: count() }).from(invoiceEmails)
    .where(inArray(invoiceEmails.status, ["POR_APROBAR", "REVISAR", "ERROR"]));
  return row?.total ?? 0;
}

/** Adjuntos de varios correos a la vez, agrupados por correo. */
export async function attachmentsByEmail(emailIds: string[]) {
  if (emailIds.length === 0) return new Map<string, { id: string; filename: string; sizeBytes: number; kind: string }[]>();
  const rows = await db.select({
    id: invoiceAttachments.id,
    emailId: invoiceAttachments.emailId,
    filename: invoiceAttachments.filename,
    sizeBytes: invoiceAttachments.sizeBytes,
    kind: invoiceAttachments.kind,
  }).from(invoiceAttachments).where(inArray(invoiceAttachments.emailId, emailIds)).orderBy(asc(invoiceAttachments.filename));

  const map = new Map<string, { id: string; filename: string; sizeBytes: number; kind: string }[]>();
  for (const r of rows) {
    if (!r.emailId) continue;
    const list = map.get(r.emailId) ?? [];
    list.push({ id: r.id, filename: r.filename, sizeBytes: r.sizeBytes, kind: r.kind });
    map.set(r.emailId, list);
  }
  return map;
}

export async function listEmailAttachments(emailId: string) {
  return db.select({
    id: invoiceAttachments.id,
    kind: invoiceAttachments.kind,
    filename: invoiceAttachments.filename,
    contentType: invoiceAttachments.contentType,
    sizeBytes: invoiceAttachments.sizeBytes,
  }).from(invoiceAttachments).where(eq(invoiceAttachments.emailId, emailId)).orderBy(asc(invoiceAttachments.filename));
}

/** Cuántas facturas anuladas siguen esperando la nota de crédito del proveedor. */
export async function countAwaitingCreditNote(f: InvoiceFilters = {}) {
  const [row] = await db.select({ total: count() })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(and(
      invoiceConditions({ ...f, status: undefined, awaitingCreditNote: true }),
      eq(supplierInvoices.awaitingCreditNote, true),
    ));
  return row?.total ?? 0;
}

// ---------- Resumen para el dashboard ----------

export async function getInvoiceSummary() {
  const pendiente = eq(supplierInvoices.status, "PENDIENTE");
  const [byStatus, [overdue], [dueSoon], [awaiting], toReview] = await Promise.all([
    db.select({
      status: supplierInvoices.status,
      currency: supplierInvoices.currency,
      cantidad: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}), 0)::text`,
    }).from(supplierInvoices).where(ne(supplierInvoices.status, "ANULADA"))
      .groupBy(supplierInvoices.status, supplierInvoices.currency),
    // Vencidas: su fecha límite ya pasó y siguen sin pagarse.
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}) filter (where ${supplierInvoices.currency} = 'PEN'), 0)::text`,
    }).from(supplierInvoices)
      .where(and(pendiente, sql`${supplierInvoices.payDueDate} < ${today}`)),
    // Vencen hoy o en los próximos tres días.
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}) filter (where ${supplierInvoices.currency} = 'PEN'), 0)::text`,
      importeUsd: sql<string>`coalesce(sum(${supplierInvoices.total}) filter (where ${supplierInvoices.currency} = 'USD'), 0)::text`,
    }).from(supplierInvoices)
      .where(and(pendiente, sql`${supplierInvoices.payDueDate} between ${today} and ${today} + 3`)),
    // A crédito, esperando que el proveedor entregue la guía en físico.
    db.select({ total: count() }).from(supplierInvoices)
      .where(and(pendiente, eq(supplierInvoices.paymentTerm, "CREDITO"), sql`${supplierInvoices.guideReceivedAt} is null`)),
    countEmailsToReview(),
  ]);

  const pendientes = byStatus.filter((r) => r.status === "PENDIENTE");
  return {
    byStatus,
    pendingCount: pendientes.reduce((s, r) => s + r.cantidad, 0),
    pendingByCurrency: pendientes.map((r) => ({ currency: r.currency, importe: r.importe })),
    overdueCount: overdue?.total ?? 0,
    overdueAmount: overdue?.importe ?? "0",
    dueSoon: {
      count: dueSoon?.total ?? 0,
      amounts: [
        { currency: "PEN", importe: dueSoon?.importe ?? "0" },
        { currency: "USD", importe: dueSoon?.importeUsd ?? "0" },
      ].filter((a) => Number(a.importe) > 0),
    },
    awaitingGuideCount: awaiting?.total ?? 0,
    emailsToReview: toReview,
  };
}

/** Facturas pendientes más urgentes, para el panel del dashboard. */
export async function listPendingInvoices(limit = 6) {
  return db.select({
    id: supplierInvoices.id,
    series: supplierInvoices.series,
    number: supplierInvoices.number,
    issueDate: supplierInvoices.issueDate,
    currency: supplierInvoices.currency,
    total: supplierInvoices.total,
    supplierName: suppliers.businessName,
    paymentTerm: supplierInvoices.paymentTerm,
    guideReceivedAt: supplierInvoices.guideReceivedAt,
    payDueDate: supplierInvoices.payDueDate,
  })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(eq(supplierInvoices.status, "PENDIENTE"))
    // Primero lo que vence antes; las que esperan guía no tienen fecha y van al final.
    .orderBy(sql`${supplierInvoices.payDueDate} asc nulls last`, asc(supplierInvoices.issueDate))
    .limit(limit);
}

// ---------- Detracciones ----------

/**
 * Resumen para quien lleva las detracciones: cuánto falta depositar y cuánto ya se depositó.
 * Las facturas anuladas quedan fuera, y las operaciones que no llegan al umbral de S/ 400
 * tampoco cuentan porque no generan depósito.
 */
export async function getDetractionSummary() {
  const vigentes = ne(supplierInvoices.status, "ANULADA");
  const porEstado = await db.select({
    status: supplierInvoices.detractionStatus,
    currency: supplierInvoices.currency,
    cantidad: count(),
    importe: sql<string>`coalesce(sum(${supplierInvoices.detractionAmount}), 0)::text`,
  }).from(supplierInvoices)
    .where(and(vigentes, ne(supplierInvoices.detractionStatus, "NO_APLICA")))
    .groupBy(supplierInvoices.detractionStatus, supplierInvoices.currency);

  const [vencidas] = await db.select({
    total: count(),
    importe: sql<string>`coalesce(sum(${supplierInvoices.detractionAmount}), 0)::text`,
  }).from(supplierInvoices)
    .where(and(
      vigentes,
      inArray(supplierInvoices.detractionStatus, ["PENDIENTE", "EN_PROCESO"]),
      // El depósito se hace dentro del mes siguiente a la emisión; a partir de ahí urge.
      sql`${supplierInvoices.issueDate} < ${today} - 30`,
    ));

  const suma = (estados: DetractionStatus[]) =>
    porEstado.filter((r) => estados.includes(r.status))
      .reduce((s, r) => ({ cantidad: s.cantidad + r.cantidad, importe: s.importe + Number(r.importe) }), { cantidad: 0, importe: 0 });

  return {
    porEstado,
    pendientes: suma(["PENDIENTE", "EN_PROCESO"]),
    pagadas: suma(["PAGADA"]),
    observadas: suma(["OBSERVADA"]),
    total: suma(["PENDIENTE", "EN_PROCESO", "PAGADA", "OBSERVADA"]),
    atrasadas: { cantidad: vencidas?.total ?? 0, importe: Number(vencidas?.importe ?? 0) },
  };
}

/** Clientes de Transjer que aparecen en las facturas, para el desplegable de filtros. */
export async function getClientOptions() {
  const rows = await db.selectDistinct({ name: supplierInvoices.clientName })
    .from(supplierInvoices)
    .where(sql`${supplierInvoices.clientName} is not null and ${supplierInvoices.clientName} <> ''`)
    .orderBy(asc(supplierInvoices.clientName));
  return rows.map((r) => r.name!).filter(Boolean);
}

/** Proveedores a los que todavía les falta el RUC, para avisar en la pantalla. */
export async function countSuppliersWithoutRuc() {
  const [row] = await db.select({ total: count() }).from(suppliers)
    .where(and(eq(suppliers.active, true), sql`${suppliers.ruc} is null`));
  return row?.total ?? 0;
}
