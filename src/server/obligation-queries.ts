import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  obligationInstallments, obligations, supplierInvoices, suppliers, users,
  type ObligationStatus, type ObligationType,
} from "@/db/schema";
import { first, isYmd, type SearchParamsRecord } from "@/lib/utils";

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const today = sql`((now() at time zone 'America/Lima')::date)`;
const payer = alias(users, "installment_payer");

export type ObligationFilters = {
  q?: string;
  type?: ObligationType;
  status?: ObligationStatus;
  currency?: "PEN" | "USD";
};

const TYPES: ObligationType[] = ["PRESTAMO", "SERVICIO", "ALQUILER", "IMPUESTO", "OTRO"];
const STATUSES: ObligationStatus[] = ["ACTIVA", "CERRADA", "ANULADA"];

export function readObligationFilters(sp: SearchParamsRecord): ObligationFilters {
  const type = first(sp.tipo) as ObligationType | undefined;
  const status = first(sp.estado) as ObligationStatus | undefined;
  const currency = first(sp.moneda);
  return {
    q: first(sp.q)?.trim() || undefined,
    type: type && TYPES.includes(type) ? type : undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    currency: currency === "PEN" || currency === "USD" ? currency : undefined,
  };
}

function conditions(f: ObligationFilters): SQL | undefined {
  return and(
    f.type ? eq(obligations.type, f.type) : undefined,
    f.status ? eq(obligations.status, f.status) : undefined,
    f.currency ? eq(obligations.currency, f.currency) : undefined,
    f.q
      ? or(
          ilike(obligations.name, like(f.q)),
          ilike(obligations.creditor, like(f.q)),
          ilike(obligations.reference, like(f.q)),
        )
      : undefined,
  );
}

/**
 * Resumen por obligación: cuántas cuotas quedan, cuánto falta pagar y cuál es la próxima.
 * Todo se calcula en la consulta para no traer cronogramas enteros a la aplicación.
 */
const pending = sql`i.status = 'PENDIENTE'`;

/**
 * Drizzle escribe `${tabla.columna}` dentro de un sql`` crudo como `"columna"`, sin el
 * nombre de la tabla. Dentro de una subconsulta correlacionada eso se resuelve contra la
 * tabla interna, así que `i.obligation_id = ${laObligacion}` terminaba comparando la
 * cuota consigo misma y devolvía siempre cero. Hay que calificar la columna a mano.
 */
const laObligacion = sql.raw('"obligations"."id"');

const obligationColumns = {
  id: obligations.id,
  type: obligations.type,
  name: obligations.name,
  creditor: obligations.creditor,
  reference: obligations.reference,
  currency: obligations.currency,
  principal: obligations.principal,
  annualRate: obligations.annualRate,
  installmentsCount: obligations.installmentsCount,
  disbursedAt: obligations.disbursedAt,
  billingDay: obligations.billingDay,
  variableAmount: obligations.variableAmount,
  fixedAmount: obligations.fixedAmount,
  status: obligations.status,
  notes: obligations.notes,
  isDemo: obligations.isDemo,
  createdAt: obligations.createdAt,
  scheduleCount: sql<number>`(select count(*)::int from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and i.status <> 'ANULADA')`,
  pendingCount: sql<number>`(select count(*)::int from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending})`,
  paidCount: sql<number>`(select count(*)::int from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and i.status = 'PAGADA')`,
  pendingAmount: sql<string>`(select coalesce(sum(i.total), 0)::text from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending})`,
  /** Cuotas vencidas sin pagar: lo primero que hay que ver. */
  overdueCount: sql<number>`(select count(*)::int from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending} and i.due_date < ${today})`,
  nextDueDate: sql<string | null>`(select min(i.due_date)::text from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending})`,
  nextAmount: sql<string | null>`(select i.total::text from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending} order by i.due_date asc limit 1)`,
  /** Saldo de capital pendiente, según la última cuota pagada del préstamo. */
  balance: sql<string | null>`(select i.balance_after::text from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and i.status = 'PAGADA' order by i.number desc limit 1)`,
  /** Cuotas de servicios variables que aún no tienen importe: falta el recibo. */
  missingAmounts: sql<number>`(select count(*)::int from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending} and i.total is null)`,
};

export async function listObligations(f: ObligationFilters = {}) {
  return db.select(obligationColumns)
    .from(obligations)
    .where(conditions(f))
    // Primero lo que vence antes. Una obligación sin cuotas pendientes va al final.
    .orderBy(
      sql`(select min(i.due_date) from ${obligationInstallments} i where i.obligation_id = ${laObligacion} and ${pending}) asc nulls last`,
      asc(obligations.name),
    );
}

export async function getObligation(id: string) {
  const [row] = await db.select(obligationColumns).from(obligations).where(eq(obligations.id, id)).limit(1);
  return row ?? null;
}

export async function listInstallments(obligationId: string) {
  return db.select({
    id: obligationInstallments.id,
    number: obligationInstallments.number,
    dueDate: obligationInstallments.dueDate,
    principal: obligationInstallments.principal,
    interest: obligationInstallments.interest,
    insurance: obligationInstallments.insurance,
    fees: obligationInstallments.fees,
    total: obligationInstallments.total,
    balanceAfter: obligationInstallments.balanceAfter,
    status: obligationInstallments.status,
    paidAt: obligationInstallments.paidAt,
    paidAmount: obligationInstallments.paidAmount,
    paymentReference: obligationInstallments.paymentReference,
    notes: obligationInstallments.notes,
    paidByName: payer.name,
  })
    .from(obligationInstallments)
    .leftJoin(payer, eq(obligationInstallments.paidBy, payer.id))
    .where(eq(obligationInstallments.obligationId, obligationId))
    .orderBy(asc(obligationInstallments.number));
}

/** Cuánto sale de caja por obligaciones en los próximos días. */
export async function getObligationSummary() {
  const activa = and(eq(obligations.status, "ACTIVA"), eq(obligationInstallments.status, "PENDIENTE"));
  const [[overdue], [soon], [month], [missing]] = await Promise.all([
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${obligationInstallments.total}) filter (where ${obligations.currency} = 'PEN'), 0)::text`,
    }).from(obligationInstallments).innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
      .where(and(activa, sql`${obligationInstallments.dueDate} < ${today}`)),
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${obligationInstallments.total}) filter (where ${obligations.currency} = 'PEN'), 0)::text`,
    }).from(obligationInstallments).innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
      .where(and(activa, sql`${obligationInstallments.dueDate} between ${today} and ${today} + 7`)),
    db.select({
      total: count(),
      importe: sql<string>`coalesce(sum(${obligationInstallments.total}) filter (where ${obligations.currency} = 'PEN'), 0)::text`,
    }).from(obligationInstallments).innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
      .where(and(activa, sql`date_trunc('month', ${obligationInstallments.dueDate}) = date_trunc('month', ${today})`)),
    // Servicios variables a los que les falta el importe del recibo.
    db.select({ total: count() }).from(obligationInstallments)
      .innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
      .where(and(activa, sql`${obligationInstallments.total} is null`, sql`${obligationInstallments.dueDate} <= ${today} + 15`)),
  ]);

  return {
    overdueCount: overdue?.total ?? 0,
    overdueAmount: overdue?.importe ?? "0",
    weekCount: soon?.total ?? 0,
    weekAmount: soon?.importe ?? "0",
    monthCount: month?.total ?? 0,
    monthAmount: month?.importe ?? "0",
    missingAmounts: missing?.total ?? 0,
  };
}

export type CalendarEntry = {
  kind: "FACTURA" | "OBLIGACION";
  id: string;
  dueDate: string | null;
  title: string;
  subtitle: string;
  currency: string;
  amount: string | null;
  href: string;
  overdue: boolean;
};

/**
 * Todo lo que sale de caja en un rango: facturas de proveedores y cuotas de obligaciones,
 * en una sola lista ordenada por fecha. Es la vista que necesita la encargada para saber
 * cuánto tiene que tener disponible esta semana.
 */
export async function listPaymentCalendar(from: string, to: string): Promise<CalendarEntry[]> {
  const [facturas, cuotas] = await Promise.all([
    db.select({
      id: supplierInvoices.id,
      dueDate: supplierInvoices.payDueDate,
      series: supplierInvoices.series,
      number: supplierInvoices.number,
      supplierName: suppliers.businessName,
      currency: supplierInvoices.currency,
      total: supplierInvoices.total,
      paymentTerm: supplierInvoices.paymentTerm,
    })
      .from(supplierInvoices)
      .innerJoin(suppliers, eq(supplierInvoices.supplierId, suppliers.id))
      .where(and(
        eq(supplierInvoices.status, "PENDIENTE"),
        gte(supplierInvoices.payDueDate, from),
        lte(supplierInvoices.payDueDate, to),
      )),
    db.select({
      id: obligationInstallments.id,
      obligationId: obligations.id,
      dueDate: obligationInstallments.dueDate,
      number: obligationInstallments.number,
      name: obligations.name,
      creditor: obligations.creditor,
      type: obligations.type,
      currency: obligations.currency,
      total: obligationInstallments.total,
    })
      .from(obligationInstallments)
      .innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
      .where(and(
        eq(obligationInstallments.status, "PENDIENTE"),
        ne(obligations.status, "ANULADA"),
        gte(obligationInstallments.dueDate, from),
        lte(obligationInstallments.dueDate, to),
      )),
  ]);

  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

  const entries: CalendarEntry[] = [
    ...facturas.map((f) => ({
      kind: "FACTURA" as const,
      id: f.id,
      dueDate: f.dueDate,
      title: `${f.series}-${f.number}`,
      subtitle: f.supplierName,
      currency: f.currency,
      amount: f.total,
      href: `/facturas/${f.id}`,
      overdue: !!f.dueDate && f.dueDate < hoy,
    })),
    ...cuotas.map((c) => ({
      kind: "OBLIGACION" as const,
      id: c.id,
      dueDate: c.dueDate,
      title: `${c.name} · cuota ${c.number}`,
      subtitle: c.creditor,
      currency: c.currency,
      amount: c.total,
      href: `/obligaciones/${c.obligationId}`,
      overdue: c.dueDate < hoy,
    })),
  ];

  return entries.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
}

/** Próximas cuotas para el panel del dashboard. */
export async function listUpcomingInstallments(limit = 5) {
  return db.select({
    id: obligationInstallments.id,
    obligationId: obligations.id,
    number: obligationInstallments.number,
    dueDate: obligationInstallments.dueDate,
    total: obligationInstallments.total,
    currency: obligations.currency,
    name: obligations.name,
    creditor: obligations.creditor,
    type: obligations.type,
  })
    .from(obligationInstallments)
    .innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
    .where(and(eq(obligationInstallments.status, "PENDIENTE"), eq(obligations.status, "ACTIVA")))
    .orderBy(asc(obligationInstallments.dueDate))
    .limit(limit);
}

/** Cuánto se pagó por obligación en los últimos meses, para el reporte. */
export async function obligationPaymentsByMonth(months = 12) {
  return db.select({
    mes: sql<string>`to_char(date_trunc('month', ${obligationInstallments.paidAt}), 'YYYY-MM')`,
    tipo: obligations.type,
    currency: obligations.currency,
    importe: sql<string>`coalesce(sum(${obligationInstallments.paidAmount}), 0)::text`,
    cantidad: count(),
  })
    .from(obligationInstallments)
    .innerJoin(obligations, eq(obligationInstallments.obligationId, obligations.id))
    .where(and(
      eq(obligationInstallments.status, "PAGADA"),
      sql`${obligationInstallments.paidAt} >= (${today} - (${months} || ' months')::interval)`,
    ))
    .groupBy(sql`date_trunc('month', ${obligationInstallments.paidAt})`, obligations.type, obligations.currency)
    .orderBy(desc(sql`date_trunc('month', ${obligationInstallments.paidAt})`));
}
