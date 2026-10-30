"use client";

import { Field } from "@/components/ui/field";
import { ImageInput } from "@/components/ui/image-input";
import { VOUCHER_ACCEPT } from "@/lib/utils";

/**
 * El campo del comprobante de pago, igual en los cuatro sitios donde se registra un pago.
 *
 * Es opcional en todos. Exigirlo dejaba sin registrar pagos que ya se habían hecho —la
 * captura suele llegar después, por WhatsApp o al día siguiente— y una factura figurando
 * como pendiente cuando ya se pagó es peor problema que una sin imagen. La imagen se puede
 * adjuntar luego desde ARCHIVOS, en la ficha de la factura.
 *
 * Las fotos de celular se achican en el navegador antes de subirlas: una captura de 8 MB
 * no aporta nada sobre una de 1 MB, y el almacenamiento tiene un tope.
 */
export function VoucherField({
  requerido = false,
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
        : "La captura o el PDF de la transferencia, si la tienes a mano. Se puede adjuntar después.")}
    >
      <ImageInput id="voucher" name="voucher" accept={VOUCHER_ACCEPT} required={requerido} />
    </Field>
  );
}
