import { AlertTriangle, ChevronLeft, ChevronRight, Landmark } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { requirePageUser } from "@/lib/auth";
import {
  addDays, addMonths, cn, first, formatDate, formatMoney, monthEnd, monthLabel, monthStart,
  todayLima, WEEKDAYS, weekdayOf, type SearchParams,
} from "@/lib/utils";
import { listPaymentCalendar, type CalendarEntry } from "@/server/obligation-queries";

export const metadata: Metadata = { title: "Calendario de pagos" };

/**
 * Las cuotas de préstamos y servicios, mes a mes, con la forma de un calendario de pared.
 *
 * Antes era una lista por días. Decía lo mismo, pero para saber cómo venía la semana había
 * que leerla entera; en la cuadrícula se ve de un vistazo dónde se juntan los pagos y qué
 * días están libres, que es como la encargada mira el mes cuando reparte la plata.
 */

/** Un importe por moneda. Nunca se suman soles con dólares. */
function totales(lista: CalendarEntry[]) {
  const suma = new Map<string, number>();
  for (const e of lista) {
    if (e.amount === null) continue;
    suma.set(e.currency, (suma.get(e.currency) ?? 0) + Number(e.amount));
  }
  return [...suma.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([moneda, v]) => formatMoney(v.toFixed(2), moneda));
}

const juntar = (importes: string[]) => (importes.length ? importes.join(" + ") : "—");

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("invoices.view");
  const sp = await searchParams;

  const hoy = todayLima();
  const pedido = first(sp.mes) ?? "";
  const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : hoy.slice(0, 7);
  const inicio = monthStart(mes);
  const fin = monthEnd(mes);

  // Dos consultas: el mes que se está mirando, y lo que quedó debiendo de antes. Sin la
  // segunda, al pasar al mes siguiente una factura vencida desaparecía de la vista.
  const [delMes, atrasado] = await Promise.all([
    listPaymentCalendar(inicio, fin),
    listPaymentCalendar(addDays(inicio, -730), addDays(inicio, -1)),
  ]);
  const vencidoAntes = atrasado.filter((e) => e.overdue);

  // Las entradas de cada día, para pintarlas dentro de su casilla.
  const porDia = new Map<string, CalendarEntry[]>();
  for (const e of delMes) {
    if (!e.dueDate) continue;
    const lista = porDia.get(e.dueDate);
    if (lista) lista.push(e);
    else porDia.set(e.dueDate, [e]);
  }

  // La cuadrícula: casillas vacías hasta que empieza el mes, un día en cada una después, y
  // las que sobran al final para cerrar la última semana.
  const diasDelMes = Number(fin.slice(8, 10));
  const casillas: (string | null)[] = [
    ...Array(weekdayOf(inicio)).fill(null),
    ...Array.from({ length: diasDelMes }, (_, i) => addDays(inicio, i)),
  ];
  while (casillas.length % 7 !== 0) casillas.push(null);
  const semanas = Array.from({ length: casillas.length / 7 }, (_, i) => casillas.slice(i * 7, i * 7 + 7));

  const sinImporte = delMes.filter((e) => e.amount === null).length;
  const esMesActual = mes === hoy.slice(0, 7);

  return (
    <>
      <PageHeader
        title="Calendario de pagos"
        description="Las cuotas de préstamos y servicios, en el mes en que vencen. Las facturas de proveedores están en su propia pantalla."
        actions={<ExportTable tabla="calendario" />}
      />

      {/* --- Cabecera del mes: mover de mes y el total de todo lo que vence en él --- */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-ink bg-ink px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <Link
            href={`/calendario?mes=${addMonths(mes, -1)}`}
            aria-label="Mes anterior"
            className="rounded-md border border-steel-600 p-1.5 text-steel-300 hover:border-brand hover:text-brand"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <h2 className="font-display text-xl font-bold">{monthLabel(mes)}</h2>
          <Link
            href={`/calendario?mes=${addMonths(mes, 1)}`}
            aria-label="Mes siguiente"
            className="rounded-md border border-steel-600 p-1.5 text-steel-300 hover:border-brand hover:text-brand"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
          {!esMesActual && (
            <Link href="/calendario" className="ml-1 text-sm text-steel-300 underline hover:text-brand">
              Volver a este mes
            </Link>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm text-steel-300">Vence en el mes · {delMes.length} pago(s)</p>
          <p className="font-display text-2xl font-bold text-brand">{juntar(totales(delMes))}</p>
        </div>
      </div>

      {sinImporte > 0 && (
        <p className="mb-4 rounded-lg border border-brand/60 bg-brand-soft px-4 py-3 text-sm text-[#7A5A00]">
          {sinImporte} pago(s) del mes todavía no tienen importe, así que no están sumados.
          Son servicios de monto variable a los que les falta el recibo.
        </p>
      )}

      {/* Lo vencido de meses anteriores va plegado: tiene que verse que existe y cuánto es,
          pero desplegado empujaba el calendario fuera de la pantalla, que es justo lo que
          se vino a mirar. */}
      {vencidoAntes.length > 0 && (
        <details className="group mb-4 rounded-lg border border-red-200 bg-red-50/50">
          <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 marker:content-['']">
            <span className="flex items-center gap-2 font-display text-base font-bold text-red-800">
              <AlertTriangle className="h-4 w-4" aria-hidden /> Viene vencido de antes
            </span>
            <span className="text-sm text-red-800">
              {vencidoAntes.length} pago(s) · <strong>{juntar(totales(vencidoAntes))}</strong>
              <span className="ml-2 font-medium underline group-open:hidden">ver cuáles</span>
              <span className="ml-2 hidden font-medium underline group-open:inline">ocultar</span>
            </span>
          </summary>
          <ul className="divide-y divide-red-100 border-t border-red-200">
            {vencidoAntes.map((e) => <Entrada key={`${e.kind}-${e.id}`} entry={e} />)}
          </ul>
        </details>
      )}

      {/* --- La cuadrícula del mes --- */}
      <div className="overflow-x-auto rounded-lg border border-steel-200 bg-white">
        <table className="w-full min-w-[56rem] table-fixed border-collapse">
          <thead>
            <tr>
              {WEEKDAYS.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="border-b border-steel-200 bg-ink px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-white"
                >
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {semanas.map((semana, i) => (
              <tr key={i}>
                {semana.map((fecha, j) => (
                  <Casilla key={fecha ?? `vacia-${i}-${j}`} fecha={fecha} entradas={fecha ? porDia.get(fecha) ?? [] : []} hoy={hoy} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-steel-500">
        En rojo, lo que ya venció y sigue sin pagarse. Haz clic en cualquier pago para abrirlo.
      </p>
    </>
  );
}

/** Un día del mes: su número, lo que vence ese día y cuánto suma. */
function Casilla({ fecha, entradas, hoy }: { fecha: string | null; entradas: CalendarEntry[]; hoy: string }) {
  if (!fecha) {
    // Los días del mes anterior o del siguiente se dejan en gris, como en un calendario
    // impreso: marcan dónde empieza y termina el mes sin pedir que se lean.
    return <td className="h-28 border border-steel-100 bg-steel-100/70" />;
  }

  const esHoy = fecha === hoy;
  const vencido = entradas.some((e) => e.overdue);
  const dia = Number(fecha.slice(8, 10));

  return (
    <td className={cn("h-28 border border-steel-200 align-top", esHoy && "bg-brand-soft", vencido && !esHoy && "bg-red-50/60")}>
      <div className="flex h-full flex-col gap-1 p-1.5">
        <div className="flex items-baseline justify-between gap-1">
          <span className={cn(
            "font-display text-sm font-bold tabular",
            esHoy ? "rounded bg-ink px-1.5 text-white" : vencido ? "text-red-700" : "text-ink",
          )}>
            {dia}
          </span>
          {entradas.length > 0 && (
            <span className="truncate text-[11px] font-semibold tabular text-steel-600">
              {juntar(totales(entradas))}
            </span>
          )}
        </div>
        {/* Sin recortar: si un día junta seis pagos, la fila crece y se ven los seis.
            Esconder el sexto detrás de un "+1" es justo el que haría falta ver. */}
        <div className="flex flex-col gap-0.5">
          {entradas.map((e) => <Chip key={`${e.kind}-${e.id}`} entry={e} />)}
        </div>
      </div>
    </td>
  );
}

/** Un pago dentro de su día: lo justo para reconocerlo sin abrirlo. */
function Chip({ entry }: { entry: CalendarEntry }) {
  const Icon = Landmark;
  return (
    <Link
      href={entry.href}
      title={`${entry.title} · ${entry.subtitle} · ${entry.amount ? formatMoney(entry.amount, entry.currency) : "sin importe"}`}
      className={cn(
        "flex items-center gap-1 rounded px-1 py-0.5 text-[11px] leading-tight hover:underline",
        entry.overdue ? "bg-red-100 text-red-800" : "bg-steel-100 text-ink",
      )}
    >
      <Icon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{entry.title}</span>
      <span className="shrink-0 tabular">
        {entry.amount ? formatMoney(entry.amount, entry.currency) : "—"}
      </span>
    </Link>
  );
}

/** Una línea de la lista de lo vencido de antes. */
function Entrada({ entry }: { entry: CalendarEntry }) {
  const Icon = Landmark;
  return (
    <li>
      <Link href={entry.href} className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50">
        <Icon className="h-4 w-4 shrink-0 text-steel-400" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-ink">{entry.title}</span>
          <span className="block truncate text-sm text-steel-500">{entry.subtitle}</span>
        </span>
        <Badge tone="red">Venció {formatDate(entry.dueDate)}</Badge>
        <span className="whitespace-nowrap font-display text-base font-bold tabular text-ink">
          {entry.amount ? formatMoney(entry.amount, entry.currency) : <span className="text-sm font-normal text-brand-ink">sin importe</span>}
        </span>
      </Link>
    </li>
  );
}
