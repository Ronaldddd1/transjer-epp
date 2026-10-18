import { AlertTriangle, Building2, CalendarClock, FileClock, Mail, Eye } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InvoiceReasonModal, PayInvoiceModal } from "@/components/invoices/invoice-actions";
import { ImportSheetModal } from "@/components/invoices/import-sheet-modal";
import { ImportInvoiceModal, InvoiceFormModal } from "@/components/invoices/invoice-form-modal";
import { Badge, DetractionBadge, DueBadge, InvoiceStatusBadge, PaymentTermBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { TabLinks } from "@/components/ui/tab-links";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, first, formatDate, formatMoney, INVOICE_DOC_TYPE_LABEL, INVOICE_SERVICE_TYPE_LABEL,
  INVOICE_STATUS_LABEL, DETRACTION_STATUS_LABEL, invoiceNumber, netoAPagar, pageParams,
  PAYMENT_TERM_LABEL, todayLima, type SearchParams,
} from "@/lib/utils";
import { countEmailsToReview, countSuppliersWithoutRuc, getClientOptions, getSupplierOptions, invoiceTotals, listInvoices, readInvoiceFilters } from "@/server/invoice-queries";
import { maxBytesFor } from "@/server/storage";

export const metadata: Metadata = { title: "Facturas de proveedores" };

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("invoices.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const filtros = readInvoiceFilters(sp);
  /**
   * Sin elegir nada se entra por "Pendientes de pago", que es a lo que se entra: a pagar
   * lo que falta, no a mirar lo ya pagado.
   *
   * Salvo que se esté buscando algo. Una búsqueda acotada a pendientes no encontraría una
   * factura ya pagada y parecería que no existe, que es peor que mostrar de más.
   */
  const porDefecto = !sp.estado && !filtros.q;
  const f = porDefecto ? { ...filtros, status: "PENDIENTE" as const } : filtros;
  const canManage = can(user.role, "invoices.manage");
  const canPay = can(user.role, "invoices.pay");
  const cols = 9;
  const maxMb = Math.floor(maxBytesFor() / 1024 / 1024);

  const [{ rows, total }, totals, totalesPorEstado, suppliers, clients, emailsToReview, sinRuc] = await Promise.all([
    listInvoices(f, pageSize, offset),
    invoiceTotals(f),
    // Los mismos filtros pero sin el estado: así cada pestaña muestra cuántas hay en ella
    // y no cero por estar mirando otra.
    invoiceTotals({ ...f, status: undefined }),
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

  const cuentaPorEstado = (estado: string) =>
    totalesPorEstado.filter((t) => t.status === estado).reduce((n, t) => n + t.cantidad, 0);
  const todasLasFacturas = totalesPorEstado.reduce((n, t) => n + t.cantidad, 0);

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

      {/* Pendientes y pagadas separadas: son dos trabajos distintos. La encargada entra a
          pagar lo que falta, no a mirar lo que ya pagó. */}
      <TabLinks
        name="estado"
        current={first(sp.estado) ?? (porDefecto ? "PENDIENTE" : "")}
        base="/facturas"
        params={sp}
        className="mb-3"
        tabs={[
          { value: "PENDIENTE", label: "Pendientes de pago", count: cuentaPorEstado("PENDIENTE") },
          { value: "PAGADA", label: "Pagadas", count: cuentaPorEstado("PAGADA") },
          { value: "OBSERVADA", label: "Observadas", count: cuentaPorEstado("OBSERVADA") },
          { value: "", label: "Todas", count: todasLasFacturas },
        ]}
      />

      <FilterBar
        searchPlaceholder="Buscar número, proveedor, RUC o guía"
        filters={[
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
            <Th className="hidden xl:table-cell">Emisión</Th>
            <Th>Recibida</Th>
            <Th className="text-right">A pagar</Th>
            <Th className="hidden text-right xl:table-cell">Adelanto</Th>
            <Th>Vence</Th>
            <Th>Estado</Th>
            {/* Fija a la derecha: el botón de pagar y el de ver tienen que estar siempre
                a la vista, sin correr la tabla. */}
            <Th className="sticky right-0 z-10 bg-steel-50 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]">Acciones</Th>
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
            // Lo que de verdad se le transfiere al proveedor: el total menos la
            // detracción, que va al Banco de la Nación. Es la cifra con la que se paga,
            // y tenerla calculada a mano cada vez era de las cosas que más se erraba.
            const aPagar = netoAPagar(i.total, i.detractionAmount);
            const adelanto = Number(i.advances ?? 0);
            return (
              <Tr key={i.id} className={cn(i.status === "ANULADA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
                <Td>
                  <Link href={`/facturas/${i.id}`} className="font-semibold tabular hover:underline">{invoiceNumber(i.series, i.number)}</Link>
                  <p className="text-xs text-steel-500">
                    {i.serviceType ? INVOICE_SERVICE_TYPE_LABEL[i.serviceType] : INVOICE_DOC_TYPE_LABEL[i.docType]}
                    {i.source === "CORREO" && <span className="ml-1 text-steel-400">· del correo</span>}
                  </p>
                  <p className="text-xs text-steel-500 xl:hidden">Emitida {formatDate(i.issueDate)}</p>
                </Td>
                <Td>
                  <p className="font-medium">{i.supplierName}</p>
                  {/* Debajo, de quién fue el flete y a dónde: es lo que se busca cuando
                      alguien pregunta por una factura, más que el RUC. */}
                  {(i.clientName || i.destinationCity) && (
                    <p className="text-xs text-steel-500">
                      {[i.clientName, i.destinationCity].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {i.plate && <p className="text-xs text-steel-400">{i.plate}</p>}
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 xl:table-cell">{formatDate(i.issueDate)}</Td>
                <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(i.receivedAt ?? i.createdAt)}</Td>
                <Td className={cn("whitespace-nowrap text-right", i.status === "ANULADA" && "line-through")}>
                  <span className="font-display text-base font-bold tabular">{formatMoney(aPagar, i.currency)}</span>
                  {Number(i.detractionAmount ?? 0) > 0 && (
                    <p className="text-xs text-steel-500" title="Total del comprobante y detracción descontada">
                      {formatMoney(i.total, i.currency)} − {formatMoney(i.detractionAmount, i.currency)}
                    </p>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 xl:table-cell">
                  {adelanto > 0 ? formatMoney(i.advances, i.currency) : "—"}
                </Td>
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
                <Td>
                  <InvoiceStatusBadge status={i.status} dueDate={i.payDueDate} />
                  {i.statusReason && i.status !== "PAGADA" && (
                    <p className="mt-1 line-clamp-2 w-36 text-xs text-steel-500" title={i.statusReason}>{i.statusReason}</p>
                  )}
                </Td>
                <Td className="sticky right-0 z-10 bg-white shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]">
                  <div className="flex items-center justify-end gap-1">
                    {canPay && (i.status === "PENDIENTE" || i.status === "OBSERVADA") && <PayInvoiceModal invoice={ref} compact />}
                    {/* Observar salió de la fila: se usa poco y ocupaba el ancho que hacía
                        falta para lo que sí se mira. Sigue estando dentro de Ver. */}
                    <ButtonLink href={`/facturas/${i.id}`} variant="ghost" size="sm" title="Ver la factura" aria-label="Ver la factura">
                      <Eye className="h-4 w-4" />
                    </ButtonLink>
                  </div>
                </Td>
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
