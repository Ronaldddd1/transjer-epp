import { AlertTriangle, Coins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ObligationFormModal } from "@/components/obligations/obligation-form-modal";
import { Badge, ObligationStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, formatDate, formatMoney, OBLIGATION_STATUS_LABEL, OBLIGATION_TYPE_LABEL, todayLima,
  type SearchParams,
} from "@/lib/utils";
import { getObligationSummary, listObligations, readObligationFilters } from "@/server/obligation-queries";

export const metadata: Metadata = { title: "Préstamos y servicios" };

export default async function ObligationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("obligations.view");
  const sp = await searchParams;
  const f = readObligationFilters(sp);
  const canManage = can(user.role, "obligations.manage");

  const [rows, resumen] = await Promise.all([listObligations(f), getObligationSummary()]);
  const hoy = todayLima();

  const tarjetas = [
    { label: "Vencidas sin pagar", count: resumen.overdueCount, detail: formatMoney(resumen.overdueAmount), tone: resumen.overdueCount > 0 ? "alert" : "plain" },
    { label: "Vencen esta semana", count: resumen.weekCount, detail: formatMoney(resumen.weekAmount), tone: "brand" },
    { label: "Total de este mes", count: resumen.monthCount, detail: formatMoney(resumen.monthAmount), tone: "plain" },
  ] as const;

  return (
    <>
      <PageHeader
        title="Préstamos y servicios"
        description="Todo lo que se paga mes a mes: créditos del banco, celulares, luz, alquileres e impuestos."
        actions={canManage && <ObligationFormModal />}
      />

      {resumen.missingAmounts > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-brand/60 bg-brand-soft px-4 py-3 text-sm text-[#7A5A00]">
          <Coins className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{resumen.missingAmounts} cuota(s)</strong> de servicios variables no tienen importe todavía.
            Anótalo cuando llegue el recibo para que entren en el calendario de pagos.
          </span>
        </div>
      )}

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {tarjetas.map((t) => (
          <div
            key={t.label}
            className={cn(
              "rounded-lg border bg-white p-4",
              t.tone === "alert" ? "border-red-300" : t.tone === "brand" ? "border-brand/60" : "border-steel-200",
            )}
          >
            <dt className="text-sm text-steel-500">{t.label}</dt>
            <dd className="mt-1 font-display text-2xl font-bold text-ink">{t.count}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{t.detail}</dd>
          </div>
        ))}
      </dl>

      <FilterBar
        searchPlaceholder="Buscar nombre, entidad o número"
        filters={[
          { type: "select", name: "tipo", label: "Tipo", allLabel: "Todos", options: Object.entries(OBLIGATION_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "estado", label: "Estado", allLabel: "Todos", options: Object.entries(OBLIGATION_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "moneda", label: "Moneda", allLabel: "Todas", options: [{ value: "PEN", label: "Soles" }, { value: "USD", label: "Dólares" }] },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Obligación</Th>
            <Th>Tipo</Th>
            <Th>Próxima cuota</Th>
            <Th className="text-right">Importe</Th>
            <Th className="hidden 2xl:table-cell">Avance</Th>
            <Th className="hidden text-right 2xl:table-cell">Falta pagar</Th>
            <Th>Estado</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={8}
              title="No hay obligaciones registradas"
              hint={canManage ? "Registra el primer préstamo o servicio con el botón de arriba." : undefined}
            />
          )}
          {rows.map((o) => {
            const vencida = !!o.nextDueDate && o.nextDueDate < hoy;
            const sinCronograma = o.scheduleCount === 0;
            return (
              <Tr key={o.id} className={cn(o.status !== "ACTIVA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
                <Td>
                  <Link href={`/obligaciones/${o.id}`} className="font-semibold hover:underline">{o.name}</Link>
                  <p className="text-xs text-steel-500">
                    {o.creditor}
                    {o.reference && <span className="ml-1 text-steel-400">· {o.reference}</span>}
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-steel-600">
                  {OBLIGATION_TYPE_LABEL[o.type]}
                  {o.variableAmount && <p className="text-xs text-steel-500">monto variable</p>}
                </Td>
                <Td>
                  {sinCronograma ? (
                    <span className="text-sm text-brand-ink">Sin cronograma</span>
                  ) : o.nextDueDate ? (
                    <>
                      <span className={cn("whitespace-nowrap tabular", vencida && "font-semibold text-red-700")}>
                        {formatDate(o.nextDueDate)}
                      </span>
                      {vencida && <p className="text-xs text-red-700">ya venció</p>}
                    </>
                  ) : (
                    <span className="text-steel-500">—</span>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right font-display text-base font-bold tabular">
                  {o.nextAmount ? formatMoney(o.nextAmount, o.currency) : <span className="text-sm font-normal text-steel-500">por definir</span>}
                </Td>
                <Td className="hidden whitespace-nowrap text-steel-600 2xl:table-cell">
                  {sinCronograma ? "—" : `${o.paidCount} de ${o.scheduleCount}`}
                  {o.balance && <p className="text-xs text-steel-500">saldo {formatMoney(o.balance, o.currency)}</p>}
                </Td>
                <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 2xl:table-cell">
                  {Number(o.pendingAmount) > 0 ? formatMoney(o.pendingAmount, o.currency) : "—"}
                </Td>
                <Td>
                  <ObligationStatusBadge status={o.status} />
                  {o.overdueCount > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden /> {o.overdueCount} vencida(s)
                    </p>
                  )}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <ButtonLink href={`/obligaciones/${o.id}`} variant="ghost" size="sm">Ver</ButtonLink>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      {rows.some((r) => r.isDemo) && (
        <p className="mt-3 text-sm text-steel-500">
          <Badge tone="neutral">Prueba</Badge> Los registros de prueba se borran con <code>npm run db:clear-demo</code>.
        </p>
      )}
    </>
  );
}
