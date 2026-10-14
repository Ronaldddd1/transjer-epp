import { ArrowLeft, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DiscardEmailModal, InvoiceFromEmailModal, RetryEmailButton } from "@/components/invoices/email-actions";
import { MailboxPanel } from "@/components/invoices/mailbox-panel";
import { EmailStatusBadge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EMAIL_STATUS_LABEL, formatDateTime, formatFileSize, invoiceNumber, pageParams, type SearchParams } from "@/lib/utils";
import { notificationUrl } from "@/server/graph";
import { missingMailboxSettings, readMailboxConfig } from "@/server/mailbox-config";
import { attachmentsByEmail, getSupplierOptions, listInvoiceEmails, readEmailFilters } from "@/server/invoice-queries";
import { getSubscriptionState, getSyncState, minutesToExpiry } from "@/server/mailbox-state";

export const metadata: Metadata = { title: "Correos de facturas" };
export const dynamic = "force-dynamic";

export default async function MailboxPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("invoices.manage");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readEmailFilters(sp);

  const config = readMailboxConfig();
  const [{ rows, total }, subscription, sync, suppliers] = await Promise.all([
    listInvoiceEmails(f, pageSize, offset),
    config?.kind === "graph" ? getSubscriptionState() : Promise.resolve(null),
    getSyncState(),
    getSupplierOptions(),
  ]);
  const attachments = await attachmentsByEmail(rows.map((r) => r.id));

  const status = {
    configured: !!config,
    // IMAP o Microsoft 365: cambia qué botones tienen sentido y qué se le explica a quien mira.
    tipo: config?.kind ?? null,
    missing: missingMailboxSettings(),
    mailbox: config?.mailbox ?? null,
    notificationUrl: notificationUrl(),
    active: !!subscription,
    expiresAt: subscription?.expirationDateTime ?? null,
    minutesToExpiry: minutesToExpiry(subscription),
    lastSyncAt: sync?.at ?? null,
    lastMessageAt: sync?.lastMessageAt ?? null,
    lastError: sync?.lastError ?? null,
  };

  return (
    <>
      <Link href="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a facturas
      </Link>

      <PageHeader
        title="Correos de facturas"
        description="Todo lo que llega al buzón queda aquí. Los correos con el XML del comprobante se registran solos."
        actions={<ExportTable tabla="correos" />}
      />

      <MailboxPanel status={status} canConfigure={can(user.role, "invoices.mailbox")} />

      <FilterBar
        searchPlaceholder="Buscar asunto o remitente"
        filters={[
          { type: "select", name: "estado", label: "Estado", allLabel: "Todos", options: Object.entries(EMAIL_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Recibido</Th>
            <Th>Asunto y remitente</Th>
            <Th>Estado</Th>
            <Th>Resultado</Th>
            <Th className="hidden 2xl:table-cell">Archivos</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={6}
              title="No hay correos registrados"
              hint={status.configured
                ? "Cuando llegue una factura al buzón aparecerá aquí. Puedes forzar una revisión con Revisar ahora."
                : "Esta bandeja se llena cuando se conecta el buzón de correo."}
            />
          )}
          {rows.map((e) => {
            const files = attachments.get(e.id) ?? [];
            const pendiente = e.status === "REVISAR" || e.status === "ERROR";
            return (
              <Tr key={e.id}>
                <Td className="whitespace-nowrap tabular text-steel-600">{formatDateTime(e.receivedAt)}</Td>
                <Td>
                  <p className="line-clamp-2 w-56 font-medium xl:w-72">{e.subject ?? "(sin asunto)"}</p>
                  <p className="text-xs text-steel-500">{e.fromName ?? e.fromAddress ?? "Remitente desconocido"}</p>
                  {e.fromName && e.fromAddress && <p className="text-xs text-steel-400">{e.fromAddress}</p>}
                  <p className="mt-1 text-xs text-steel-500 2xl:hidden">{files.length} archivo(s)</p>
                </Td>
                <Td><EmailStatusBadge status={e.status} /></Td>
                <Td>
                  {e.invoiceId ? (
                    <Link href={`/facturas/${e.invoiceId}`} className="font-medium hover:underline">
                      {e.invoiceSeries && e.invoiceNumber ? invoiceNumber(e.invoiceSeries, e.invoiceNumber) : "Ver factura"}
                    </Link>
                  ) : null}
                  {e.supplierName && <p className="text-xs text-steel-500">{e.supplierName}</p>}
                  {e.detail && <p className="line-clamp-3 w-48 text-xs text-steel-500 xl:w-64" title={e.detail}>{e.detail}</p>}
                  {!e.invoiceId && !e.detail && <span className="text-steel-400">—</span>}
                </Td>
                <Td className="hidden 2xl:table-cell">
                  {files.length === 0 ? <span className="text-steel-400">—</span> : (
                    <ul className="grid gap-0.5">
                      {files.map((a) => (
                        <li key={a.id}>
                          <a href={`/api/facturas/adjuntos/${a.id}`} target="_blank" rel="noreferrer"
                            className="inline-flex max-w-[16rem] items-center gap-1 text-xs text-steel-600 hover:text-ink hover:underline">
                            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="truncate">{a.filename}</span>
                            <span className="shrink-0 text-steel-400">{formatFileSize(a.sizeBytes)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    {pendiente && (
                      <>
                        <InvoiceFromEmailModal emailId={e.id} subject={e.subject ?? "(sin asunto)"} suppliers={suppliers} />
                        {status.configured && <RetryEmailButton id={e.id} subject={e.subject ?? "(sin asunto)"} />}
                        <DiscardEmailModal id={e.id} subject={e.subject ?? "(sin asunto)"} />
                      </>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
      <Pagination basePath="/facturas/correos" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
