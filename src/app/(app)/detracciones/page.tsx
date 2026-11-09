import { AlertTriangle, Download, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DetractionModal } from "@/components/invoices/detraction-actions";
import { AnularLoteButton, FORM_LOTE, LoteSunatBar, MarcarTodas, PagoLoteModal } from "@/components/invoices/lote-sunat";
import { Badge, DetractionBadge } from "@/components/ui/badge";
import { buttonClass, ButtonLink } from "@/components/ui/button";
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
import { datosParaNuevoLote, facturasDeLote, listarLotes } from "@/server/detraction-batches";

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
  const canManage = can(user, "detractions.manage");

  const [{ rows, total }, resumen, suppliers, clients, lotes, propuesta] = await Promise.all([
    listInvoices(f, pageSize, offset),
    getDetractionSummary(),
    getSupplierOptions(),
    getClientOptions(),
    listarLotes(),
    canManage ? datosParaNuevoLote() : Promise.resolve(null),
  ]);
  // Las facturas de los lotes que esperan pago, para el formulario de la constancia.
  const abiertos = await Promise.all(
    lotes.filter((l) => l.status === "GENERADO").map(async (l) => ({ ...l, facturas: await facturasDeLote(l.id) })),
  );
  const loteDe = new Map(lotes.map((l) => [l.id, l.lot]));
  // Las casillas para armar el pago masivo solo salen donde hay detracciones pendientes.
  const conCasillas = canManage && rows.some((r) => r.detractionStatus === "PENDIENTE");
  const columnas = (canManage ? 8 : 7) + (conCasillas ? 1 : 0);

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

      {lotes.length > 0 && (
        <section className="mb-5 rounded-lg border border-steel-200 bg-white" aria-labelledby="lotes-sunat">
          <h2 id="lotes-sunat" className="border-b border-steel-100 px-4 py-3 font-display text-base font-bold text-ink">
            Pagos masivos a SUNAT
          </h2>
          <ul className="divide-y divide-steel-100">
            {lotes.map((l) => {
              const abierto = abiertos.find((a) => a.id === l.id);
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      Lote {l.lot}{" "}
                      {l.status === "GENERADO" && <Badge tone="yellow">Falta pagar</Badge>}
                      {l.status === "PAGADO" && <Badge tone="green">Pagado</Badge>}
                      {l.status === "ANULADO" && <Badge>Anulado</Badge>}
                    </p>
                    <p className="text-steel-500">
                      {l.invoiceCount} detracción(es) · {formatMoney(l.total)}
                      {l.status === "PAGADO" && l.paidAt && <> · pagado el {formatDate(l.paidAt)}{l.operation && `, op. ${l.operation}`}</>}
                      {l.status !== "PAGADO" && <> · armado el {formatDate(l.createdAt.toISOString().slice(0, 10))}{l.createdByName && ` por ${l.createdByName}`}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {l.status !== "ANULADO" && (
                      <a href={`/api/detracciones/lotes/${l.id}`} download className={buttonClass("outline", "sm")} title="Descargar el archivo TXT para SUNAT">
                        <Download className="h-4 w-4" /> TXT
                      </a>
                    )}
                    {l.proofId && (
                      <a href={`/api/facturas/adjuntos/${l.proofId}`} target="_blank" rel="noreferrer" className={buttonClass("ghost", "sm")}>
                        Constancia
                      </a>
                    )}
                    {canManage && abierto && (
                      <>
                        <PagoLoteModal
                          lote={{
                            id: abierto.id, lot: abierto.lot, total: abierto.total,
                            facturas: abierto.facturas.map((fa) => ({
                              id: fa.id, etiqueta: invoiceNumber(fa.series, fa.number), proveedor: fa.supplierName,
                              monto: fa.detractionAmount ?? "0", enProceso: fa.detractionStatus === "EN_PROCESO",
                            })),
                          }}
                        />
                        <AnularLoteButton id={abierto.id} lot={abierto.lot} />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {conCasillas && propuesta && <LoteSunatBar propuesta={propuesta} />}

      <TableShell>
        <thead>
          <tr>
            {conCasillas && <Th className="w-8"><MarcarTodas /></Th>}
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
            <EmptyRow colSpan={columnas} title="No hay detracciones con esos filtros" />
          )}
          {rows.map((i) => {
            const ref = {
              id: i.id, series: i.series, number: i.number, currency: i.currency, total: i.total,
              supplierName: i.supplierName, detractionAmount: i.detractionAmount,
              detractionStatus: i.detractionStatus, detractionPaidAt: i.detractionPaidAt,
              detractionReceipt: i.detractionReceipt, detractionOperation: i.detractionOperation,
              detractionNotes: i.detractionNotes,
              tieneConstancia: !!i.detractionProofId,
            };
            return (
              <Tr key={i.id} className={cn(i.status === "ANULADA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
                {conCasillas && (
                  <Td className="w-8">
                    {i.detractionStatus === "PENDIENTE" && (() => {
                      // Lo que impide mandarla en el archivo y no se arregla desde el formulario.
                      const motivo = i.status === "ANULADA" ? "La factura está anulada"
                        : !i.supplierRuc ? "El proveedor no tiene RUC: complétalo en Proveedores"
                          : i.docType === "NOTA_CREDITO" ? "Una nota de crédito no lleva detracción"
                            : null;
                      return (
                        <input
                          type="checkbox"
                          form={FORM_LOTE}
                          name="ids"
                          value={i.id}
                          disabled={!!motivo}
                          title={motivo ?? "Marcar para el pago masivo"}
                          aria-label={`Marcar ${invoiceNumber(i.series, i.number)} para el pago masivo`}
                          className="h-4 w-4 accent-[#F5B800] disabled:opacity-40"
                          data-factura={invoiceNumber(i.series, i.number)}
                          data-monto={Number(i.detractionAmount ?? 0)}
                          data-proveedor-id={i.supplierId}
                          data-proveedor={i.supplierName}
                          data-cuenta={i.supplierDetractionAccount ?? ""}
                        />
                      );
                    })()}
                  </Td>
                )}
                <Td>
                  <Link href={`/facturas/${i.id}`} className="font-semibold tabular hover:underline">
                    {invoiceNumber(i.series, i.number)}
                  </Link>
                  {i.clientName && <p className="text-xs text-steel-500">{i.clientName}{i.plate && ` · ${i.plate}`}</p>}
                </Td>
                <Td>
                  <p className="font-medium">{i.supplierName}</p>
                  <p className="text-xs text-steel-500">{i.supplierRuc ? `RUC ${i.supplierRuc}` : "RUC pendiente"}</p>
                  {i.detractionStatus === "PENDIENTE" && !i.supplierDetractionAccount && (
                    <p className="text-xs text-[#7A5A00]">Sin cuenta del Banco de la Nación</p>
                  )}
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 2xl:table-cell">{formatDate(i.issueDate)}</Td>
                <Td className="whitespace-nowrap text-right tabular text-steel-600">{formatMoney(i.total, i.currency)}</Td>
                <Td className="whitespace-nowrap text-right font-display text-base font-bold tabular">
                  {formatMoney(i.detractionAmount, i.currency)}
                </Td>
                <Td>
                  <DetractionBadge status={i.detractionStatus} />
                  {i.detractionPaidAt && <p className="mt-1 text-xs text-steel-500">{formatDate(i.detractionPaidAt)}</p>}
                  {i.detractionBatchId && loteDe.get(i.detractionBatchId) && (
                    <p className="mt-1 text-xs text-steel-500">Lote {loteDe.get(i.detractionBatchId)}</p>
                  )}
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
