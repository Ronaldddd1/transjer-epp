import { AlertTriangle, Building2, CalendarClock, FileClock, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceReasonModal, PayInvoiceModal } from "@/components/invoices/invoice-actions";
import { ImportSheetModal } from "@/components/invoices/import-sheet-modal";
import { ImportInvoiceModal, InvoiceFormModal } from "@/components/invoices/invoice-form-modal";
import { Badge, DetractionBadge, DueBadge, InvoiceStatusBadge, PaymentTermBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, first, formatDate, formatMoney, INVOICE_DOC_TYPE_LABEL, INVOICE_STATUS_LABEL,
  DETRACTION_STATUS_LABEL, invoiceNumber, pageParams, PAYMENT_TERM_LABEL, todayLima, type SearchParams,
} from "@/lib/utils";
import { countEmailsToReview, countSuppliersWithoutRuc, getClientOptions, getSupplierOptions, invoiceTotals, listInvoices, readInvoiceFilters } from "@/server/invoice-queries";
import { maxBytesFor } from "@/server/storage";

export const metadata: Metadata = { title: "Facturas de proveedores" };

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("invoices.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readInvoiceFilters(sp);
  const canManage = can(user.role, "invoices.manage");
  const canPay = can(user.role, "invoices.pay");
  const cols = canManage || canPay ? 10 : 9;
  const maxMb = Math.floor(maxBytesFor() / 1024 / 1024);

  const [{ rows, total }, totals, suppliers, clients, emailsToReview, sinRuc] = await Promise.all([
    listInvoices(f, pageSize, offset),
    invoiceTotals(f),
    getSupplierOptions(),
    getClientOptions(),
    countEmailsToReview(),
    canManage ? countSuppliersWithoutRuc() : Promise.resolve(0),
  ]);

  // Resumen de lo que se está viendo, separado por moneda.
  const pendientes = totals.filter((t) => t.status === "PENDIENTE");
  const pagadas = totals.filter((t) => t.status === "PAGADA");
  const observadas = totals.filter((t) => t.status === "OBSERVADA");
  const sum = (rows: typeof totals) => rows.reduce((s, r) => s + r.cantidad, 0);
  const amounts = (rows: typeof totals) =>
    rows.filter((r) => Number(r.importe) > 0).map((r) => formatMoney(r.importe, r.currency)).join(" · ") || "—";

  const resumen = [
    { label: "Pendientes de pago", count: sum(pendientes), detail: amounts(pendientes), tone: "brand" as const },
    { label: "Pagadas", count: sum(pagadas), detail: amounts(pagadas), tone: "plain" as const },
    { label: "Observadas", count: sum(observadas), detail: amounts(observadas), tone: "plain" as const },
  ];

  // Lo urgente de esta página: lo que ya venció y lo que espera la guía para poder vencer.
  const hoy = todayLima();
  const vencidas = rows.filter((r) => r.status === "PENDIENTE" && !!r.payDueDate && r.payDueDate < hoy);
  const sinGuia = rows.filter((r) => r.status === "PENDIENTE" && r.paymentTerm === "CREDITO" && !r.guideReceivedAt);

  return (
    <>
      <PageHeader
        title="Facturas de proveedores"
        description="Facturas recibidas por servicios de transporte. Marca aquí los pagos realizados."
        actions={
          <>
            <ExportTable tabla="facturas" />
            {canManage && (
              <>
                <ButtonLink href="/facturas/correos" variant="ghost">
                  <Mail className="h-4 w-4" /> Correos
                  {emailsToReview > 0 && <span className="ml-1 rounded bg-brand px-1.5 text-xs font-bold text-ink">{emailsToReview}</span>}
                </ButtonLink>
                <ImportInvoiceModal maxMb={maxMb} />
                <ImportSheetModal />
                <InvoiceFormModal suppliers={suppliers} clients={clients} />
              </>
            )}
          </>
        }
      />

      {emailsToReview > 0 && canManage && (
        <Link
          href="/facturas/correos?estado=REVISAR"
          className="mb-4 flex items-center gap-3 rounded-lg border border-brand/60 bg-brand-soft px-4 py-3 text-sm text-[#7A5A00] hover:border-brand"
        >
          <Mail className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{emailsToReview} correo(s)</strong> llegaron al buzón y no se pudieron registrar solos. Revísalos para no perder ninguna factura.
          </span>
        </Link>
      )}

      {sinRuc > 0 && (
        <Link
          href="/proveedores"
          className="mb-4 flex items-center gap-3 rounded-lg border border-steel-300 bg-steel-50 px-4 py-3 text-sm text-steel-700 hover:border-steel-400"
        >
          <Building2 className="h-5 w-5 shrink-0 text-steel-400" aria-hidden />
          <span>
            <strong>{sinRuc} proveedor(es)</strong> todavía no tienen RUC. Se completa solo cuando llegue
            una factura suya con el XML, o puedes escribirlo a mano desde Proveedores.
          </span>
        </Link>
      )}

      {(vencidas.length > 0 || sinGuia.length > 0) && (
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {vencidas.length > 0 && (
            <Link href="/facturas?vencidas=1" className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400">
              <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                <strong>{vencidas.length} factura(s)</strong> pasaron su fecha límite de pago.
              </span>
            </Link>
          )}
          {sinGuia.length > 0 && (
            <Link href="/facturas?singuia=1" className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 hover:border-sky-400">
              <FileClock className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                <strong>{sinGuia.length} factura(s)</strong> a crédito esperan que el proveedor entregue la guía en físico.
                Hasta entonces su plazo no corre.
              </span>
            </Link>
          )}
        </div>
      )}

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {resumen.map((r) => (
          <div key={r.label} className={cn("rounded-lg border bg-white p-4", r.tone === "brand" ? "border-brand/60" : "border-steel-200")}>
            <dt className="text-sm text-steel-500">{r.label}</dt>
            <dd className="mt-1 font-display text-2xl font-bold text-ink">{r.count}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{r.detail}</dd>
          </div>
        ))}
      </dl>

      <FilterBar
        searchPlaceholder="Buscar número, proveedor, RUC o guía"
        filters={[
          { type: "select", name: "estado", label: "Estado", allLabel: "Todos", options: Object.entries(INVOICE_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "proveedor", label: "Proveedor", options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
          { type: "select", name: "tipo", label: "Tipo", allLabel: "Todos", options: Object.entries(INVOICE_DOC_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "cliente", label: "Cliente", options: clients.map((c) => ({ value: c, label: c })) },
          { type: "select", name: "detraccion", label: "Detracción", allLabel: "Todas", options: Object.entries(DETRACTION_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "condicion", label: "Condición", allLabel: "Todas", options: Object.entries(PAYMENT_TERM_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "moneda", label: "Moneda", allLabel: "Todas", options: [{ value: "PEN", label: "Soles" }, { value: "USD", label: "Dólares" }] },
          { type: "select", name: "origen", label: "Origen", allLabel: "Todos", options: [{ value: "MANUAL", label: "Registro manual" }, { value: "CORREO", label: "Correo" }] },
          { type: "date", name: "from", label: "Emitida desde" },
          { type: "date", name: "to", label: "Emitida hasta" },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Comprobante</Th>
            <Th>Proveedor</Th>
            <Th className="hidden 2xl:table-cell">Emisión</Th>
            <Th>Vence</Th>
            <Th className="text-right">Importe</Th>
            <Th>Estado</Th>
            <Th className="hidden 2xl:table-cell">Detracción</Th>
            <Th className="hidden 2xl:table-cell">Guía</Th>
            <Th className="hidden 2xl:table-cell">Pago</Th>
            {(canManage || canPay) && <Th className="text-right">Acciones</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={cols}
              title="No hay facturas para mostrar"
              hint={canManage ? "Usa Cargar XML para registrar la primera en segundos." : undefined}
            />
          )}
          {rows.map((i) => {
            const ref = { id: i.id, series: i.series, number: i.number, currency: i.currency, total: i.total, supplierName: i.supplierName };
            return (
              <Tr key={i.id} className={cn(i.status === "ANULADA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
                <Td>
                  <Link href={`/facturas/${i.id}`} className="font-semibold tabular hover:underline">{invoiceNumber(i.series, i.number)}</Link>
                  <p className="text-xs text-steel-500">
                    {INVOICE_DOC_TYPE_LABEL[i.docType]}
                    {i.source === "CORREO" && <span className="ml-1 text-steel-400">· del correo</span>}
                  </p>
                  <p className="text-xs text-steel-500 2xl:hidden">Emitida {formatDate(i.issueDate)}</p>
                </Td>
                <Td>
                  <p className="font-medium">{i.supplierName}</p>
                  <p className="text-xs text-steel-500">{i.supplierRuc ? `RUC ${i.supplierRuc}` : "RUC pendiente"}</p>
                  {(i.clientName || i.plate) && (
                    <p className="text-xs text-steel-500">
                      {[i.clientName, i.plate, i.destinationCity].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 2xl:table-cell">{formatDate(i.issueDate)}</Td>
                <Td>
                  {i.status === "PENDIENTE" ? (
                    <>
                      <DueBadge payDueDate={i.payDueDate} compact />
                      <p className="mt-1"><PaymentTermBadge term={i.paymentTerm} termDays={i.termDays} /></p>
                    </>
                  ) : (
                    <span className="whitespace-nowrap text-steel-500">{i.payDueDate ? `Vencía ${formatDate(i.payDueDate)}` : "—"}</span>
                  )}
                </Td>
                <Td className={cn("whitespace-nowrap text-right font-display text-base font-bold tabular", i.status === "ANULADA" && "line-through")}>
                  {formatMoney(i.total, i.currency)}
                </Td>
                <Td>
                  <InvoiceStatusBadge status={i.status} dueDate={i.payDueDate} />
                  {i.statusReason && i.status !== "PAGADA" && (
                    <p className="mt-1 line-clamp-2 w-40 text-xs text-steel-500" title={i.statusReason}>{i.statusReason}</p>
                  )}
                </Td>
                <Td className="hidden 2xl:table-cell">
                  <DetractionBadge status={i.detractionStatus} />
                  {i.detractionStatus !== "NO_APLICA" && (
                    <p className="mt-1 whitespace-nowrap text-xs text-steel-500">{formatMoney(i.detractionAmount, i.currency)}</p>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap text-steel-600 2xl:table-cell">{i.grtNumber ?? "—"}</Td>
                <Td className="hidden text-steel-600 2xl:table-cell">
                  {i.paidAt ? (
                    <>
                      <span className="whitespace-nowrap tabular">{formatDate(i.paidAt)}</span>
                      {i.paidByName && <p className="text-xs text-steel-500">{i.paidByName}</p>}
                    </>
                  ) : "—"}
                </Td>
                {(canManage || canPay) && (
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {canPay && (i.status === "PENDIENTE" || i.status === "OBSERVADA") && <PayInvoiceModal invoice={ref} compact />}
                      {canManage && i.status === "PENDIENTE" && <InvoiceReasonModal invoice={ref} action="observe" compact />}
                      <ButtonLink href={`/facturas/${i.id}`} variant="ghost" size="sm">Ver</ButtonLink>
                    </div>
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      {first(sp.porvencer) === "1" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-steel-500">
          <CalendarClock className="h-4 w-4 text-[#9A7000]" aria-hidden />
          Mostrando solo las facturas que vencen hoy o en los próximos tres días.{" "}
          <Link href="/facturas" className="underline">Ver todas</Link>
        </p>
      )}
      {first(sp.singuia) === "1" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-steel-500">
          <FileClock className="h-4 w-4 text-sky-700" aria-hidden />
          Mostrando solo las facturas a crédito que esperan la entrega de la guía.{" "}
          <Link href="/facturas" className="underline">Ver todas</Link>
        </p>
      )}
      {first(sp.vencidas) === "1" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-steel-500">
          <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
          Mostrando solo las facturas pendientes cuya fecha límite ya pasó.{" "}
          <Link href="/facturas" className="underline">Ver todas</Link>
        </p>
      )}
      {rows.some((r) => r.isDemo) && <p className="mt-3 text-sm text-steel-500"><Badge tone="neutral">Prueba</Badge> Las facturas de prueba se borran con <code>npm run db:clear-demo</code>.</p>}

      <Pagination basePath="/facturas" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
