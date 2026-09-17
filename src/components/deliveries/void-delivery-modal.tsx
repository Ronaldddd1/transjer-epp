"use client";

import { Ban } from "lucide-react";
import { voidDelivery } from "@/actions/deliveries";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

type Props = {
  delivery: {
    id: string;
    deliveryDate: string;
    employeeName: string;
    productName: string;
    size: string | null;
    quantity: number;
  };
  dateLabel: string;
};

/** Anula una entrega: devuelve el stock y la marca como anulada (no la borra). */
export function VoidDeliveryModal({ delivery, dateLabel }: Props) {
  return (
    <FormModal
      title="Anular entrega"
      description="La entrega no se borra: queda marcada como anulada y el stock vuelve al inventario."
      submitLabel="Anular entrega"
      submitVariant="danger"
      size="sm"
      action={(fd) => voidDelivery(delivery.id, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} title="Anular entrega" aria-label="Anular entrega" className="text-red-700 hover:bg-red-50">
          <Ban className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Anular</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Fecha</dt><dd className="font-medium">{dateLabel}</dd>
            <dt className="text-steel-500">Trabajador</dt><dd className="font-medium">{delivery.employeeName}</dd>
            <dt className="text-steel-500">EPP</dt>
            <dd className="font-medium">{delivery.productName}{delivery.size ? ` (${delivery.size})` : ""}</dd>
            <dt className="text-steel-500">Cantidad</dt>
            <dd className="font-medium">{delivery.quantity} — se devolverá{delivery.quantity === 1 ? "" : "n"} al stock</dd>
          </dl>
          <Field label="Motivo de la anulación" name="voidReason" required error={errors.voidReason} hint="Ejemplo: registrada por error, el trabajador no recibió el EPP.">
            <Textarea name="voidReason" invalid={!!errors.voidReason} maxLength={250} rows={3} autoFocus />
          </Field>
        </>
      )}
    </FormModal>
  );
}
