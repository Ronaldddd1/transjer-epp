"use client";

import { Landmark } from "lucide-react";
import { useState } from "react";
import { setDetraction } from "@/actions/invoices";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { VoucherField } from "@/components/ui/voucher-field";
import { DETRACTION_STATUS_LABEL, formatMoney, todayLima, type DetractionStatusKey } from "@/lib/utils";

export type DetractionRef = {
  id: string;
  series: string;
  number: string;
  currency: string;
  total: string;
  supplierName: string;
  detractionAmount: string | null;
  detractionStatus: string;
  detractionPaidAt: string | null;
  detractionReceipt: string | null;
  detractionOperation: string | null;
  detractionNotes: string | null;
  /** Si ya hay una imagen de la constancia guardada, no se vuelve a pedir. */
  tieneConstancia?: boolean;
};

/**
 * Registro del depósito de la detracción.
 *
 * El monto no se escribe: lo calcula el sistema desde el importe de la factura. Lo que la
 * encargada aporta es el estado, la fecha del depósito y la constancia del Banco de la Nación.
 */
export function DetractionModal({ invoice, variant = "primary", compact = false }: {
  invoice: DetractionRef; variant?: ButtonVariant; compact?: boolean;
}) {
  const [estado, setEstado] = useState<DetractionStatusKey>(invoice.detractionStatus as DetractionStatusKey);
  const pagada = estado === "PAGADA";
  const noAplica = invoice.detractionStatus === "NO_APLICA";

  return (
    <FormModal
      title={`Detracción de ${invoice.series}-${invoice.number}`}
      description="Estado del depósito del 4 % en el Banco de la Nación."
      submitLabel="Guardar"
      size="sm"
      action={(fd) => setDetraction(invoice.id, fd)}
      trigger={(open) => (
        <Button variant={variant} size={compact ? "sm" : "md"} onClick={open} disabled={noAplica} title={noAplica ? "Esta operación no se detrae" : "Registrar la detracción"}>
          <Landmark className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Detracción</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Proveedor</dt><dd className="font-medium">{invoice.supplierName}</dd>
            <dt className="text-steel-500">Factura</dt><dd className="font-medium">{formatMoney(invoice.total, invoice.currency)}</dd>
            <dt className="text-steel-500">A depositar</dt>
            <dd className="font-display text-base font-bold">{formatMoney(invoice.detractionAmount, invoice.currency)}</dd>
          </dl>

          <Field label="Estado" name="detractionStatus" required error={errors.detractionStatus}>
            <Select name="detractionStatus" value={estado} onChange={(e) => setEstado(e.target.value as DetractionStatusKey)}>
              {(["PENDIENTE", "EN_PROCESO", "PAGADA", "OBSERVADA"] as const).map((v) => (
                <option key={v} value={v}>{DETRACTION_STATUS_LABEL[v]}</option>
              ))}
            </Select>
          </Field>

          {pagada && (
            <>
              <Field label="Fecha del depósito" name="detractionPaidAt" required error={errors.detractionPaidAt}>
                <DateInput name="detractionPaidAt" defaultValue={invoice.detractionPaidAt ?? todayLima()} max={todayLima()} required invalid={!!errors.detractionPaidAt} />
              </Field>
              <Field label="N.º de constancia" name="detractionReceipt" required error={errors.detractionReceipt} hint="El que devuelve el Banco de la Nación.">
                <Input name="detractionReceipt" defaultValue={invoice.detractionReceipt ?? ""} maxLength={40} inputMode="numeric" placeholder="301536291" />
              </Field>
              <Field label="N.º de operación" name="detractionOperation" error={errors.detractionOperation}>
                <Input name="detractionOperation" defaultValue={invoice.detractionOperation ?? ""} maxLength={40} />
              </Field>
              {/* La constancia en papel se pide una sola vez: si ya está guardada, corregir
                  una nota no obliga a volver a subirla. */}
              <VoucherField
                requerido={!invoice.tieneConstancia}
                etiqueta={invoice.tieneConstancia ? "Cambiar la constancia (opcional)" : "Imagen de la constancia"}
                error={errors.voucher}
                ayuda={invoice.tieneConstancia
                  ? "Ya hay una constancia guardada. Sube otra solo si reemplaza a la anterior."
                  : "La captura o el PDF de la constancia del Banco de la Nación. Sin esto no se da por depositada."}
              />
            </>
          )}

          <Field
            label="Observaciones"
            name="detractionNotes"
            required={estado === "OBSERVADA"}
            error={errors.detractionNotes}
            hint={estado === "OBSERVADA" ? "Explica qué se observó." : undefined}
          >
            <Textarea name="detractionNotes" defaultValue={invoice.detractionNotes ?? ""} maxLength={1000} rows={2} />
          </Field>

          {!pagada && <input type="hidden" name="detractionPaidAt" value="" />}
        </>
      )}
    </FormModal>
  );
}
