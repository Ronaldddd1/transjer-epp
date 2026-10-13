import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DeleteObligationButton, ExtendScheduleButton, ObligationStatusButton, PayInstallmentModal,
  ReopenInstallmentButton, SetAmountModal,
} from "@/components/obligations/installment-actions";
import { ObligationFormModal } from "@/components/obligations/obligation-form-modal";
import { ScheduleImportModal } from "@/components/obligations/schedule-import-modal";
import { Badge, InstallmentStatusBadge, ObligationStatusBadge } from "@/components/ui/badge";
import { ExportTable } from "@/components/ui/export-table";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, formatDate, formatMoney, OBLIGATION_TYPE_LABEL, todayLima } from "@/lib/utils";
import { getObligation, listInstallments, listObligationCategories } from "@/server/obligation-queries";

export const metadata: Metadata = { title: "Detalle de obligación" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-steel-500">{label}</dt>
      <dd className="mt-0.5 text-[15px] text-ink-800">{children}</dd>
    </div>
  );
}

export default async function ObligationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("obligations.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const obligation = await getObligation(id);
  if (!obligation) notFound();

  const installments = await listInstallments(id);
  const canManage = can(user.role, "obligations.manage");
  const conceptos = canManage ? await listObligationCategories() : [];
  const canPay = can(user.role, "obligations.pay");
  const esPrestamo = obligation.type === "PRESTAMO";
  const hoy = todayLima();

  const pagado = installments
    .filter((i) => i.status === "PAGADA")
    .reduce((s, i) => s + Number(i.paidAmount ?? i.total ?? 0), 0);
  const programado = installments
    .filter((i) => i.status !== "ANULADA")
    .reduce((s, i) => s + Number(i.total ?? 0), 0);

  return (
    <>
      <Link href="/obligaciones" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a préstamos y servicios
      </Link>

      <PageHeader
        title={obligation.name}
        description={`${OBLIGATION_TYPE_LABEL[obligation.type]} con ${obligation.creditor}`}
        actions={
          <>
            <ExportTable tabla="cronograma" extra={{ id: obligation.id }} label="Exportar cronograma" />
            {canManage && esPrestamo && (
              <ScheduleImportModal
                obligationId={obligation.id}
                currency={obligation.currency}
                principal={obligation.principal}
                annualRate={obligation.annualRate}
                disbursedAt={obligation.disbursedAt}
                hasSchedule={installments.length > 0}
              />
            )}
            {canManage && !esPrestamo && obligation.status === "ACTIVA" && <ExtendScheduleButton obligationId={obligation.id} />}
            {canManage && (
              <ObligationFormModal obligation={{
                id: obligation.id, type: obligation.type, name: obligation.name, creditor: obligation.creditor,
                reference: obligation.reference, category: obligation.category,
                currency: obligation.currency, principal: obligation.principal,
                annualRate: obligation.annualRate, installmentsCount: obligation.installmentsCount,
                disbursedAt: obligation.disbursedAt, billingDay: obligation.billingDay,
                firstDueDate: obligation.firstDueDate, endsAt: obligation.endsAt,
                variableAmount: obligation.variableAmount, fixedAmount: obligation.fixedAmount, notes: obligation.notes,
              }} conceptos={conceptos} />
            )}
            {canManage && obligation.status !== "ANULADA" && (
              <ObligationStatusButton id={obligation.id} status={obligation.status} name={obligation.name} />
            )}
            {canManage && (
              <DeleteObligationButton id={obligation.id} name={obligation.name} paidCount={obligation.paidCount} />
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ObligationStatusBadge status={obligation.status} />
        {obligation.nextAmount && (
          <span className="font-display text-2xl font-bold text-ink">{formatMoney(obligation.nextAmount, obligation.currency)}</span>
        )}
        {obligation.nextDueDate && (
          <span className={cn("text-sm", obligation.nextDueDate < hoy ? "font-semibold text-red-700" : "text-steel-600")}>
            {obligation.nextDueDate < hoy ? "Venció el" : "Próxima cuota el"} {formatDate(obligation.nextDueDate)}
          </span>
        )}
        {obligation.isDemo && <Badge tone="neutral">Prueba</Badge>}
      </div>

      {esPrestamo && installments.length === 0 && (
        <p className="mb-4 rounded-lg border border-brand/60 bg-brand-soft px-4 py-3 text-sm text-[#7A5A00]">
          Este préstamo todavía no tiene cronograma, así que no aparece en el calendario de pagos.
          {canManage && " Cárgalo con el botón de arriba: puedes pegar las filas del PDF del banco."}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <Panel
            title="Cronograma"
            action={installments.length > 0 && (
              <span className="text-sm text-steel-600">{obligation.paidCount} de {obligation.scheduleCount} cuotas pagadas</span>
            )}
          >
            <TableShell>
              <thead>
                <tr>
                  <Th>N.º</Th>
                  <Th>Vence</Th>
                  <Th className="hidden text-right 2xl:table-cell">Capital</Th>
                  <Th className="hidden text-right 2xl:table-cell">Interés</Th>
                  <Th className="text-right">Cuota</Th>
                  <Th className="hidden text-right 2xl:table-cell">Saldo</Th>
                  <Th>Estado</Th>
                  {(canPay || canManage) && <Th className="text-right">Acciones</Th>}
                </tr>
              </thead>
              <tbody>
                {installments.length === 0 && (
                  <EmptyRow colSpan={8} title="Sin cuotas todavía" />
                )}
                {installments.map((c) => {
                  const ref = {
                    id: c.id, number: c.number, dueDate: c.dueDate, total: c.total,
                    currency: obligation.currency, obligationName: obligation.name,
                  };
                  const vencida = c.status === "PENDIENTE" && c.dueDate < hoy;
                  return (
                    <Tr key={c.id} className={cn(c.status === "PAGADA" && "[&>td]:text-steel-500", vencida && "bg-red-50/40")}>
                      <Td className="tabular text-steel-500">{c.number}</Td>
                      <Td className="whitespace-nowrap tabular">{formatDate(c.dueDate)}</Td>
                      <Td className="hidden text-right tabular text-steel-600 2xl:table-cell">
                        {c.principal ? formatMoney(c.principal, obligation.currency) : "—"}
                      </Td>
                      <Td className="hidden text-right tabular text-steel-600 2xl:table-cell">
                        {c.interest ? formatMoney(c.interest, obligation.currency) : "—"}
                      </Td>
                      <Td className="whitespace-nowrap text-right font-semibold tabular">
                        {c.total ? formatMoney(c.total, obligation.currency) : <span className="font-normal text-brand-ink">falta el recibo</span>}
                      </Td>
                      <Td className="hidden text-right tabular text-steel-500 2xl:table-cell">
                        {c.balanceAfter ? formatMoney(c.balanceAfter, obligation.currency) : "—"}
                      </Td>
                      <Td>
                        <InstallmentStatusBadge status={c.status} dueDate={c.dueDate} />
                        {c.paidAt && (
                          <p className="mt-1 text-xs text-steel-500">
                            {formatDate(c.paidAt)}
                            {c.paidByName && ` · ${c.paidByName}`}
                          </p>
                        )}
                      </Td>
                      {(canPay || canManage) && (
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {canManage && c.status === "PENDIENTE" && !c.total && <SetAmountModal installment={ref} compact />}
                            {canPay && c.status === "PENDIENTE" && c.total && <PayInstallmentModal installment={ref} compact />}
                            {canPay && c.status === "PAGADA" && <ReopenInstallmentButton installment={ref} />}
                          </div>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
              </tbody>
            </TableShell>
          </Panel>
        </div>

        <aside className="grid content-start gap-4">
          <Panel title="Datos">
            <dl className="divide-y divide-steel-100 border-t border-steel-100">
              <Dato label="Entidad">{obligation.creditor}</Dato>
              <Dato label="Número">{obligation.reference ?? "—"}</Dato>
              <Dato label="Moneda">{obligation.currency === "USD" ? "Dólares (US$)" : "Soles (S/)"}</Dato>
              {esPrestamo ? (
                <>
                  <Dato label="Capital">{formatMoney(obligation.principal, obligation.currency)}</Dato>
                  <Dato label="TEA">{obligation.annualRate ? `${Number(obligation.annualRate)} %` : "—"}</Dato>
                  <Dato label="Desembolso">{formatDate(obligation.disbursedAt)}</Dato>
                  <Dato label="Saldo de capital">
                    {obligation.balance ? formatMoney(obligation.balance, obligation.currency) : "—"}
                  </Dato>
                </>
              ) : (
                <>
                  <Dato label="Día de pago">{obligation.billingDay ? `${obligation.billingDay} de cada mes` : "—"}</Dato>
                  <Dato label="Importe">
                    {obligation.variableAmount
                      ? "Cambia cada mes"
                      : formatMoney(obligation.fixedAmount, obligation.currency)}
                  </Dato>
                  <Dato label="Vigencia">
                    {obligation.firstDueDate || obligation.endsAt ? (
                      <>
                        {obligation.firstDueDate ? formatDate(obligation.firstDueDate) : "—"}
                        {" a "}
                        {obligation.endsAt ? formatDate(obligation.endsAt) : "sin fecha de fin"}
                        {obligation.endsAt && obligation.endsAt < hoy && (
                          <span className="ml-1 text-sm text-red-700">· vencida</span>
                        )}
                      </>
                    ) : "Sin plazo definido"}
                  </Dato>
                </>
              )}
            </dl>
          </Panel>

          <Panel title="Cómo va">
            <dl className="divide-y divide-steel-100 border-t border-steel-100">
              <Dato label="Pagado">{formatMoney(pagado.toFixed(2), obligation.currency)}</Dato>
              <Dato label="Falta pagar">{formatMoney(obligation.pendingAmount, obligation.currency)}</Dato>
              <Dato label="Total programado">{formatMoney(programado.toFixed(2), obligation.currency)}</Dato>
              <Dato label="Cuotas pendientes">{obligation.pendingCount}</Dato>
            </dl>
          </Panel>

          {obligation.notes && (
            <Panel title="Observaciones">
              <p className="px-4 py-3 text-sm text-steel-600">{obligation.notes}</p>
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
