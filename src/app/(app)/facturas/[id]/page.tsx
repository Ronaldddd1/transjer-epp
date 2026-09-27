import { ArrowLeft, Download, FileText, Mail, Paperclip } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RemoveAttachmentButton, UploadAttachmentsModal } from "@/components/invoices/attachments";
import { InvoiceReasonModal, PayInvoiceModal, RestoreInvoiceButton } from "@/components/invoices/invoice-actions";
import { InvoiceFormModal } from "@/components/invoices/invoice-form-modal";
import { Badge, InvoiceStatusBadge, PaymentFridayBadge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ATTACHMENT_KIND_LABEL, cn, formatDate, formatDateTime, formatFileSize, formatMoney,
  INVOICE_DOC_TYPE_LABEL, INVOICE_SOURCE_LABEL, invoiceNumber,
} from "@/lib/utils";
import { getInvoice, getInvoiceEmail, getSupplierOptions, listInvoiceAttachments } from "@/server/invoice-queries";
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

  const [attachments, email, suppliers] = await Promise.all([
    listInvoiceAttachments(id),
    getInvoiceEmail(id),
    can(user.role, "invoices.manage") ? getSupplierOptions() : Promise.resolve([]),
  ]);

  const canManage = can(user.role, "invoices.manage");
  const canPay = can(user.role, "invoices.pay");
  const maxMb = Math.floor(maxBytesFor() / 1024 / 1024);
  const ref = {
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
              id: invoice.id, supplierId: invoice.supplierId, docType: invoice.docType, series: invoice.series,
              number: invoice.number, issueDate: invoice.issueDate, dueDate: invoice.dueDate, serviceDate: invoice.serviceDate,
              currency: invoice.currency, subtotal: invoice.subtotal, igv: invoice.igv, total: invoice.total,
              description: invoice.description, grtNumber: invoice.grtNumber, notes: invoice.notes,
              receptionDate: invoice.receptionDate,
            }} />}
            {canManage && invoice.status === "PENDIENTE" && <InvoiceReasonModal invoice={ref} action="observe" />}
            {canManage && invoice.status === "OBSERVADA" && <RestoreInvoiceButton invoice={ref} />}
            {canPay && invoice.status === "PAGADA" && <InvoiceReasonModal invoice={ref} action="reopen" />}
            {canManage && editable && <InvoiceReasonModal invoice={ref} action="void" />}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <InvoiceStatusBadge status={invoice.status} dueDate={invoice.dueDate} />
        <span className="font-display text-2xl font-bold text-ink">{formatMoney(invoice.total, invoice.currency)}</span>
        {invoice.status === "PENDIENTE" && (
          <PaymentFridayBadge scheduled={invoice.scheduledFriday} effective={invoice.effectiveFriday} />
        )}
        {invoice.isDemo && <Badge tone="neutral">Prueba</Badge>}
      </div>

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
              <Dato label="Tipo">{INVOICE_DOC_TYPE_LABEL[invoice.docType]}</Dato>
              <Dato label="Número">{invoiceNumber(invoice.series, invoice.number)}</Dato>
              <Dato label="Moneda">{invoice.currency === "USD" ? "Dólares (US$)" : "Soles (S/)"}</Dato>
              <Dato label="Emisión">{formatDate(invoice.issueDate)}</Dato>
              <Dato label="Vencimiento">{formatDate(invoice.dueDate)}</Dato>
              <Dato label="Fecha del servicio">{formatDate(invoice.serviceDate)}</Dato>
              <Dato label="Subtotal">{formatMoney(invoice.subtotal, invoice.currency)}</Dato>
              <Dato label="IGV">{formatMoney(invoice.igv, invoice.currency)}</Dato>
              <Dato label="Total"><strong>{formatMoney(invoice.total, invoice.currency)}</strong></Dato>
              <Dato label="Guía de remisión">{invoice.grtNumber ?? "—"}</Dato>
              <Dato label="Origen">{INVOICE_SOURCE_LABEL[invoice.source]}</Dato>
              <Dato label="Llegó el">{formatDate(invoice.receptionDate)}</Dato>
              <Dato label="Registrada por">{invoice.createdByName ?? "—"}</Dato>
            </dl>
            {(invoice.description || invoice.notes) && (
              <div className="border-t border-steel-100 px-4 py-3 text-sm">
                {invoice.description && <p className="text-ink-800"><span className="text-steel-500">Concepto: </span>{invoice.description}</p>}
                {invoice.notes && <p className="mt-1 text-steel-600"><span className="text-steel-500">Observaciones: </span>{invoice.notes}</p>}
              </div>
            )}
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
