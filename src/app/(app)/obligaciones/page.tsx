import { Coins } from "lucide-react";
import type { Metadata } from "next";
import { ObligationFormModal } from "@/components/obligations/obligation-form-modal";
import { ObligationsByType } from "@/components/obligations/obligations-by-type";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, formatMoney, OBLIGATION_STATUS_LABEL, OBLIGATION_TYPE_LABEL, type SearchParams,
} from "@/lib/utils";
import { getObligationSummary, listObligations, readObligationFilters } from "@/server/obligation-queries";

export const metadata: Metadata = { title: "Préstamos y servicios" };

export default async function ObligationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("obligations.view");
  const sp = await searchParams;
  const f = readObligationFilters(sp);
  const canManage = can(user.role, "obligations.manage");

  const [rows, resumen] = await Promise.all([listObligations(f), getObligationSummary()]);

  const tarjetas = [
    { label: "Vencidas sin pagar", count: resumen.overdueCount, detail: formatMoney(resumen.overdueAmount), tone: resumen.overdueCount > 0 ? "alert" : "plain" },
    { label: "Vencen esta semana", count: resumen.weekCount, detail: formatMoney(resumen.weekAmount), tone: "brand" },
    // Se llama así y no "total del mes" para no chocar con la franja de arriba, que sí
    // suma lo arrastrado: dos cifras distintas con el mismo nombre no se entienden.
    { label: "Vence dentro del mes", count: resumen.monthCount, detail: formatMoney(resumen.monthAmount), tone: "plain" },
  ] as const;

  return (
    <>
      <PageHeader
        title="Préstamos y servicios"
        description="Todo lo que se paga mes a mes: créditos del banco, celulares, luz, alquileres e impuestos."
        actions={<><ExportTable tabla="obligaciones" />{canManage && <ObligationFormModal />}</>}
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

      <ObligationsByType rows={rows} canManage={canManage} />

      {rows.some((r) => r.isDemo) && (
        <p className="mt-3 text-sm text-steel-500">
          <Badge tone="neutral">Prueba</Badge> Los registros de prueba se borran con <code>npm run db:clear-demo</code>.
        </p>
      )}
    </>
  );
}
