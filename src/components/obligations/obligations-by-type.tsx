import { AlertTriangle } from "lucide-react";
import { Fragment } from "react";
import Link from "next/link";
import { ObligationStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  cn, conceptoDeObligacion, formatDate, formatMoney, OBLIGATION_TYPE_HINT,
  OBLIGATION_TYPE_PLURAL, todayLima, type ObligationTypeKey,
} from "@/lib/utils";
import type { ObligationRow } from "@/server/obligation-queries";

/**
 * El listado, partido en una tabla por tipo de obligación.
 *
 * Antes era una sola tabla con una columna "Tipo", y para saber qué se debe de préstamos
 * había que leerla entera. Un préstamo y un plan de celular tampoco se miran igual: del
 * préstamo interesa el capital, la tasa y cuánto falta amortizar; del servicio, qué día
 * vence y cuánto llega este mes. Cada tabla muestra lo suyo.
 */

const ORDEN: ObligationTypeKey[] = [
  "PRESTAMO", "ALQUILER", "COCHERA", "SEGURO", "LINEA", "SERVICIO", "IMPUESTO", "OTRO",
];

/**
 * Un importe sumado por moneda. Nunca se juntan soles con dólares: sumarlos daría un número
 * que no existe, y la empresa tiene obligaciones en las dos.
 */
function porMoneda(filas: ObligationRow[], campo: (o: ObligationRow) => string | null) {
  const suma = new Map<string, number>();
  for (const o of filas) {
    const n = Number(campo(o) ?? 0);
    if (n > 0) suma.set(o.currency, (suma.get(o.currency) ?? 0) + n);
  }
  return [...suma.entries()].map(([currency, importe]) => formatMoney(importe.toFixed(2), currency));
}

const delMes = (filas: ObligationRow[]) => porMoneda(filas, (o) => o.monthAmount);
/** Todo lo que cuesta el mes, esté pagado o no: el compromiso, no el saldo. */
const totalDelMesCompleto = (filas: ObligationRow[]) => porMoneda(filas, (o) => o.monthTotal);
const pagadoDelMes = (filas: ObligationRow[]) => porMoneda(filas, (o) => o.monthPaid);
const arrastrado = (filas: ObligationRow[]) => porMoneda(filas, (o) => o.monthOverdue);
const pendiente = (filas: ObligationRow[]) => porMoneda(filas, (o) => o.pendingAmount);
const juntar = (importes: string[]) => (importes.length ? importes.join(" + ") : "—");

/**
 * El fondo de cada fila, según lo que haya que mirar primero.
 *
 * Rojo lo que ya venció y sigue sin pagarse; amarillo claro lo que todavía no vence pero
 * hay que pagar antes de que acabe el mes. De un vistazo se separa lo urgente de lo que
 * está en camino, sin tener que leer fecha por fecha.
 */
function fondoDeFila(o: ObligationRow, hoy: string) {
  if (o.status !== "ACTIVA") return "bg-steel-50/60 [&>td]:text-steel-400 hover:bg-steel-100/60";
  // El color se va solo cuando se paga: al quedar la cuota pagada ya no hay vencidas y el
  // próximo vencimiento pasa al mes siguiente, así que la fila vuelve a blanco sola.
  if (o.overdueCount > 0) return "bg-red-100/70 hover:bg-red-100";
  const venceEsteMes = !!o.nextDueDate && o.nextDueDate.slice(0, 7) === hoy.slice(0, 7);
  // Las de monto variable sin recibo también se resaltan: hay que conseguir el importe
  // antes de que se acabe el mes, y es justo lo que se suele olvidar.
  return venceEsteMes || o.monthMissing > 0 ? "bg-brand-soft hover:bg-[#FFEBA8]" : "";
}

/**
 * Las obligaciones de un tipo, agrupadas por concepto.
 *
 * Por concepto y no por entidad: en la práctica la entidad trae la placa o el número de
 * línea, así que agrupar por ella deja cada cochera y cada seguro en su propio bloque. Lo
 * que hace falta es lo contrario — cuánto se va en cocheras, en seguros, en líneas— sin
 * importar de qué unidad sea cada una.
 */
function porConcepto(filas: ObligationRow[]) {
  const grupos = new Map<string, ObligationRow[]>();
  for (const o of filas) {
    const clave = o.category?.trim() || conceptoDeObligacion(o.name);
    const lista = grupos.get(clave);
    if (lista) lista.push(o);
    else grupos.set(clave, [o]);
  }
  return [...grupos.entries()]
    .map(([concepto, suyas]) => ({
      concepto,
      filas: suyas,
      mes: suyas.reduce((s, o) => s + Number(o.monthAmount ?? 0), 0),
      vencidas: suyas.reduce((s, o) => s + o.overdueCount, 0),
      sinImporte: suyas.reduce((s, o) => s + o.monthMissing, 0),
    }))
    .sort((a, b) => b.mes - a.mes || a.concepto.localeCompare(b.concepto, "es"));
}

/** Fila que encabeza cada concepto dentro de la tabla de un tipo. */
function FilaConcepto({ grupo, columnas }: { grupo: ReturnType<typeof porConcepto>[number]; columnas: number }) {
  return (
    <tr className="border-t border-steel-200 bg-steel-50">
      <td colSpan={columnas} className="px-4 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="font-semibold text-ink">{grupo.concepto}</span>
          <span className="text-sm text-steel-600">
            {grupo.filas.length} obligación(es) · este mes{" "}
            <strong className="font-display text-ink">{juntar(delMes(grupo.filas))}</strong>
            {grupo.sinImporte > 0 && <span className="text-brand-ink"> · {grupo.sinImporte} sin importe</span>}
            {grupo.vencidas > 0 && <span className="font-semibold text-red-700"> · {grupo.vencidas} vencida(s)</span>}
          </span>
        </div>
      </td>
    </tr>
  );
}

function Vencimiento({ fecha, sinCronograma, hoy }: { fecha: string | null; sinCronograma: boolean; hoy: string }) {
  if (sinCronograma) return <span className="text-sm text-brand-ink">Sin cronograma</span>;
  if (!fecha) return <span className="text-steel-500">—</span>;
  const vencida = fecha < hoy;
  return (
    <>
      <span className={cn("whitespace-nowrap tabular", vencida && "font-semibold text-red-700")}>{formatDate(fecha)}</span>
      {vencida && <p className="text-xs text-red-700">ya venció</p>}
    </>
  );
}

function Nombre({ o }: { o: ObligationRow }) {
  return (
    <Td>
      <Link href={`/obligaciones/${o.id}`} className="font-semibold hover:underline">{o.name}</Link>
      <p className="text-xs text-steel-500">
        {o.creditor}
        {o.reference && <span className="ml-1 text-steel-400">· {o.reference}</span>}
      </p>
    </Td>
  );
}

function Estado({ o }: { o: ObligationRow }) {
  return (
    <Td>
      <ObligationStatusBadge status={o.status} />
      {o.overdueCount > 0 && (
        <p className="mt-1 flex items-center gap-1 text-xs text-red-700">
          <AlertTriangle className="h-3 w-3" aria-hidden /> {o.overdueCount} vencida(s)
        </p>
      )}
    </Td>
  );
}

const Acciones = ({ id }: { id: string }) => (
  <Td>
    <div className="flex items-center justify-end gap-1">
      <ButtonLink href={`/obligaciones/${id}`} variant="ghost" size="sm">Ver</ButtonLink>
    </div>
  </Td>
);

/** Tabla de préstamos: capital, tasa y cuánto se ha amortizado. */
function TablaPrestamos({ grupos, hoy, segmentar }: {
  grupos: ReturnType<typeof porConcepto>; hoy: string; segmentar: boolean;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Préstamo</Th>
          <Th className="text-right">Capital</Th>
          <Th className="hidden text-right lg:table-cell">TEA</Th>
          <Th>Próxima cuota</Th>
          <Th className="text-right">Importe</Th>
          <Th className="hidden text-center lg:table-cell">Cuotas</Th>
          <Th className="hidden text-right lg:table-cell">Saldo de capital</Th>
          <Th>Estado</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {grupos.map((g) => (
          <Fragment key={g.concepto}>
            {segmentar && <FilaConcepto grupo={g} columnas={9} />}
            {g.filas.map((o) => (
          <Tr key={o.id} tone={fondoDeFila(o, hoy)}>
            <Nombre o={o} />
            <Td className="whitespace-nowrap text-right tabular text-steel-600">
              {o.principal ? formatMoney(o.principal, o.currency) : "—"}
              {o.disbursedAt && <p className="text-xs text-steel-500">desde {formatDate(o.disbursedAt)}</p>}
            </Td>
            <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 lg:table-cell">
              {o.annualRate ? `${Number(o.annualRate)} %` : "—"}
            </Td>
            <Td><Vencimiento fecha={o.nextDueDate} sinCronograma={o.scheduleCount === 0} hoy={hoy} /></Td>
            <Td className="whitespace-nowrap text-right font-display text-base font-bold tabular">
              {o.nextAmount ? formatMoney(o.nextAmount, o.currency) : <span className="text-sm font-normal text-steel-500">—</span>}
            </Td>
            <Td className="hidden whitespace-nowrap text-center tabular text-steel-600 lg:table-cell">
              {o.scheduleCount === 0 ? "—" : `${o.paidCount} de ${o.scheduleCount}`}
            </Td>
            <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 lg:table-cell">
              {o.balance ? formatMoney(o.balance, o.currency) : "—"}
            </Td>
            <Estado o={o} />
            <Acciones id={o.id} />
          </Tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </TableShell>
  );
}

/** Tabla de servicios, alquileres e impuestos: cuándo vence y cuánto llega. */
function TablaPeriodicas({ grupos, hoy, segmentar }: {
  grupos: ReturnType<typeof porConcepto>; hoy: string; segmentar: boolean;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Obligación</Th>
          <Th className="hidden text-center lg:table-cell">Vence cada mes</Th>
          <Th>Próxima cuota</Th>
          <Th className="text-right">Importe</Th>
          <Th className="hidden text-right lg:table-cell">Falta pagar</Th>
          <Th className="hidden lg:table-cell">Vigencia</Th>
          <Th>Estado</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {grupos.map((g) => (
          <Fragment key={g.concepto}>
            {segmentar && <FilaConcepto grupo={g} columnas={8} />}
            {g.filas.map((o) => (
          <Tr key={o.id} tone={fondoDeFila(o, hoy)}>
            <Nombre o={o} />
            <Td className="hidden whitespace-nowrap text-center tabular text-steel-600 lg:table-cell">
              {o.billingDay ? `día ${o.billingDay}` : "—"}
            </Td>
            <Td><Vencimiento fecha={o.nextDueDate} sinCronograma={o.scheduleCount === 0} hoy={hoy} /></Td>
            <Td className="whitespace-nowrap text-right font-display text-base font-bold tabular">
              {o.nextAmount
                ? formatMoney(o.nextAmount, o.currency)
                : <span className="text-sm font-normal text-brand-ink">falta el recibo</span>}
              {o.variableAmount && <p className="text-xs font-normal text-steel-500">monto variable</p>}
            </Td>
            <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 lg:table-cell">
              {Number(o.pendingAmount) > 0 ? formatMoney(o.pendingAmount, o.currency) : "—"}
            </Td>
            <Td className="hidden whitespace-nowrap text-sm text-steel-600 lg:table-cell">
              {o.endsAt
                ? <span className={cn(o.endsAt < hoy && "text-red-700")}>hasta {formatDate(o.endsAt)}</span>
                : <span className="text-steel-400">sin plazo</span>}
            </Td>
            <Estado o={o} />
            <Acciones id={o.id} />
          </Tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </TableShell>
  );
}

export function ObligationsByType({ rows, canManage }: { rows: ObligationRow[]; canManage: boolean }) {
  const hoy = todayLima();

  if (rows.length === 0) {
    return (
      <TableShell>
        <tbody>
          <EmptyRow
            colSpan={8}
            title="No hay obligaciones con esos filtros"
            hint={canManage ? "Registra el primer préstamo o servicio con el botón de arriba." : undefined}
          />
        </tbody>
      </TableShell>
    );
  }

  const tipos = ORDEN
    .map((type) => ({ type, filas: rows.filter((o) => o.type === type) }))
    .filter((g) => g.filas.length > 0);

  const totalDelMes = delMes(rows);
  const compromisoDelMes = totalDelMesCompleto(rows);
  const yaPagado = pagadoDelMes(rows);
  const totalArrastrado = arrastrado(rows);
  const totalSinImporte = rows.reduce((s, o) => s + o.monthMissing, 0);

  return (
    <div className="grid gap-6">
      {/* Lo primero que hay que saber a fin de mes: cuánta plata hay que tener lista. */}
      <div className="rounded-lg border border-ink bg-ink px-4 py-3 text-white">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-sm text-steel-300">Falta pagar este mes</span>
          <span className="font-display text-2xl font-bold text-brand">{juntar(totalDelMes)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-ink-700 pt-1.5">
          <span className="text-sm text-steel-300">Total del mes, pagado o no</span>
          <span className="font-display text-lg font-semibold text-white">
            {juntar(compromisoDelMes)}
            {yaPagado.length > 0 && <span className="ml-2 text-sm font-normal text-steel-400">· ya pagado {juntar(yaPagado)}</span>}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-steel-400">
          {totalArrastrado.length > 0
            ? `Incluye ${totalArrastrado.join(" + ")} que viene de meses anteriores y sigue sin pagarse.`
            : "Nada arrastrado de meses anteriores."}
          {totalSinImporte > 0 && ` ${totalSinImporte} cuota(s) de monto variable todavía no suman: falta su recibo.`}
        </p>
      </div>

      {/* Qué significan los colores de las filas, para no tener que adivinarlo. */}
      <div className="-mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-steel-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-100/70" aria-hidden /> Ya venció
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-brand bg-brand-soft" aria-hidden /> Por pagar este mes
        </span>
      </div>

      {tipos.map(({ type, filas }) => {
        const vencidas = filas.reduce((s, o) => s + o.overdueCount, 0);
        const grupos = porConcepto(filas);
        // Con un solo concepto la fila de grupo repetiría lo que ya dice la cabecera.
        const segmentar = grupos.length > 1;
        return (
          <Panel
            key={type}
            title={OBLIGATION_TYPE_PLURAL[type]}
            action={
              /* Dos números, no uno: el total del mes es lo que cuesta ese tipo de
                 obligación —y no cambia porque se vaya pagando— y al lado lo que todavía
                 falta. Antes solo estaba el segundo, y a fin de mes, con todo pagado,
                 decía cero: no había dónde ver cuánto se gastó. */
              <span className="text-sm text-steel-500">
                {filas.length} · total del mes{" "}
                <strong className="font-display text-base text-ink">{juntar(totalDelMesCompleto(filas))}</strong>
                <span className="text-steel-400"> · falta pagar {juntar(delMes(filas))}</span>
                {vencidas > 0 && <span className="ml-2 font-semibold text-red-700">{vencidas} cuota(s) vencida(s)</span>}
              </span>
            }
          >
            {type === "PRESTAMO"
              ? <TablaPrestamos grupos={grupos} hoy={hoy} segmentar={segmentar} />
              : <TablaPeriodicas grupos={grupos} hoy={hoy} segmentar={segmentar} />}
            <p className="border-t border-steel-100 px-4 py-2 text-xs text-steel-500">
              {OBLIGATION_TYPE_HINT[type]}
            </p>
          </Panel>
        );
      })}
    </div>
  );
}
