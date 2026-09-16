import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, HardHat, Package } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MovementsChart } from "@/components/dashboard/movements-chart";
import { PeriodSelect } from "@/components/dashboard/period-select";
import { PERIODS, type PeriodKey } from "@/lib/periods";
import { MovementBadge, StockBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { StockMeter } from "@/components/ui/stock-meter";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, first, formatDate, formatDateTime, formatNumber, stockStatus, todayLima, type SearchParams } from "@/lib/utils";
import { getDashboard } from "@/server/queries";

export const metadata: Metadata = { title: "Dashboard" };

function periodRange(key: PeriodKey) {
  const today = todayLima();
  const shift = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  switch (key) {
    case "7d": return { from: shift(6), to: today };
    case "30d": return { from: shift(29), to: today };
    case "anio": return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default: return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

function Stat({ label, value, sub, icon: Icon, tone = "default", href }: {
  label: string; value: number; sub: string; icon: typeof Package; tone?: "default" | "alert"; href?: string;
}) {
  const body = (
    <div className={cn(
      "flex h-full flex-col justify-between gap-3 rounded-lg border bg-white p-4 transition-colors",
      tone === "alert" ? "border-brand bg-brand-soft/40" : "border-steel-200",
      href && "hover:border-ink",
    )}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-steel-600">{label}</p>
        <Icon className={cn("h-5 w-5", tone === "alert" ? "text-[#9A7000]" : "text-steel-400")} />
      </div>
      <div>
        <p className="font-display text-[34px] font-bold leading-none text-ink tabular">{formatNumber(value)}</p>
        <p className="mt-1.5 text-xs text-steel-500">{sub}</p>
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const periodParam = first(sp.period);
  const period: PeriodKey = periodParam && periodParam in PERIODS ? (periodParam as PeriodKey) : "mes";
  const d = await getDashboard(periodRange(period));
  const denied = first(sp.denied) === "1";

  return (
    <>
      <PageHeader
        title="Control de Inventario de EPP"
        description={`Hola, ${user.name.split(" ")[0]}. Este es el estado actual del almacén de EPP.`}
        actions={
          <>
            {can(user.role, "deliveries.create") && <ButtonLink href="/entregas?nuevo=1" variant="primary">Registrar entrega</ButtonLink>}
            {can(user.role, "movements.create") && <ButtonLink href="/movimientos?nuevo=ENTRADA" variant="outline">Registrar entrada</ButtonLink>}
          </>
        }
      />

      {denied && (
        <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          Tu rol no tiene acceso a esa sección.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total de productos" value={d.totals.products} sub="EPP activos registrados" icon={Package} href="/inventario" />
        <Stat label="Stock total" value={d.totals.stock} sub="Unidades disponibles" icon={Boxes} />
        <Stat
          label="Stock bajo" value={d.totals.low} icon={AlertTriangle}
          sub={d.totals.out > 0 ? `${d.totals.out} agotado(s)` : "Por reponer"}
          tone={d.totals.low > 0 ? "alert" : "default"} href="/inventario?status=STOCK_BAJO"
        />
        <Stat label="EPP entregados" value={d.delivered.units} sub={`${d.delivered.people} trabajador(es) · ${PERIODS[period].toLowerCase()}`} icon={HardHat} />
        <Stat label="Entradas del mes" value={d.monthly.entries} sub={`${d.monthly.entryCount} movimiento(s)`} icon={ArrowDownToLine} />
        <Stat label="Salidas del mes" value={d.monthly.exits} sub={`${d.monthly.exitCount} movimiento(s)`} icon={ArrowUpFromLine} />
      </div>
      <div className="mt-2 flex justify-end"><PeriodSelect value={period} /></div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Movimientos de los últimos 30 días">
          <div className="p-4">
            <MovementsChart data={d.chart} />
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-steel-100 pt-4 text-center">
              {[["Entradas del mes", d.monthly.entries], ["Salidas del mes", d.monthly.exits], ["Ajustes del mes", d.monthly.adjustCount]].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-steel-500">{k}</dt>
                  <dd className="font-display text-xl font-bold tabular">{formatNumber(Number(v))}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>

        <Panel title="Requieren reposición" action={<Link href="/inventario?status=STOCK_BAJO" className="text-sm font-medium text-steel-600 underline-offset-2 hover:text-ink hover:underline">Ver todos</Link>}>
          {d.lowStock.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-steel-500">Todo el inventario está sobre su stock mínimo.</p>
          ) : (
            <ul className="divide-y divide-steel-100">
              {d.lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}{p.size && <span className="text-steel-500"> · {p.size}</span>}</p>
                    <p className="text-xs text-steel-500">{p.code} · mínimo {p.minimumStock}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg font-bold tabular">{p.stock}</span>
                      <StockBadge status={stockStatus(p.stock, p.minimumStock)} />
                    </div>
                    <StockMeter stock={p.stock} minimum={p.minimumStock} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Últimos movimientos" action={<Link href="/movimientos" className="text-sm font-medium text-steel-600 hover:text-ink hover:underline">Ver historial</Link>}>
          {d.recentMovements.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-steel-500">Aún no hay movimientos registrados.</p>
          ) : (
            <ul className="divide-y divide-steel-100">
              {d.recentMovements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <MovementBadge type={m.type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.productName}</p>
                    <p className="truncate text-xs text-steel-500">{m.reason} · {m.userName}</p>
                  </div>
                  <div className="shrink-0 whitespace-nowrap text-right">
                    <p className="font-display font-bold tabular">{m.type === "SALIDA" ? "−" : m.quantity > 0 ? "+" : "−"}{Math.abs(m.quantity)}</p>
                    <p className="text-xs text-steel-500">{formatDateTime(m.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Últimas entregas" action={<Link href="/entregas" className="text-sm font-medium text-steel-600 hover:text-ink hover:underline">Ver entregas</Link>}>
          {d.recentDeliveries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-steel-500">Aún no hay entregas registradas.</p>
          ) : (
            <ul className="divide-y divide-steel-100">
              {d.recentDeliveries.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/trabajadores/${x.employeeId}`} className="truncate text-sm font-medium hover:underline">{x.employeeName}</Link>
                    <p className="truncate text-xs text-steel-500">{x.quantity} × {x.productName}{x.size ? ` (${x.size})` : ""} · {x.position}</p>
                  </div>
                  <p className="text-xs text-steel-500">{formatDate(x.deliveryDate)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
