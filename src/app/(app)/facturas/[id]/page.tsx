import { ArrowLeft, Download, FileText, Mail, Paperclip } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RemoveAttachmentButton, UploadAttachmentsModal } from "@/components/invoices/attachments";
import { GuideReceivedModal, InvoiceReasonModal, PayInvoiceModal, RestoreInvoiceButton } from "@/components/invoices/invoice-actions";
import { InvoiceFormModal } from "@/components/invoices/invoice-form-modal";
import { Badge, DetractionBadge, DueBadge, InvoiceStatusBadge, PaymentTermBadge } from "@/components/ui/badge";
import { DetractionModal } from "@/components/invoices/detraction-actions";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ATTACHMENT_KIND_LABEL, cn, formatDate, formatDateTime, formatFileSize, formatMoney,
  DETRACTION_THRESHOLD, INVOICE_DOC_TYPE_LABEL, INVOICE_SERVICE_TYPE_LABEL, INVOICE_SOURCE_LABEL,
  invoiceNumber, netoAPagar, PAYMENT_TERM_LABEL, saldoAPagar,
} from "@/lib/utils";
import { getClientOptions, getInvoice, getInvoiceEmail, getSupplierOptions, listInvoiceAttachments } from "@/server/invoice-queries";
import { maxBytesFor } from "@/server/storage";

export const metadata: Metadata = { title: "Detalle de factura" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-steel-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] text-ink-800">{children}</dd>
    </div>
  );
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("invoices.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const [attachments, email, suppliers, clients] = await Promise.all([
    listInvoiceAttachments(id),
    getInvoiceEmail(id),
    can(user.role, "invoices.manage") ? getSupplierOptions() : Promise.resolve([]),
    can(user.role, "invoices.manage") ? getClientOptions() : Promise.resolve([]),
  ]);

  const canManage = can(user.role, "invoices.manage");
  const canPay = can(user.role, "invoices.pay");
  const canDetraction = can(user.role, "detractions.manage");
  const detraccion = {
    id: invoice.id, series: invoice.series, number: invoice.number, currency: invoice.currency,
    total: invoice.total, supplierName: invoice.supplierName,
    detractionAmount: invoice.detractionAmount, detractionStatus: invoice.detractionStatus,
    detractionPaidAt: invoice.detractionPaidAt, detractionReceipt: invoice.detractionReceipt,
    detractionOperation: invoice.detractionOperation, detractionNotes: invoice.detractionNotes,
  };
  const neto = Number(invoice.total) - Number(invoice.detractionAmount ?? 0);
  const saldo = neto - Number(invoice.advances ?? 0);
  // El cuadro del viaje se muestra en toda factura de transporte, aunque esté vacía: lo
  // que falta ahí es justo lo que hay que completar a mano.
  const tieneServicio = invoice.serviceType === "TRANSPORTE"
    || !!(invoice.plate || invoice.clientName || invoice.originCity || invoice.destinationCity);
  const maxMb = Math.floor(maxBytesFor() / 1024 / 1024);
  const ref = {
    detractionAmount: invoice.detractionAmount, advances: invoice.advances,
    id: invoice.id, series: invoice.series, number: invoice.number,
    currency: invoice.currency, total: invoice.total, supplierName: invoice.supplierName,
  };
  const editable = invoice.status === "PENDIENTE" || invoice.status === "OBSERVADA";

  return (
    <>
      <Link href="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a facturas
      </Link>

      <PageHeader
        title={invoiceNumber(invoice.series, invoice.number)}
        description={`${INVOICE_DOC_TYPE_LABEL[invoice.docType]} de ${invoice.supplierName}`}
        actions={
          <>
            {canPay && editable && <PayInvoiceModal invoice={ref} />}
            {canManage && editable && <InvoiceFormModal suppliers={suppliers} invoice={{
              id: invoice.id, supplierId: invoice.supplierId, docType: invoice.docType,
              serviceType: invoice.serviceType, series: invoice.series,
              number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate, serviceDate: invoice.serviceDate,
              currency: invoice.currency, subtotal: invoice.subtotal, igv: invoice.igv, total: invoice.total,
              description: invoice.description, grtNumber: invoice.grtNumber, notes: invoice.notes,
              receptionDate: invoice.receptionDate,
              paymentTerm: invoice.paymentTerm, termDays: invoice.termDays, guideReceivedAt: invoice.guideReceivedAt,
              contactName: invoice.contactName, plate: invoice.plate, clientName: invoice.clientName,
              originCity: invoice.originCity, destinationCity: invoice.destinationCity,
              volumeM3: invoice.volumeM3, weightTn: invoice.weightTn, advances: invoice.advances,
            }} clients={clients} />}
            {canManage && editable && invoice.paymentTerm === "CREDITO" && !invoice.guideReceivedAt && (
              <GuideReceivedModal invoice={ref} />
            )}
            {canManage && invoice.status === "PENDIENTE" && <InvoiceReasonModal invoice={ref} action="observe" />}
            {canManage && invoice.status === "OBSERVADA" && <RestoreInvoiceButton invoice={ref} />}
            {canPay && invoice.status === "PAGADA" && <InvoiceReasonModal invoice={ref} action="reopen" />}
            {canDetraction && invoice.detractionStatus !== "NO_APLICA" && invoice.status !== "ANULADA" && (
              <DetractionModal invoice={detraccion} variant="outline" />
            )}
            {canManage && editable && <InvoiceReasonModal invoice={ref} action="void" />}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InvoiceStatusBadge status={invoice.status} dueDate={invoice.payDueDate} />
        <span className="font-display text-2xl font-bold text-ink">{formatMoney(invoice.total, invoice.currency)}</span>
        <PaymentTermBadge term={invoice.paymentTerm} termDays={invoice.termDays} />
        {invoice.status === "PENDIENTE" && <DueBadge payDueDate={invoice.payDueDate} />}
        {invoice.isDemo && <Badge tone="neutral">Prueba</Badge>}
      </div>

      {invoice.status === "PENDIENTE" && invoice.paymentTerm === "CREDITO" && !invoice.guideReceivedAt && (
        <p className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Esta factura es a crédito y todavía no tiene fecha de pago: el plazo de {invoice.termDays} día(s)
          empieza a correr recién cuando el proveedor entregue la guía de remisión en físico.
          {canManage && " Usa el botón «Anotar guía» cuando la traiga."}
        </p>
      )}

      {invoice.statusReason && invoice.status !== "PAGADA" && (
        <p className={cn(
          "mb-4 rounded-lg border px-4 py-3 text-sm",
          invoice.status === "ANULADA" ? "border-steel-200 bg-steel-50 text-steel-600" : "border-red-200 bg-red-50 text-red-800",
        )}>
          <strong>Motivo:</strong> {invoice.statusReason}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <Panel title="Datos del comprobante">
            <dl className="grid grid-cols-2 divide-x divide-y divide-steel-100 border-t border-steel-100 sm:grid-cols-3">
              <Dato label="Tipo">
                {INVOICE_DOC_TYPE_LABEL[invoice.docType]}
                {invoice.serviceType && (
                  <span className="text-steel-500"> · {INVOICE_SERVICE_TYPE_LABEL[invoice.serviceType]}</span>
                )}
              </Dato>
              <Dato label="Número">{invoiceNumber(invoice.series, invoice.number)}</Dato>
              <Dato label="Moneda">{invoice.currency === "USD" ? "Dólares (US$)" : "Soles (S/)"}</Dato>
              <Dato label="Emisión">{formatDate(invoice.issueDate)}</Dato>
              <Dato label="Vencimiento">{formatDate(invoice.dueDate)}</Dato>
              <Dato label="Fecha del servicio">{formatDate(invoice.serviceDate)}</Dato>
              <Dato label="Subtotal">{formatMoney(invoice.subtotal, invoice.currency)}</Dato>
              <Dato label="IGV">{formatMoney(invoice.igv, invoice.currency)}</Dato>
              <Dato label="Total"><strong>{formatMoney(invoice.total, invoice.currency)}</strong></Dato>
              {/* Lo que de verdad sale hacia el proveedor: la detracción va al Banco de
                  la Nación, así que el total nunca es lo que se le transfiere. */}
              <Dato label="Neto sin detracción">
                {formatMoney(netoAPagar(invoice.total, invoice.detractionAmount), invoice.currency)}
              </Dato>
              <Dato label="Adelantos entregados">
                {Number(invoice.advances ?? 0) > 0 ? formatMoney(invoice.advances, invoice.currency) : "—"}
              </Dato>
              {/* Lo que queda por transferirle: el neto menos lo ya adelantado. */}
              <Dato label="Saldo a transferir">
                <strong>{formatMoney(saldoAPagar(invoice.total, invoice.detractionAmount, invoice.advances), invoice.currency)}</strong>
              </Dato>
              <Dato label="Guía del transportista">{invoice.grtNumber ?? "—"}</Dato>
              <Dato label="Guía del remitente">{invoice.dispatchNote ?? "—"}</Dato>
              <Dato label="Origen">{INVOICE_SOURCE_LABEL[invoice.source]}</Dato>
              <Dato label="Llegó el correo">{formatDate(invoice.receptionDate)}</Dato>
              <Dato label="Condición">{PAYMENT_TERM_LABEL[invoice.paymentTerm]} · {invoice.termDays} día(s)</Dato>
              <Dato label="Guía entregada">{invoice.guideReceivedAt ? formatDate(invoice.guideReceivedAt) : "—"}</Dato>
              <Dato label="Fecha límite de pago">
                {invoice.payDueDate ? <strong>{formatDate(invoice.payDueDate)}</strong> : <span className="text-sky-800">Esperando la guía</span>}
              </Dato>
              <Dato label="Registrada por">{invoice.createdByName ?? "—"}</Dato>
            </dl>
            {(invoice.description || invoice.notes) && (
              <div className="border-t border-steel-100 px-4 py-3 text-sm">
                {invoice.description && <p className="text-ink-800"><span className="text-steel-500">Concepto: </span>{invoice.description}</p>}
                {invoice.notes && <p className="mt-1 text-steel-600"><span className="text-steel-500">Observaciones: </span>{invoice.notes}</p>}
              </div>
            )}
          </Panel>

          {tieneServicio && (
            <Panel title="Servicio de transporte">
              <dl className="grid grid-cols-2 divide-x divide-y divide-steel-100 border-t border-steel-100 sm:grid-cols-3">
                <Dato label="Cliente">{invoice.clientName ?? "—"}</Dato>
                <Dato label="Placa">{invoice.plate ?? "—"}</Dato>
                <Dato label="Contacto">{invoice.contactName ?? "—"}</Dato>
                <Dato label="Origen">{invoice.originCity ?? "—"}</Dato>
                <Dato label="Destino">{invoice.destinationCity ?? "—"}</Dato>
                <Dato label="Carga">
                  {[invoice.volumeM3 && `${Number(invoice.volumeM3)} m³`, invoice.weightTn && `${Number(invoice.weightTn)} tn`]
                    .filter(Boolean).join(" · ") || "—"}
                </Dato>
              </dl>
            </Panel>
          )}

          <Panel title="Detracción">
            <dl className="grid grid-cols-2 divide-x divide-y divide-steel-100 border-t border-steel-100 sm:grid-cols-3">
              <Dato label="Estado"><DetractionBadge status={invoice.detractionStatus} /></Dato>
              <Dato label="Tasa">{Number(invoice.detractionRate)} %</Dato>
              <Dato label="Monto a depositar">
                <strong>{formatMoney(invoice.detractionAmount, invoice.currency)}</strong>
              </Dato>
              <Dato label="Fecha del depósito">{invoice.detractionPaidAt ? formatDate(invoice.detractionPaidAt) : "—"}</Dato>
              <Dato label="N.º de constancia">{invoice.detractionReceipt ?? "—"}</Dato>
              <Dato label="N.º de operación">{invoice.detractionOperation ?? "—"}</Dato>
            </dl>
            <div className="border-t border-steel-100 px-4 py-3 text-sm">
              {invoice.detractionStatus === "NO_APLICA" ? (
                <p className="text-steel-600">
                  La operación no supera los S/ {DETRACTION_THRESHOLD}, así que no se detrae y al proveedor
                  se le paga el total.
                </p>
              ) : (
                <p className="text-steel-600">
                  Al proveedor se le pagan <strong className="text-ink">{formatMoney(neto.toFixed(2), invoice.currency)}</strong>
                  {Number(invoice.advances) > 0 && (
                    <> · adelantado {formatMoney(invoice.advances, invoice.currency)}, queda {formatMoney(saldo.toFixed(2), invoice.currency)}</>
                  )}
                  . El resto va al Banco de la Nación.
                </p>
              )}
              {invoice.detractionNotes && <p className="mt-1 text-steel-600"><span className="text-steel-500">Observaciones: </span>{invoice.detractionNotes}</p>}
            </div>
          </Panel>

          {invoice.status === "PAGADA" && (
            <Panel title="Pago registrado">
              <dl className="grid grid-cols-2 divide-x divide-y divide-steel-100 border-t border-steel-100 sm:grid-cols-3">
                <Dato label="Fecha de pago">{formatDate(invoice.paidAt)}</Dato>
                <Dato label="Referencia">{invoice.paymentReference ?? "—"}</Dato>
                <Dato label="Registrado por">{invoice.paidByName ?? "—"}</Dato>
              </dl>
              {invoice.paymentNotes && <p className="border-t border-steel-100 px-4 py-3 text-sm text-steel-600">{invoice.paymentNotes}</p>}
            </Panel>
          )}

          <Panel
            title="Archivos"
            action={canManage && invoice.status !== "ANULADA" ? <UploadAttachmentsModal invoiceId={invoice.id} maxMb={maxMb} /> : undefined}
          >
            {attachments.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Paperclip className="mx-auto h-6 w-6 text-steel-300" aria-hidden />
                <p className="mt-2 text-sm text-steel-500">Esta factura todavía no tiene archivos adjuntos.</p>
              </div>
            ) : (
              <ul className="divide-y divide-steel-100 border-t border-steel-100">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <FileText className="h-5 w-5 shrink-0 text-steel-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <a href={`/api/facturas/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="block truncate font-medium text-ink hover:underline">
                        {a.filename}
                      </a>
                      <p className="text-xs text-steel-500">
                        {ATTACHMENT_KIND_LABEL[a.kind]} · {formatFileSize(a.sizeBytes)}
                        {a.uploadedByName && ` · ${a.uploadedByName}`}
                      </p>
                    </div>
                    <a
                      href={`/api/facturas/adjuntos/${a.id}`}
                      download
                      className="rounded p-2 text-steel-500 hover:bg-steel-100 hover:text-ink"
                      title={`Descargar ${a.filename}`}
                      aria-label={`Descargar ${a.filename}`}
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    {canManage && <RemoveAttachmentButton id={a.id} filename={a.filename} />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          <Panel title="Proveedor">
            <dl className="divide-y divide-steel-100 border-t border-steel-100">
              <Dato label="Razón social">{invoice.supplierName}</Dato>
              <Dato label="RUC">{invoice.supplierRuc}</Dato>
            </dl>
            <div className="border-t border-steel-100 px-4 py-3">
              <Link href={`/facturas?proveedor=${invoice.supplierId}`} className="text-sm text-steel-600 hover:text-ink hover:underline">
                Ver todas sus facturas
              </Link>
            </div>
          </Panel>

          {email && (
            <Panel title="Correo recibido">
              <dl className="divide-y divide-steel-100 border-t border-steel-100">
                <Dato label="Asunto">{email.subject ?? "—"}</Dato>
                <Dato label="Remitente">
                  {email.fromName ?? "—"}
                  {email.fromAddress && <p className="text-xs text-steel-500">{email.fromAddress}</p>}
                </Dato>
                <Dato label="Recibido">{formatDateTime(email.receivedAt)}</Dato>
              </dl>
              {canManage && (
                <div className="border-t border-steel-100 px-4 py-3">
                  <Link href="/facturas/correos" className="inline-flex items-center gap-1.5 text-sm text-steel-600 hover:text-ink hover:underline">
                    <Mail className="h-4 w-4" /> Ver la bandeja de correos
                  </Link>
                </div>
              )}
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
