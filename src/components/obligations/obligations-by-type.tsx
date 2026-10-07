import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { ObligationStatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  cn, formatDate, formatMoney, OBLIGATION_TYPE_HINT, OBLIGATION_TYPE_PLURAL, todayLima,
  type ObligationTypeKey,
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

const ORDEN: ObligationTypeKey[] = ["PRESTAMO", "ALQUILER", "SERVICIO", "IMPUESTO", "OTRO"];

/** Lo pendiente de un grupo, separado por moneda: no se suman soles con dólares. */
function pendientePorMoneda(filas: ObligationRow[]) {
  const porMoneda = new Map<string, number>();
  for (const o of filas) {
    const n = Number(o.pendingAmount ?? 0);
    if (n > 0) porMoneda.set(o.currency, (porMoneda.get(o.currency) ?? 0) + n);
  }
  return [...porMoneda.entries()].map(([currency, importe]) => formatMoney(importe.toFixed(2), currency));
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
function TablaPrestamos({ filas, hoy }: { filas: ObligationRow[]; hoy: string }) {
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
        {filas.map((o) => (
          <Tr key={o.id} className={cn(o.status !== "ACTIVA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
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
      </tbody>
    </TableShell>
  );
}

/** Tabla de servicios, alquileres e impuestos: cuándo vence y cuánto llega. */
function TablaPeriodicas({ filas, hoy }: { filas: ObligationRow[]; hoy: string }) {
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
        {filas.map((o) => (
          <Tr key={o.id} className={cn(o.status !== "ACTIVA" && "bg-steel-50/60 [&>td]:text-steel-400")}>
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

  const grupos = ORDEN
    .map((type) => ({ type, filas: rows.filter((o) => o.type === type) }))
    .filter((g) => g.filas.length > 0);

  return (
    <div className="grid gap-6">
      {grupos.map(({ type, filas }) => {
        const vencidas = filas.reduce((s, o) => s + o.overdueCount, 0);
        const pendiente = pendientePorMoneda(filas);
        return (
          <Panel
            key={type}
            title={OBLIGATION_TYPE_PLURAL[type]}
            action={
              <span className="text-sm text-steel-500">
                {filas.length} · falta pagar {pendiente.length ? pendiente.join(" + ") : "nada"}
                {vencidas > 0 && <span className="ml-2 font-semibold text-red-700">{vencidas} cuota(s) vencida(s)</span>}
              </span>
            }
          >
            {type === "PRESTAMO"
              ? <TablaPrestamos filas={filas} hoy={hoy} />
              : <TablaPeriodicas filas={filas} hoy={hoy} />}
            <p className="border-t border-steel-100 px-4 py-2 text-xs text-steel-500">
              {OBLIGATION_TYPE_HINT[type]}
            </p>
          </Panel>
        );
      })}
    </div>
  );
}
