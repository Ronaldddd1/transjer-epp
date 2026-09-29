"use client";

import { Ban, CheckCircle2, FileCheck2, RotateCcw, Undo2 } from "lucide-react";
import { observeInvoice, payInvoice, reopenInvoice, restoreInvoice, setGuideReceived, voidInvoice } from "@/actions/invoices";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { formatMoney, todayLima } from "@/lib/utils";

export type InvoiceRef = {
  id: string;
  series: string;
  number: string;
  currency: string;
  total: string;
  supplierName: string;
};

const docLabel = (i: InvoiceRef) => `${i.series}-${i.number}`;

/**
 * Anota la entrega física de la guía de remisión.
 * Es lo que hace arrancar el plazo de una factura a crédito: hasta que el proveedor la
 * trae en mano, la factura no tiene fecha límite y no entra en la cola de pagos.
 */
export function GuideReceivedModal({ invoice, compact = false }: { invoice: InvoiceRef; compact?: boolean }) {
  return (
    <FormModal
      title="Anotar entrega de la guía"
      description="Desde esta fecha empieza a correr el plazo de pago de la factura."
      submitLabel="Guardar"
      size="sm"
      action={(fd) => setGuideReceived(invoice.id, fd)}
      trigger={(open) => (
        <Button variant="outline" size={compact ? "sm" : "md"} onClick={open} title="Anotar entrega de la guía">
          <FileCheck2 className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Anotar guía</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Comprobante</dt><dd className="font-medium">{docLabel(invoice)}</dd>
            <dt className="text-steel-500">Proveedor</dt><dd className="font-medium">{invoice.supplierName}</dd>
          </dl>
          <Field label="Guía entregada el" name="guideReceivedAt" required error={errors.guideReceivedAt} hint="El día que el proveedor la trajo en físico.">
            <Input name="guideReceivedAt" type="date" defaultValue={todayLima()} max={todayLima()} invalid={!!errors.guideReceivedAt} />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" maxLength={500} rows={2} placeholder="Quién la recibió, en qué estado llegó…" />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Ventana de registro de pago: la acción principal de la encargada. */
export function PayInvoiceModal({ invoice, variant = "primary", compact = false }: { invoice: InvoiceRef; variant?: ButtonVariant; compact?: boolean }) {
  return (
    <FormModal
      title="Registrar pago"
      description="La factura quedará marcada como pagada, con la fecha y el responsable."
      submitLabel="Confirmar pago"
      size="sm"
      action={(fd) => payInvoice(invoice.id, fd)}
      trigger={(open) => (
        <Button variant={variant} size={compact ? "sm" : "md"} onClick={open} title="Registrar pago" aria-label={compact ? "Registrar pago" : undefined}>
          <CheckCircle2 className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Pagar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Comprobante</dt><dd className="font-medium">{docLabel(invoice)}</dd>
            <dt className="text-steel-500">Proveedor</dt><dd className="font-medium">{invoice.supplierName}</dd>
            <dt className="text-steel-500">Importe</dt>
            <dd className="font-display text-base font-bold">{formatMoney(invoice.total, invoice.currency)}</dd>
          </dl>
          <Field label="Fecha de pago" name="paidAt" required error={errors.paidAt}>
            <Input name="paidAt" type="date" defaultValue={todayLima()} max={todayLima()} invalid={!!errors.paidAt} />
          </Field>
          <Field label="Referencia" name="paymentReference" error={errors.paymentReference} hint="Número de operación, transferencia o cheque.">
            <Input name="paymentReference" maxLength={120} placeholder="Transferencia 0012345" />
          </Field>
          <Field label="Observaciones del pago" name="paymentNotes" error={errors.paymentNotes}>
            <Textarea name="paymentNotes" maxLength={1000} rows={2} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

type ReasonAction = "observe" | "void" | "reopen";

const REASON_CONFIG: Record<ReasonAction, {
  title: string; description: string; submit: string; hint: string; variant: ButtonVariant; label: string; icon: typeof Ban;
}> = {
  observe: {
    title: "Observar factura",
    description: "La factura queda retenida hasta que el proveedor corrija lo indicado.",
    submit: "Marcar como observada",
    hint: "Ejemplo: falta la guía de remisión, el importe no coincide con el servicio.",
    variant: "outline",
    label: "Observar",
    icon: Undo2,
  },
  void: {
    title: "Anular registro",
    description: "El registro no se borra: queda marcado como anulado y fuera de los totales.",
    submit: "Anular registro",
    hint: "Ejemplo: se registró por error, comprobante duplicado.",
    variant: "danger",
    label: "Anular",
    icon: Ban,
  },
  reopen: {
    title: "Reabrir factura pagada",
    description: "El pago quedará sin efecto y la factura volverá a estar pendiente.",
    submit: "Reabrir factura",
    hint: "Ejemplo: el pago se registró en la factura equivocada.",
    variant: "danger",
    label: "Reabrir",
    icon: RotateCcw,
  },
};

const ACTIONS = { observe: observeInvoice, void: voidInvoice, reopen: reopenInvoice };

export function InvoiceReasonModal({ invoice, action, compact = false }: { invoice: InvoiceRef; action: ReasonAction; compact?: boolean }) {
  const cfg = REASON_CONFIG[action];
  const Icon = cfg.icon;
  return (
    <FormModal
      title={cfg.title}
      description={cfg.description}
      submitLabel={cfg.submit}
      submitVariant={cfg.variant === "danger" ? "danger" : undefined}
      size="sm"
      action={(fd) => ACTIONS[action](invoice.id, fd)}
      trigger={(open) => (
        <Button variant={cfg.variant === "danger" ? "ghost" : "outline"} size={compact ? "sm" : "md"} onClick={open}
          className={cfg.variant === "danger" ? "text-red-700 hover:bg-red-50" : undefined}
          title={cfg.title} aria-label={compact ? cfg.title : undefined}>
          <Icon className="h-4 w-4" />
          <span className={compact ? "sr-only 2xl:not-sr-only" : ""}>{cfg.label}</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <p className="text-sm text-steel-600">
            Comprobante <strong className="text-ink">{docLabel(invoice)}</strong> de {invoice.supplierName} por{" "}
            <strong className="text-ink">{formatMoney(invoice.total, invoice.currency)}</strong>.
          </p>
          <Field label="Motivo" name="statusReason" required error={errors.statusReason} hint={cfg.hint}>
            <Textarea name="statusReason" maxLength={250} rows={3} invalid={!!errors.statusReason} autoFocus />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Devuelve a la cola de pago una factura que el proveedor ya corrigió. */
export function RestoreInvoiceButton({ invoice }: { invoice: InvoiceRef }) {
  return (
    <ConfirmButton
      action={() => restoreInvoice(invoice.id)}
      title="Reactivar factura"
      message={`La factura ${docLabel(invoice)} volverá a quedar pendiente de pago. Úsalo cuando el proveedor ya corrigió lo observado.`}
      confirmLabel="Reactivar"
      confirmVariant="primary"
      triggerVariant="outline"
      triggerLabel={<><RotateCcw className="h-4 w-4" /> Reactivar</>}
      triggerTitle="Reactivar factura"
      size="sm"
    />
  );
}
