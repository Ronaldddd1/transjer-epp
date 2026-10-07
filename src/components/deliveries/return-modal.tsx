"use client";

import { Undo2 } from "lucide-react";
import { useState } from "react";
import { registerReturn } from "@/actions/returns";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import {
  RETURN_CONDITION_HINT, RETURN_CONDITION_LABEL, todayLima, type ReturnConditionKey,
} from "@/lib/utils";

export type PendingItem = {
  productId: string;
  productName: string;
  size: string | null;
  unit: string;
  pendiente: number;
};

type Props = {
  employee: { id: string; name: string; terminatedAt?: string | null };
  items: PendingItem[];
  /** Abre el modal con un EPP ya elegido, desde su fila de la tabla. */
  productId?: string;
  variant?: ButtonVariant;
  compact?: boolean;
  label?: string;
};

/**
 * Registro de la devolución de un EPP.
 *
 * Solo deja elegir entre lo que el trabajador tiene a su cargo, y la cantidad no puede
 * pasar de lo pendiente: no hay forma de devolver algo que nunca se entregó. Lo que decide
 * si el EPP vuelve al stock es la condición, no quien registra.
 */
export function ReturnModal({ employee, items, productId, variant = "primary", compact = false, label = "Registrar devolución" }: Props) {
  const inicial = productId && items.some((i) => i.productId === productId) ? productId : items[0]?.productId ?? "";
  const [elegido, setElegido] = useState(inicial);
  const [condicion, setCondicion] = useState<ReturnConditionKey>("REUTILIZABLE");
  const item = items.find((i) => i.productId === elegido);
  const unoSolo = items.length === 1;

  return (
    <FormModal
      title={`Devolución de EPP de ${employee.name}`}
      description="Lo que el trabajador entrega de vuelta. La entrega original no se anula: queda en su historial."
      submitLabel="Registrar devolución"
      size="sm"
      action={(fd) => registerReturn(employee.id, fd)}
      onClosed={() => { setElegido(inicial); setCondicion("REUTILIZABLE"); }}
      trigger={(open) => (
        <Button variant={variant} size={compact ? "sm" : "md"} onClick={open} disabled={items.length === 0} title={items.length === 0 ? "No tiene EPP pendiente de devolución" : label}>
          <Undo2 className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>{compact ? "Devolver" : label}</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <Field label="EPP devuelto" name="productId" required error={errors.productId}>
            {unoSolo ? (
              <>
                <input type="hidden" name="productId" value={items[0].productId} />
                <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm">
                  {items[0].productName}{items[0].size && <span className="text-steel-500"> · {items[0].size}</span>}
                  <span className="text-steel-500"> — {items[0].pendiente} pendiente(s)</span>
                </p>
              </>
            ) : (
              <Select name="productId" value={elegido} onChange={(e) => setElegido(e.target.value)} invalid={!!errors.productId}>
                {items.map((i) => (
                  <option key={i.productId} value={i.productId}>
                    {i.productName}{i.size ? ` (${i.size})` : ""} — {i.pendiente} pendiente(s)
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Cantidad"
              name="quantity"
              required
              error={errors.quantity}
              hint={item ? `Tiene ${item.pendiente} ${item.unit.toLowerCase()}(s) a su cargo.` : undefined}
            >
              <Input
                key={elegido}
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={item?.pendiente ?? 1}
                defaultValue={item?.pendiente ?? 1}
                invalid={!!errors.quantity}
                autoFocus
              />
            </Field>

            <Field label="Fecha de la devolución" name="returnDate" required error={errors.returnDate}>
              <DateInput name="returnDate" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.returnDate} />
            </Field>
          </div>

          <Field label="¿En qué estado volvió?" name="condition" required error={errors.condition} hint={RETURN_CONDITION_HINT[condicion]}>
            <Select name="condition" value={condicion} onChange={(e) => setCondicion(e.target.value as ReturnConditionKey)}>
              {(["REUTILIZABLE", "DESCARTADO", "NO_DEVUELTO"] as const).map((v) => (
                <option key={v} value={v}>{RETURN_CONDITION_LABEL[v]}</option>
              ))}
            </Select>
          </Field>

          <Field label="Motivo" name="reason" required error={errors.reason}>
            <Input
              name="reason"
              maxLength={120}
              defaultValue={employee.terminatedAt ? "Cese del trabajador" : "Devolución de EPP"}
              invalid={!!errors.reason}
            />
          </Field>

          <Field
            label="Observaciones"
            name="notes"
            required={condicion === "NO_DEVUELTO"}
            error={errors.notes}
            hint={condicion === "NO_DEVUELTO" ? "Explica qué pasó: se perdió, no se presentó a devolverlo…" : undefined}
          >
            <Textarea name="notes" maxLength={1000} rows={2} invalid={!!errors.notes} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
