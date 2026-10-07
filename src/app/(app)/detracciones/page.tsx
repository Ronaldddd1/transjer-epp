import { AlertTriangle, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DetractionModal } from "@/components/invoices/detraction-actions";
import { DetractionBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, DETRACTION_STATUS_LABEL, DETRACTION_THRESHOLD, first, formatDate, formatMoney,
  invoiceNumber, pageParams, type SearchParams,
} from "@/lib/utils";
import {
  getClientOptions, getDetractionSummary, getSupplierOptions, listInvoices, readInvoiceFilters,
} from "@/server/invoice-queries";

export const metadata: Metadata = { title: "Detracciones" };

/**
 * Control del 4 % que se deposita en el Banco de la Nación.
 *
 * Es la pantalla del rol de Detracciones: ve las facturas para saber sobre qué deposita,
 * pero no las registra ni paga a los proveedores. El monto nunca se escribe a mano, sale
 * del importe de la factura.
 */
export default async function DetractionsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("detractions.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 25);

  // Por defecto se muestra lo que falta depositar, que es el trabajo del día.
  const filtroEstado = first(sp.detraccion);
  const f = {
    ...readInvoiceFilters(sp),
    ...(filtroEstado ? {} : { detraction: "PENDIENTE" as const }),
  };
  const canManage = can(user.role, "detractions.manage");

  const [{ rows, total }, resumen, suppliers, clients] = await Promise.all([
    listInvoices(f, pageSize, offset),
    getDetractionSummary(),
    getSupplierOptions(),
    getClientOptions(),
  ]);

  const tarjetas = [
    { label: "Pendientes de depositar", count: resumen.pendientes.cantidad, importe: resumen.pendientes.importe, tone: "alert" as const, href: "/detracciones?detraccion=PENDIENTE" },
    { label: "Depositadas", count: resumen.pagadas.cantidad, importe: resumen.pagadas.importe, tone: "plain" as const, href: "/detracciones?detraccion=PAGADA" },
    { label: "Observadas", count: resumen.observadas.cantidad, importe: resumen.observadas.importe, tone: "plain" as const, href: "/detracciones?detraccion=OBSERVADA" },
    { label: "Total de detracciones", count: resumen.total.cantidad, importe: resumen.total.importe, tone: "plain" as const, href: "/detracciones?detraccion=" },
  ];

  return (
    <>
      <PageHeader
        title="Detracciones"
        description="El 4 % de cada factura de transporte que se deposita en el Banco de la Nación."
        actions={<ExportTable tabla="detracciones" />}
      />

      {resumen.atrasadas.cantidad > 0 && (
        <Link
          href="/detracciones?detraccion=PENDIENTE"
          className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{resumen.atrasadas.cantidad} detracción(es)</strong> llevan más de 30 días desde la emisión
            de la factura y siguen sin depositarse, por {formatMoney(resumen.atrasadas.importe.toFixed(2))}.
          </span>
        </Link>
      )}

      <dl className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tarjetas.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className={cn(
              "rounded-lg border bg-white p-4 hover:border-steel-400",
              t.tone === "alert" && t.count > 0 ? "border-red-300" : "border-steel-200",
            )}
          >
            <dt className="text-sm text-steel-500">{t.label}</dt>
            <dd className="mt-1 font-display text-2xl font-bold text-ink">{formatMoney(t.importe.toFixed(2))}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{t.count} factura(s)</dd>
          </Link>
        ))}
      </dl>

      <FilterBar
        searchPlaceholder="Buscar factura, proveedor, placa o constancia"
        filters={[
          { type: "select", name: "detraccion", label: "Estado", allLabel: "Todos", options: Object.entries(DETRACTION_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "proveedor", label: "Proveedor", options: suppliers.map((s) => ({ value: s.id, label: s.name })) },
          { type: "select", name: "cliente", label: "Cliente", options: clients.map((c) => ({ value: c, label: c })) },
          { type: "date", name: "from", label: "Emitida desde" },
          { type: "date", name: "to", label: "Emitida hasta" },
        ]}
      />

      {!filtroEstado && (
        <p className="mb-3 text-sm text-steel-500">
          Mostrando solo las pendientes de depositar.{" "}
          <Link href="/detracciones?detraccion=" className="underline">Ver todas</Link>
        </p>
      )}

      <TableShell>
        <thead>
          <tr>
            <Th>Factura</Th>
            <Th>Proveedor</Th>
            <Th className="hidden 2xl:table-cell">Emisión</Th>
            <Th className="text-right">Importe</Th>
            <Th className="text-right">Detracción</Th>
            <Th>Estado</Th>
            <Th className="hidden 2xl:table-cell">Constancia</Th>
            {canManage && <Th className="text-right">Acciones</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow colSpan={canManage ? 8 : 7} title="No hay detracciones con esos filtros" />
          )}
          {rows.map((i) => {
            const ref = {
              id: i.id, series: i.series, number: i.number, currency: i.currency, total: i.total,
              supplierName: i.supplierName, detractionAmount: i.detractionAmount,
              detractionStatus: i.detractionStatus, detractionPaidAt: i.detractionPaidAt,
              detractionReceipt: i.detractionReceipt, detractionOperation: i.detractionOperation,
              detractionNotes: i.detractionNotes,
            };
            return (
              <Tr key={i.id} className={cn(i.status === "ANULADA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
                <Td>
                  <Link href={`/facturas/${i.id}`} className="font-semibold tabular hover:underline">
                    {invoiceNumber(i.series, i.number)}
                  </Link>
                  {i.clientName && <p className="text-xs text-steel-500">{i.clientName}{i.plate && ` · ${i.plate}`}</p>}
                </Td>
                <Td>
                  <p className="font-medium">{i.supplierName}</p>
                  <p className="text-xs text-steel-500">{i.supplierRuc ? `RUC ${i.supplierRuc}` : "RUC pendiente"}</p>
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 2xl:table-cell">{formatDate(i.issueDate)}</Td>
                <Td className="whitespace-nowrap text-right tabular text-steel-600">{formatMoney(i.total, i.currency)}</Td>
                <Td className="whitespace-nowrap text-right font-display text-base font-bold tabular">
                  {formatMoney(i.detractionAmount, i.currency)}
                </Td>
                <Td>
                  <DetractionBadge status={i.detractionStatus} />
                  {i.detractionPaidAt && <p className="mt-1 text-xs text-steel-500">{formatDate(i.detractionPaidAt)}</p>}
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 2xl:table-cell">
                  {i.detractionReceipt ?? "—"}
                  {i.detractionOperation && <p className="text-xs text-steel-500">Op. {i.detractionOperation}</p>}
                </Td>
                {canManage && (
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      {i.detractionStatus !== "NO_APLICA" && i.status !== "ANULADA" && (
                        <DetractionModal invoice={ref} variant="outline" compact />
                      )}
                      <ButtonLink href={`/facturas/${i.id}`} variant="ghost" size="sm">Ver</ButtonLink>
                    </div>
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      <p className="mt-3 flex items-start gap-2 text-sm text-steel-500">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" aria-hidden />
        <span>
          El monto se calcula solo: 4 % del importe total con IGV, redondeado al sol más próximo.
          Las operaciones de S/ {DETRACTION_THRESHOLD} o menos no se detraen y figuran como «No aplica».
        </span>
      </p>

      <Pagination basePath="/detracciones" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
