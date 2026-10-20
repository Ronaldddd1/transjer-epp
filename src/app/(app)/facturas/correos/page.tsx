import { ArrowLeft, MailX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AceptarModal, AplicarNotaCreditoModal, RechazarModal, VerComprobanteModal,
  type ComprobanteLeido, type CorreoParaDecidir,
} from "@/components/invoices/approval-actions";
import { DiscardEmailModal, InvoiceFromEmailModal, RetryEmailButton } from "@/components/invoices/email-actions";
import { MailboxPanel } from "@/components/invoices/mailbox-panel";
import { EmailStatusBadge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { TabLinks } from "@/components/ui/tab-links";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, EMAIL_STATUS_LABEL, first, formatDateTime, formatMoney, invoiceNumber, pageParams, type SearchParams,
} from "@/lib/utils";
import { leerConceptoTransporte, pareceTransporte } from "@/server/concepto-transporte";
import { notificationUrl } from "@/server/graph";
import { missingMailboxSettings, readMailboxConfig } from "@/server/mailbox-config";
import {
  attachmentsByEmail, emailCounts, getSupplierOptions, listInvoiceEmails, readEmailFilters,
} from "@/server/invoice-queries";
import { getSubscriptionState, getSyncState, minutesToExpiry } from "@/server/mailbox-state";

export const metadata: Metadata = { title: "Correos de facturas" };
export const dynamic = "force-dynamic";

/**
 * La bandeja de comprobantes que llegan por correo.
 *
 * Esta pantalla existe para una decisión: aceptar o rechazar lo que manda el proveedor.
 * Por eso se entra por "Por aprobar", los datos del comprobante se ven sin salir de aquí
 * y las columnas son las justas para que la tabla entre en el ancho de la pantalla: la
 * versión anterior obligaba a bajar hasta la barra de abajo y correrla a mano para
 * llegar al botón.
 */
export default async function MailboxPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("invoices.manage");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readEmailFilters(sp);

  // Sin pestaña elegida se entra por lo que espera decisión, que es a lo que se viene.
  // Si se está buscando algo, no: una búsqueda acotada a una pestaña no encontraría el
  // correo que se busca y parecería que no existe.
  const buscando = !!(f.q || f.from || f.to);
  const pestaña = first(sp.estado) ?? (buscando ? "" : "POR_APROBAR");
  const filtros = { ...f, status: buscando && !first(sp.estado) ? undefined : f.status };

  const config = readMailboxConfig();
  const [{ rows, total }, cuentas, subscription, sync, suppliers] = await Promise.all([
    listInvoiceEmails(filtros, pageSize, offset),
    emailCounts(),
    config?.kind === "graph" ? getSubscriptionState() : Promise.resolve(null),
    getSyncState(),
    getSupplierOptions(),
  ]);
  const attachments = await attachmentsByEmail(rows.map((r) => r.id));

  const canApprove = can(user.role, "invoices.approve");
  const canManage = can(user.role, "invoices.manage");

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

  /** Lo pactado con ese proveedor, cuando ya está registrado. */
  const condicionDe = (ruc: string | null | undefined) => {
    if (!ruc) return null;
    const s = suppliers.find((x) => x.ruc === ruc);
    return s ? { paymentTerm: s.defaultPaymentTerm, termDays: s.defaultTermDays } : null;
  };

  /** La fila, en la forma que necesitan los modales de decidir. */
  const paraDecidir = (e: (typeof rows)[number]): CorreoParaDecidir => ({
    id: e.id,
    subject: e.subject,
    fromName: e.fromName,
    fromAddress: e.fromAddress,
    receivedAt: e.receivedAt.toISOString(),
    status: e.status,
    detail: e.detail,
    comprobante: (e.parsed as ComprobanteLeido | null) ?? null,
    archivos: (attachments.get(e.id) ?? []).map((a) => ({ id: a.id, filename: a.filename, sizeBytes: a.sizeBytes })),
    rejectReason: e.rejectReason,
    rejectComment: e.rejectComment,
    replyTo: e.replyTo,
    replySentAt: e.replySentAt?.toISOString() ?? null,
    replyError: e.replyError,
    decidedAt: e.decidedAt?.toISOString() ?? null,
    decidedByName: e.decidedByName,
    // El concepto del XML se lee aquí, en el servidor, y viaja ya leído: así el
    // formulario de aceptar abre con la fecha, la placa, el cliente y la ruta puestas.
    ...(() => {
      const concepto = (e.parsed as ComprobanteLeido | null)?.description ?? null;
      const viaje = leerConceptoTransporte(concepto);
      return {
        pareceTransporte: pareceTransporte(concepto),
        viaje: { ...viaje, leido: Object.values(viaje).some(Boolean) },
      };
    })(),
  });

  return (
    <>
      <Link href="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a facturas
      </Link>

      <PageHeader
        title="Comprobantes recibidos"
        description="Lo que llega al buzón de facturas espera aquí a que se acepte o se rechace. Nada se registra solo."
        actions={<ExportTable tabla="correos" />}
      />

      <MailboxPanel status={status} canConfigure={can(user.role, "invoices.mailbox")} />

      {cuentas.porAprobar > 0 && (
        <p className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <strong>{cuentas.porAprobar} comprobante(s)</strong> esperan tu decisión. Mientras no se acepten no
          figuran como deuda, y el proveedor sigue esperando respuesta.
        </p>
      )}

      <TabLinks
        name="estado"
        current={pestaña}
        base="/facturas/correos"
        params={sp}
        className="mb-3"
        tabs={[
          { value: "POR_APROBAR", label: "Por aprobar", count: cuentas.porAprobar },
          { value: "REVISAR", label: "Por revisar", count: cuentas.revisar },
          { value: "PROCESADO", label: "Aceptados", count: cuentas.aceptados },
          { value: "RECHAZADO", label: "Rechazados", count: cuentas.rechazados },
          { value: "", label: "Todos", count: cuentas.total },
        ]}
      />

      <FilterBar
        searchPlaceholder="Buscar asunto o remitente"
        filters={[
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Comprobante</Th>
            <Th>Proveedor</Th>
            <Th className="text-right">Importe</Th>
            <Th className="hidden xl:table-cell">Recibido</Th>
            <Th>Estado</Th>
            {/* Fija a la derecha: aquí están los botones de decidir y tienen que estar
                siempre a la vista, sin correr la tabla. */}
            <Th className="sticky right-0 z-10 bg-steel-50 text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={6}
              title={pestaña === "POR_APROBAR" ? "No hay nada esperando decisión" : "No hay correos para mostrar"}
              hint={status.configured
                ? "Cuando llegue una factura al buzón aparecerá aquí. Puedes forzar una revisión con Revisar ahora."
                : "Esta bandeja se llena cuando se conecta el buzón de correo."}
            />
          )}
          {rows.map((e) => {
            const correo = paraDecidir(e);
            const c = correo.comprobante;
            const porAprobar = e.status === "POR_APROBAR";
            const sinLeer = e.status === "REVISAR" || e.status === "ERROR";
            const avisoFallido = e.status === "RECHAZADO" && !e.replySentAt;
            return (
              <Tr key={e.id} tone={porAprobar ? "bg-blue-50/60 hover:bg-blue-50" : undefined}>
                <Td>
                  {c ? (
                    <>
                      <p className="font-medium">{invoiceNumber(c.series, c.number)}</p>
                      <p className="text-xs text-steel-500">{e.subject ?? "(sin asunto)"}</p>
                    </>
                  ) : (
                    <>
                      <p className="line-clamp-2 w-52 font-medium">{e.subject ?? "(sin asunto)"}</p>
                      <p className="text-xs text-steel-500">Sin XML legible</p>
                    </>
                  )}
                </Td>
                <Td>
                  <p className="line-clamp-2 w-48">{c?.supplierName ?? e.supplierName ?? e.fromName ?? e.fromAddress ?? "—"}</p>
                  {c?.supplierRuc && <p className="text-xs text-steel-500">RUC {c.supplierRuc}</p>}
                </Td>
                <Td className="whitespace-nowrap text-right font-medium tabular">
                  {c ? formatMoney(c.total, c.currency) : <span className="text-steel-400">—</span>}
                </Td>
                <Td className="hidden whitespace-nowrap tabular text-steel-600 xl:table-cell">{formatDateTime(e.receivedAt)}</Td>
                <Td>
                  <EmailStatusBadge status={e.status} />
                  {e.invoiceId && (
                    <Link href={`/facturas/${e.invoiceId}`} className="mt-0.5 block text-xs text-steel-600 hover:underline">
                      Ver la factura
                    </Link>
                  )}
                  {avisoFallido && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700" title={e.replyError ?? undefined}>
                      <MailX className="h-3.5 w-3.5 shrink-0" aria-hidden /> sin avisar
                    </p>
                  )}
                  {!e.invoiceId && !avisoFallido && e.detail && (
                    <p className="line-clamp-2 w-44 text-xs text-steel-500" title={e.detail}>{e.detail}</p>
                  )}
                </Td>
                <Td className={cn("sticky right-0 z-10 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]", porAprobar ? "bg-blue-50" : "bg-white")}>
                  <div className="flex items-center justify-end gap-1">
                    <VerComprobanteModal correo={correo} />
                    {porAprobar && canApprove && (
                      <>
                        {/* Una nota de crédito no se "acepta" como factura por pagar: se
                            aplica a la factura que anula, que es lo único que cabe hacer
                            con ella. */}
                        {c?.docType === "NOTA_CREDITO" ? (
                          <AplicarNotaCreditoModal correo={correo} />
                        ) : (
                          /* Si ese proveedor ya está registrado, la condición de pago que
                             se propone es la pactada con él, no la de por defecto. */
                          <AceptarModal correo={correo} condicion={condicionDe(c?.supplierRuc)} />
                        )}
                        <RechazarModal correo={correo} />
                      </>
                    )}
                    {sinLeer && canManage && (
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

      <p className="mt-3 text-xs text-steel-500">
        {EMAIL_STATUS_LABEL.POR_APROBAR}: el comprobante se leyó y espera decisión ·{" "}
        {EMAIL_STATUS_LABEL.REVISAR}: no se pudo leer el XML, se registra a mano ·{" "}
        {EMAIL_STATUS_LABEL.DESCARTADO}: no era una factura por pagar, o ya estaba registrada.
      </p>

      <Pagination basePath="/facturas/correos" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
