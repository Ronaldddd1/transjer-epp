import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  invoiceAttachments, invoiceEmails, supplierInvoices, suppliers, users,
  type InvoiceDocType, type InvoiceEmailStatus, type InvoiceStatus,
} from "@/db/schema";
import { first, isYmd, type SearchParamsRecord } from "@/lib/utils";

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/**
 * Fecha en que llegó la factura, en horario de Lima. Es la base del calendario de pago:
 * Transjer paga los viernes, y a cada factura le toca el viernes de la semana en que llegó.
 */
const reception = sql`((coalesce(${supplierInvoices.receivedAt}, ${supplierInvoices.createdAt}) at time zone 'America/Lima')::date)`;

/** Viernes que le corresponde según su llegada: el primer viernes en esa fecha o después. */
const scheduledFriday = sql`(${reception} + ((5 - extract(isodow from ${reception})::int + 7) % 7))`;

/** El viernes de esta semana (o el de hoy, si hoy es viernes), en horario de Lima. */
const thisFriday = sql`((now() at time zone 'America/Lima')::date + ((5 - extract(isodow from (now() at time zone 'America/Lima')::date)::int + 7) % 7))`;

/** Viernes en que realmente se pagará: si el programado ya pasó, se corre al de esta semana. */
const effectiveFriday = sql`greatest(${scheduledFriday}, ${thisFriday})`;
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
  /** Solo las pendientes cuyo vencimiento ya pasó. */
  overdue?: boolean;
  /** Solo las pendientes que se pagan en la tanda de este viernes. */
  thisFriday?: boolean;
  /** Solo las pendientes cuyo viernes de pago ya pasó y quedaron reprogramadas. */
  rescheduled?: boolean;
};

const STATUSES: InvoiceStatus[] = ["PENDIENTE", "PAGADA", "OBSERVADA", "ANULADA"];
const DOC_TYPES: InvoiceDocType[] = ["FACTURA", "BOLETA", "NOTA_CREDITO", "NOTA_DEBITO"];

export function readInvoiceFilters(sp: SearchParamsRecord): InvoiceFilters {
  const status = first(sp.estado) as InvoiceStatus | undefined;
  const docType = first(sp.tipo) as InvoiceDocType | undefined;
  const currency = first(sp.moneda);
  const source = first(sp.origen);
  const from = first(sp.from);
  const to = first(sp.to);
  return {
    q: first(sp.q)?.trim() || undefined,
    supplierId: first(sp.proveedor) || undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    docType: docType && DOC_TYPES.includes(docType) ? docType : undefined,
    currency: currency === "PEN" || currency === "USD" ? currency : undefined,
    source: source === "MANUAL" || source === "CORREO" ? source : undefined,
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
    overdue: first(sp.vencidas) === "1" || undefined,
    thisFriday: first(sp.viernes) === "1" || undefined,
    rescheduled: first(sp.reprogramadas) === "1" || undefined,
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
    f.overdue
      ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`${supplierInvoices.dueDate} < current_date`)
      : undefined,
    f.thisFriday
      ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`${effectiveFriday} = ${thisFriday}`)
      : undefined,
    f.rescheduled
      ? and(eq(supplierInvoices.status, "PENDIENTE"), sql`${scheduledFriday} < ${thisFriday}`)
      : undefined,
    f.q
      ? or(
          ilike(sql`${supplierInvoices.series} || '-' || ${supplierInvoices.number}`, like(f.q)),
          ilike(supplierInvoices.number, like(f.q)),
          ilike(suppliers.businessName, like(f.q)),
          ilike(suppliers.ruc, like(f.q)),
          ilike(supplierInvoices.grtNumber, like(f.q)),
          ilike(supplierInvoices.description, like(f.q)),
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
  source: supplierInvoices.source,
  receivedAt: supplierInvoices.receivedAt,
  notes: supplierInvoices.notes,
  isDemo: supplierInvoices.isDemo,
  createdAt: supplierInvoices.createdAt,
  supplierId: suppliers.id,
  supplierRuc: suppliers.ruc,
  supplierName: suppliers.businessName,
  paidByName: payer.name,
  createdByName: creator.name,
  attachmentCount: sql<number>`(select count(*)::int from ${invoiceAttachments} a where a.invoice_id = ${supplierInvoices.id})`,
  receptionDate: sql<string>`${reception}::text`,
  scheduledFriday: sql<string>`${scheduledFriday}::text`,
  effectiveFriday: sql<string>`${effectiveFriday}::text`,
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

/** Correo del que provino la factura, si llegó por el buzón. */
export async function getInvoiceEmail(invoiceId: string) {
  const [row] = await db.select({
    id: invoiceEmails.id,
    subject: invoiceEmails.subject,
    fromAddress: invoiceEmails.fromAddress,
    fromName: invoiceEmails.fromName,
    receivedAt: invoiceEmails.receivedAt,
    status: invoiceEmails.status,
  }).from(invoiceEmails).where(eq(invoiceEmails.invoiceId, invoiceId)).limit(1);
  return row ?? null;
}

// ---------- Proveedores ----------

export async function listSuppliers(opts: { q?: string; active?: boolean } = {}, limit = 20, offset = 0) {
  const where = and(
    opts.active !== undefined ? eq(suppliers.active, opts.active) : undefined,
    opts.q ? or(ilike(suppliers.businessName, like(opts.q)), ilike(suppliers.ruc, like(opts.q)), ilike(suppliers.tradeName, like(opts.q))) : undefined,
  );
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
      active: suppliers.active,
      isDemo: suppliers.isDemo,
      invoiceCount: sql<number>`(select count(*)::int from ${supplierInvoices} i where i.supplier_id = ${suppliers.id})`,
      pendingCount: sql<number>`(select count(*)::int from ${supplierInvoices} i where i.supplier_id = ${suppliers.id} and i.status = 'PENDIENTE')`,
    }).from(suppliers).where(where).orderBy(asc(suppliers.businessName)).limit(limit).offset(offset),
    db.select({ total: count() }).from(suppliers).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

export async function getSupplierOptions() {
  return db.select({ id: suppliers.id, ruc: suppliers.ruc, name: suppliers.businessName, active: suppliers.active })
    .from(suppliers).where(eq(suppliers.active, true)).orderBy(asc(suppliers.businessName));
}

// ---------- Bandeja de correos ----------

export type EmailFilters = { q?: string; status?: InvoiceEmailStatus; from?: string; to?: string };
const EMAIL_STATUSES: InvoiceEmailStatus[] = ["PROCESADO", "REVISAR", "DESCARTADO", "ERROR"];

export function readEmailFilters(sp: SearchParamsRecord): EmailFilters {
  const status = first(sp.estado) as InvoiceEmailStatus | undefined;
  const from = first(sp.from);
  const to = first(sp.to);
  return {
    q: first(sp.q)?.trim() || undefined,
    status: status && EMAIL_STATUSES.includes(status) ? status : undefined,
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
  };
}

export async function listInvoiceEmails(f: EmailFilters, limit = 20, offset = 0) {
  const where = and(
    f.status ? eq(invoiceEmails.status, f.status) : undefined,
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
    })
      .from(invoiceEmails)
      .leftJoin(supplierInvoices, eq(invoiceEmails.invoiceId, supplierInvoices.id))
      .leftJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(where)
      .orderBy(desc(invoiceEmails.receivedAt))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(invoiceEmails).where(where),
  ]);
  return { rows, total: totals?.total ?? 0 };
}

export async function countEmailsToReview() {
  const [row] = await db.select({ total: count() }).from(invoiceEmails)
    .where(or(eq(invoiceEmails.status, "REVISAR"), eq(invoiceEmails.status, "ERROR")));
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

// ---------- Resumen para el dashboard ----------

export async function getInvoiceSummary() {
  const [byStatus, [overdue], [friday], [rescheduled], toReview] = await Promise.all([
    db.select({
      status: supplierInvoices.status,
      currency: supplierInvoices.currency,
      cantidad: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}), 0)::text`,
    }).from(supplierInvoices).where(ne(supplierInvoices.status, "ANULADA"))
      .groupBy(supplierInvoices.status, supplierInvoices.currency),
    db.select({ total: count() }).from(supplierInvoices)
      .where(and(eq(supplierInvoices.status, "PENDIENTE"), sql`${supplierInvoices.dueDate} < current_date`)),
    // Tanda de este viernes: lo que hay que pagar esta semana.
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${supplierInvoices.total}) filter (where ${supplierInvoices.currency} = 'PEN'), 0)::text`,
      importeUsd: sql<string>`coalesce(sum(${supplierInvoices.total}) filter (where ${supplierInvoices.currency} = 'USD'), 0)::text`,
      fecha: sql<string>`${thisFriday}::text`,
    }).from(supplierInvoices)
      .where(and(eq(supplierInvoices.status, "PENDIENTE"), sql`${effectiveFriday} = ${thisFriday}`)),
    // Reprogramadas: su viernes pasó sin pagarse.
    db.select({ total: count() }).from(supplierInvoices)
      .where(and(eq(supplierInvoices.status, "PENDIENTE"), sql`${scheduledFriday} < ${thisFriday}`)),
    countEmailsToReview(),
  ]);

  const pendientes = byStatus.filter((r) => r.status === "PENDIENTE");
  return {
    byStatus,
    pendingCount: pendientes.reduce((s, r) => s + r.cantidad, 0),
    pendingByCurrency: pendientes.map((r) => ({ currency: r.currency, importe: r.importe })),
    overdueCount: overdue?.total ?? 0,
    friday: {
      date: friday?.fecha ?? null,
      count: friday?.total ?? 0,
      amounts: [
        { currency: "PEN", importe: friday?.importe ?? "0" },
        { currency: "USD", importe: friday?.importeUsd ?? "0" },
      ].filter((a) => Number(a.importe) > 0),
    },
    rescheduledCount: rescheduled?.total ?? 0,
    emailsToReview: toReview,
  };
}

/** Facturas pendientes más urgentes, para el panel del dashboard. */
export async function listPendingInvoices(limit = 6) {
  return db.select({
    id: supplierInvoices.id,
    series: supplierInvoices.series,
    number: supplierInvoices.number,
    dueDate: supplierInvoices.dueDate,
    issueDate: supplierInvoices.issueDate,
    currency: supplierInvoices.currency,
    total: supplierInvoices.total,
    supplierName: suppliers.businessName,
    scheduledFriday: sql<string>`${scheduledFriday}::text`,
    effectiveFriday: sql<string>`${effectiveFriday}::text`,
  })
    .from(supplierInvoices)
    .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
    .where(eq(supplierInvoices.status, "PENDIENTE"))
    .orderBy(sql`${effectiveFriday} asc`, sql`${supplierInvoices.dueDate} asc nulls last`, asc(supplierInvoices.issueDate))
    .limit(limit);
}
