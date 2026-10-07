import { AlertTriangle, CalendarDays, Landmark, Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { requirePageUser } from "@/lib/auth";
import { addDays, cn, first, formatDate, formatMoney, todayLima, type SearchParams } from "@/lib/utils";
import { listPaymentCalendar } from "@/server/obligation-queries";

export const metadata: Metadata = { title: "Calendario de pagos" };

const RANGOS = [
  { value: "7", label: "Próximos 7 días" },
  { value: "15", label: "Próximos 15 días" },
  { value: "30", label: "Próximos 30 días" },
  { value: "60", label: "Próximos 60 días" },
] as const;

/**
 * Todo lo que sale de caja en un solo lugar: facturas de proveedores y cuotas de préstamos
 * y servicios, ordenado por fecha. Es la vista que responde "cuánto necesito esta semana".
 */
export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("invoices.view");
  const sp = await searchParams;
  const dias = Number(first(sp.dias)) || 15;

  const hoy = todayLima();
  // Se arranca 30 días atrás para que lo vencido no se esconda: es lo primero que hay que ver.
  const desde = addDays(hoy, -30);
  const hasta = addDays(hoy, dias);

  const entradas = await listPaymentCalendar(desde, hasta);
  const vencidas = entradas.filter((e) => e.overdue);
  const futuras = entradas.filter((e) => !e.overdue);

  /**
   * Los importes se suman por moneda y se muestran todas las que aparezcan. Sumar solo los
   * soles cuando en la lista hay facturas en dólares daría un total que no cuadra con lo
   * que se ve, y es justo el número que la encargada usa para saber cuánto necesita en caja.
   */
  const totales = (lista: typeof entradas) => {
    const porMoneda = new Map<string, number>();
    for (const e of lista) {
      if (e.amount === null) continue;
      porMoneda.set(e.currency, (porMoneda.get(e.currency) ?? 0) + Number(e.amount));
    }
    const partes = [...porMoneda.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([moneda, v]) => formatMoney(v.toFixed(2), moneda));
    return partes.length ? partes.join(" · ") : formatMoney("0");
  };

  const sinImporte = entradas.filter((e) => e.amount === null).length;

  // Las entradas futuras se agrupan por día para leerlas como una agenda.
  const porDia = new Map<string, typeof entradas>();
  for (const e of futuras) {
    const key = e.dueDate ?? "";
    if (!porDia.has(key)) porDia.set(key, []);
    porDia.get(key)!.push(e);
  }

  const resumen = [
    { label: "Vencido sin pagar", count: vencidas.length, importe: totales(vencidas), tone: "alert" as const },
    { label: `Por pagar en ${dias} días`, count: futuras.length, importe: totales(futuras), tone: "brand" as const },
    { label: "Total en pantalla", count: entradas.length, importe: totales(entradas), tone: "plain" as const },
  ];

  return (
    <>
      <PageHeader
        title="Calendario de pagos"
        description="Facturas de proveedores y cuotas de préstamos y servicios, juntas y ordenadas por fecha."
        actions={<ExportTable tabla="calendario" />}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {RANGOS.map((r) => (
          <Link
            key={r.value}
            href={`/calendario?dias=${r.value}`}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm font-medium",
              String(dias) === r.value
                ? "border-ink bg-ink text-white"
                : "border-steel-200 bg-white text-steel-600 hover:border-steel-400",
            )}
          >
            {r.label}
          </Link>
        ))}
      </div>

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {resumen.map((r) => (
          <div
            key={r.label}
            className={cn(
              "rounded-lg border bg-white p-4",
              r.tone === "alert" ? "border-red-300" : r.tone === "brand" ? "border-brand/60" : "border-steel-200",
            )}
          >
            <dt className="text-sm text-steel-500">{r.label}</dt>
            <dd className="mt-1 font-display text-2xl font-bold text-ink">{r.importe}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{r.count} pago(s)</dd>
          </div>
        ))}
      </dl>

      {sinImporte > 0 && (
        <p className="mb-4 rounded-lg border border-brand/60 bg-brand-soft px-4 py-3 text-sm text-[#7A5A00]">
          {sinImporte} pago(s) todavía no tienen importe, así que no están sumados arriba.
          Son servicios de monto variable a los que les falta el recibo.
        </p>
      )}

      {vencidas.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-red-800">
            <AlertTriangle className="h-5 w-5" aria-hidden /> Vencido sin pagar
          </h2>
          <ul className="divide-y divide-red-100 rounded-lg border border-red-200 bg-red-50/50">
            {vencidas.map((e) => <Entrada key={`${e.kind}-${e.id}`} entry={e} />)}
          </ul>
        </section>
      )}

      {futuras.length === 0 && vencidas.length === 0 ? (
        <div className="rounded-lg border border-steel-200 bg-white px-4 py-10 text-center">
          <CalendarDays className="mx-auto h-8 w-8 text-steel-300" aria-hidden />
          <p className="mt-2 font-semibold text-ink">No hay pagos programados en este rango</p>
          <p className="mt-1 text-sm text-steel-500">Prueba con un rango más amplio.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {[...porDia.entries()].map(([fecha, lista]) => {
            const delDia = totales(lista);
            return (
              <section key={fecha}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-base font-bold text-ink">
                    {formatDate(fecha)}
                    {fecha === hoy && <span className="ml-2 text-sm font-semibold text-brand-ink">hoy</span>}
                  </h2>
                  <p className="text-sm text-steel-600">{delDia}</p>
                </div>
                <ul className="divide-y divide-steel-100 rounded-lg border border-steel-200 bg-white">
                  {lista.map((e) => <Entrada key={`${e.kind}-${e.id}`} entry={e} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function Entrada({ entry }: { entry: Awaited<ReturnType<typeof listPaymentCalendar>>[number] }) {
  const Icon = entry.kind === "FACTURA" ? Receipt : Landmark;
  return (
    <li>
      <Link href={entry.href} className="flex items-center gap-3 px-4 py-3 hover:bg-steel-50">
        <Icon className="h-4 w-4 shrink-0 text-steel-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{entry.title}</span>
          <span className="block truncate text-sm text-steel-500">{entry.subtitle}</span>
        </span>
        {entry.overdue && <Badge tone="red">Venció {formatDate(entry.dueDate)}</Badge>}
        <span className="whitespace-nowrap font-display text-base font-bold tabular text-ink">
          {entry.amount ? formatMoney(entry.amount, entry.currency) : <span className="text-sm font-normal text-brand-ink">sin importe</span>}
        </span>
      </Link>
    </li>
  );
}
