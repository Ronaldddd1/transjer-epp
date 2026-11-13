"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { registerReturns } from "@/actions/returns";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import {
  cn, formatMoney, RETURN_CONDITION_LABEL, todayLima, type ReturnConditionKey,
} from "@/lib/utils";

export type PendingItem = {
  productId: string;
  productCode?: string;
  productName: string;
  size: string | null;
  unit: string;
  unitPrice?: string | null;
  pendiente: number;
};

type Props = {
  employee: { id: string; name: string; terminatedAt?: string | null };
  items: PendingItem[];
  /** Abre el modal con solo ese EPP marcado, desde su fila. */
  productId?: string;
  variant?: ButtonVariant;
  compact?: boolean;
  label?: string;
};

const ESTADOS = ["REUTILIZABLE", "DESCARTADO", "NO_DEVUELTO"] as const;
const ESTADO_CORTO: Record<ReturnConditionKey, string> = {
  REUTILIZABLE: "Reutilizable",
  DESCARTADO: "Descartado (gastado)",
  NO_DEVUELTO: "No lo devolvió",
};

/**
 * Devolución de EPP: la tabla de todo lo que el trabajador tiene a su cargo.
 *
 * Cada fila es un EPP con lo que tiene, lo que devuelve y en qué estado. Al abrirse desde
 * el trabajador todo viene marcado (la devolución completa del cese); desde la fila de un
 * EPP, solo ese. Debajo se ve en vivo si la devolución es completa o parcial, y al
 * registrar se ofrece el acta para firmar.
 */
export function ReturnModal({ employee, items, productId, variant = "primary", compact = false, label = "Registrar devolución" }: Props) {
  const inicial = () => Object.fromEntries(items.map((i) => [
    i.productId,
    String(!productId || i.productId === productId ? i.pendiente : 0),
  ]));
  const [cantidades, setCantidades] = useState<Record<string, string>>(inicial);
  const [estados, setEstados] = useState<Record<string, ReturnConditionKey>>({});

  const filas = items.map((i) => {
    const n = Number(cantidades[i.productId] || 0);
    const estado = estados[i.productId] ?? "REUTILIZABLE";
    return { ...i, n, estado, pasado: n > i.pendiente, valor: Number(i.unitPrice ?? 0) * n };
  });
  const elegidas = filas.filter((f) => f.n > 0);
  const totalCargo = items.reduce((s, i) => s + i.pendiente, 0);
  const totalDevuelve = elegidas.reduce((s, f) => s + Math.min(f.n, f.pendiente), 0);
  const queda = totalCargo - totalDevuelve;
  const noDevuelto = elegidas.filter((f) => f.estado === "NO_DEVUELTO");
  const valorNoDevuelto = noDevuelto.reduce((s, f) => s + f.valor, 0);
  const completa = queda === 0 && noDevuelto.length === 0;

  return (
    <FormModal
      title={`Devolución de EPP de ${employee.name}`}
      description="Marca lo que entrega y en qué estado. La entrega original no se anula: queda en su historial."
      submitLabel="Registrar devolución"
      size="lg"
      action={(fd) => registerReturns(employee.id, fd)}
      onClosed={() => { setCantidades(inicial()); setEstados({}); }}
      trigger={(open) => (
        <Button variant={variant} size={compact ? "sm" : "md"} onClick={open} disabled={items.length === 0} title={items.length === 0 ? "No tiene EPP pendiente de devolución" : label}>
          <Undo2 className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>{compact ? "Devolver" : label}</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <div className="overflow-x-auto rounded-lg border border-steel-200">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm" data-testid="tabla-devolucion">
              <thead className="bg-steel-50">
                <tr className="text-[13px] font-semibold text-steel-600">
                  <th className="border-b border-steel-200 px-3 py-2">EPP</th>
                  <th className="border-b border-steel-200 px-3 py-2 text-right">A su cargo</th>
                  <th className="border-b border-steel-200 px-3 py-2 text-right">P. unit.</th>
                  <th className="w-24 border-b border-steel-200 px-3 py-2 text-right">Devuelve</th>
                  <th className="w-44 border-b border-steel-200 px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.productId} className={cn("border-b border-steel-100 last:border-b-0", f.n > 0 && !f.pasado && "bg-brand-soft")}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{f.productName}{f.size && <span className="text-steel-500"> · {f.size}</span>}</p>
                      {f.productCode && <p className="text-xs text-steel-500">{f.productCode}</p>}
                    </td>
                    <td className="px-3 py-2 text-right tabular">{f.pendiente}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular text-steel-600">
                      {f.unitPrice != null ? formatMoney(f.unitPrice) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        name={`cantidad_${f.productId}`}
                        value={cantidades[f.productId] ?? ""}
                        onChange={(e) => setCantidades((c) => ({ ...c, [f.productId]: e.target.value.replace(/[^\d]/g, "") }))}
                        placeholder="0"
                        aria-label={`Cantidad de ${f.productName} que devuelve`}
                        aria-invalid={f.pasado || undefined}
                        className={cn(
                          "h-9 w-full rounded-md border bg-white px-2 text-right tabular",
                          f.pasado ? "border-red-500 text-red-700" : "border-steel-300",
                        )}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        name={`estado_${f.productId}`}
                        value={f.estado}
                        onChange={(e) => setEstados((s) => ({ ...s, [f.productId]: e.target.value as ReturnConditionKey }))}
                        aria-label={`Estado de ${f.productName}`}
                        disabled={f.n === 0}
                        className="h-9 w-full rounded-md border border-steel-300 bg-white px-2 text-sm disabled:bg-steel-50 disabled:text-steel-400"
                      >
                        {ESTADOS.map((v) => <option key={v} value={v}>{ESTADO_CORTO[v]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className={cn(
              "rounded-md border px-3 py-2.5 text-sm",
              elegidas.length === 0 ? "border-steel-200 bg-steel-50 text-steel-600"
                : completa ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-brand/60 bg-brand-soft text-[#7A5A00]",
            )}
            data-testid="tipo-devolucion"
          >
            {elegidas.length === 0 ? (
              "Todavía no marcaste nada para devolver."
            ) : (
              <>
                <strong>{completa ? "Devolución completa" : "Devolución parcial"}</strong>
                {" · "}devuelve {totalDevuelve} de {totalCargo} unidad(es)
                {queda > 0 && <>; le quedan {queda} a su cargo</>}
                {noDevuelto.length > 0 && (
                  <>; no devolvió {noDevuelto.map((f) => `${f.n} ${f.productName}`).join(", ")}
                    {valorNoDevuelto > 0 && <> ({formatMoney(valorNoDevuelto)})</>}</>
                )}
                .
              </>
            )}
            {filas.some((f) => f.pasado) && <p className="mt-1 text-red-700">No puede devolver más de lo que tiene a su cargo.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de la devolución" name="returnDate" required error={errors.returnDate}>
              <DateInput name="returnDate" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.returnDate} />
            </Field>
            <Field label="Motivo" name="reason" required error={errors.reason}>
              <Input
                name="reason"
                maxLength={120}
                defaultValue={employee.terminatedAt ? "Cese del trabajador" : "Devolución de EPP"}
                invalid={!!errors.reason}
              />
            </Field>
          </div>

          <Field
            label="Observaciones"
            name="notes"
            required={noDevuelto.length > 0}
            error={errors.notes}
            hint={noDevuelto.length > 0
              ? "Explica qué pasó con lo que no devolvió: se perdió, no se presentó…"
              : `Reutilizable vuelve al stock; ${RETURN_CONDITION_LABEL.DESCARTADO.toLowerCase()} y no devuelto se registran sin tocar el inventario.`}
          >
            <Textarea name="notes" maxLength={1000} rows={2} invalid={!!errors.notes} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
