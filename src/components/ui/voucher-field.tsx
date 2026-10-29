"use client";

import { Field } from "@/components/ui/field";
import { VOUCHER_ACCEPT } from "@/lib/utils";

/**
 * El campo del comprobante de pago, igual en los cuatro sitios donde se registra un pago.
 *
 * Donde sale plata va obligatorio: la factura, el adelanto y la detracción no se registran
 * sin la captura de la transferencia. En las cuotas de préstamos y servicios es opcional,
 * porque muchas se pagan en efectivo y no hay nada que adjuntar.
 */
export function VoucherField({
  requerido = true,
  error,
  etiqueta,
  ayuda,
}: {
  requerido?: boolean;
  error?: string;
  etiqueta?: string;
  ayuda?: string;
}) {
  return (
    <Field
      label={etiqueta ?? (requerido ? "Comprobante del pago" : "Comprobante del pago (opcional)")}
      name="voucher"
      required={requerido}
      error={error}
      hint={ayuda ?? (requerido
        ? "La captura o el PDF de la transferencia. Sin esto el pago no se registra."
        : "La captura o el PDF de la transferencia, si la hubo.")}
    >
      <input
        id="voucher"
        name="voucher"
        type="file"
        accept={VOUCHER_ACCEPT}
        required={requerido}
        className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-ink-700"
      />
    </Field>
  );
}
