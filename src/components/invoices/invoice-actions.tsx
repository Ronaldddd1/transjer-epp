"use client";

import { Ban, CheckCircle2, FileCheck2, FileMinus2, HandCoins, RotateCcw, Trash2, Undo2 } from "lucide-react";
import {
  observeInvoice, payAdvance, payInvoice, registerCreditNote, removeAdvance, reopenInvoice,
  restoreInvoice, setGuideReceived, voidInvoice,
} from "@/actions/invoices";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-field";
import { FormModal } from "@/components/ui/form-modal";
import { VoucherField } from "@/components/ui/voucher-field";
import { formatMoney, saldoAPagar, todayLima } from "@/lib/utils";

export type InvoiceRef = {
  id: string;
  series: string;
  number: string;
  currency: string;
  total: string;
  supplierName: string;
  /** La detracción va al Banco de la Nación, no al proveedor. */
  detractionAmount?: string | null;
  /** Lo que ya se le adelantó al proveedor a cuenta de esta factura. */
  advances?: string | null;
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
            <DateInput name="guideReceivedAt" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.guideReceivedAt} />
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
          {/* La cuenta hecha, para no rehacerla a mano en cada pago: del total se baja la
              detracción —que va al Banco de la Nación— y lo que ya se le adelantó al
              proveedor. Lo de abajo es lo que se transfiere hoy. */}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Comprobante</dt><dd className="font-medium">{docLabel(invoice)}</dd>
            <dt className="text-steel-500">Proveedor</dt><dd className="font-medium">{invoice.supplierName}</dd>
            <dt className="text-steel-500">Total</dt>
            <dd className="font-medium tabular">{formatMoney(invoice.total, invoice.currency)}</dd>
            {Number(invoice.detractionAmount ?? 0) > 0 && (
              <>
                <dt className="text-steel-500">Detracción</dt>
                <dd className="tabular text-steel-600">− {formatMoney(invoice.detractionAmount, invoice.currency)}</dd>
              </>
            )}
            {Number(invoice.advances ?? 0) > 0 && (
              <>
                <dt className="text-steel-500">Adelantos</dt>
                <dd className="tabular text-steel-600">− {formatMoney(invoice.advances, invoice.currency)}</dd>
              </>
            )}
            <dt className="border-t border-steel-200 pt-1.5 font-medium text-ink">A transferir</dt>
            <dd className="border-t border-steel-200 pt-1.5 font-display text-base font-bold">
              {formatMoney(saldoAPagar(invoice.total, invoice.detractionAmount, invoice.advances), invoice.currency)}
            </dd>
          </dl>
          <Field label="Fecha de pago" name="paidAt" required error={errors.paidAt}>
            <DateInput name="paidAt" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.paidAt} />
          </Field>
          <Field label="Referencia" name="paymentReference" error={errors.paymentReference} hint="Número de operación, transferencia o cheque.">
            <Input name="paymentReference" maxLength={120} placeholder="Transferencia 0012345" />
          </Field>
          <VoucherField error={errors.voucher} />
          <Field label="Observaciones del pago" name="paymentNotes" error={errors.paymentNotes}>
            <Textarea name="paymentNotes" maxLength={1000} rows={2} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/**
 * Registra un adelanto a cuenta de la factura, sin cerrarla.
 *
 * Va en la tabla principal, al lado de Pagar: un adelanto se entrega mientras la factura
 * sigue pendiente, y tener que entrar a la ficha para anotarlo hacía que se anotaran
 * después —o no se anotaran— y el saldo que figuraba no era el que se le debía.
 */
export function AdvanceModal({ invoice, variant = "outline", compact = false }: { invoice: InvoiceRef; variant?: ButtonVariant; compact?: boolean }) {
  const saldo = saldoAPagar(invoice.total, invoice.detractionAmount, invoice.advances);
  return (
    <FormModal
      title="Registrar un adelanto"
      description="Baja el saldo de la factura y la deja pendiente por la diferencia."
      submitLabel="Registrar el adelanto"
      size="sm"
      action={(fd) => payAdvance(invoice.id, fd)}
      trigger={(open) => (
        <Button variant={variant} size={compact ? "sm" : "md"} onClick={open} title="Registrar un adelanto" aria-label={compact ? "Registrar un adelanto" : undefined}>
          <HandCoins className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Adelanto</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Comprobante</dt><dd className="font-medium">{docLabel(invoice)}</dd>
            <dt className="text-steel-500">Proveedor</dt><dd className="font-medium">{invoice.supplierName}</dd>
            {Number(invoice.advances ?? 0) > 0 && (
              <>
                <dt className="text-steel-500">Ya adelantado</dt>
                <dd className="tabular text-steel-600">{formatMoney(invoice.advances, invoice.currency)}</dd>
              </>
            )}
            <dt className="border-t border-steel-200 pt-1.5 font-medium text-ink">Saldo</dt>
            <dd className="border-t border-steel-200 pt-1.5 font-display text-base font-bold">
              {formatMoney(saldo, invoice.currency)}
            </dd>
          </dl>
          <Field
            label="Importe del adelanto"
            name="amount"
            required
            error={errors.amount}
            hint={`No puede pasar del saldo: ${formatMoney(saldo, invoice.currency)}.`}
          >
            <Input name="amount" inputMode="decimal" placeholder="500.00" invalid={!!errors.amount} autoFocus />
          </Field>
          <Field label="Fecha del adelanto" name="paidAt" required error={errors.paidAt}>
            <DateInput name="paidAt" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.paidAt} />
          </Field>
          <Field label="Referencia" name="paymentReference" error={errors.paymentReference} hint="Número de operación o transferencia.">
            <Input name="paymentReference" maxLength={120} placeholder="Transferencia 0012345" />
          </Field>
          <VoucherField error={errors.voucher} />
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" maxLength={500} rows={2} placeholder="A cuenta del flete de Trujillo." />
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

/**
 * Registra la nota de crédito con la que el proveedor anula la factura.
 *
 * El importe viene puesto con el total de la factura, que es lo que será en todos los
 * casos: una nota de crédito que no cubre el total no anula nada, y el sistema la rechaza.
 * Se deja editable igual, para que quien la registra vea el número que está confirmando en
 * vez de aceptar a ciegas lo que el formulario rellenó solo.
 */
export function CreditNoteModal({ invoice, compact = false }: { invoice: InvoiceRef; compact?: boolean }) {
  return (
    <FormModal
      title="Registrar la nota de crédito"
      description="La factura queda anulada, con la nota de crédito al lado. No se borra: ante SUNAT existió."
      submitLabel="Registrar y anular la factura"
      size="sm"
      action={(fd) => registerCreditNote(invoice.id, fd)}
      trigger={(open) => (
        <Button variant="outline" size={compact ? "sm" : "md"} onClick={open} title="Registrar la nota de crédito">
          <FileMinus2 className="h-4 w-4" />
          <span className={compact ? "sr-only 2xl:not-sr-only" : ""}>Nota de crédito</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <p className="text-sm text-steel-600">
            Anula el comprobante <strong className="text-ink">{docLabel(invoice)}</strong> de{" "}
            {invoice.supplierName}, por{" "}
            <strong className="text-ink">{formatMoney(invoice.total, invoice.currency)}</strong>.
          </p>
          <Field
            label="Número de la nota de crédito"
            name="creditNoteNumber"
            required
            error={errors.creditNoteNumber}
            hint="Tal como viene en el comprobante del proveedor."
          >
            <Input name="creditNoteNumber" maxLength={40} placeholder="NC-01" invalid={!!errors.creditNoteNumber} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de la nota" name="creditNoteDate" error={errors.creditNoteDate}>
              <DateInput name="creditNoteDate" defaultValue={todayLima()} invalid={!!errors.creditNoteDate} />
            </Field>
            <Field
              label="Importe"
              name="creditNoteAmount"
              required
              error={errors.creditNoteAmount}
              hint="Tiene que ser el total de la factura."
            >
              <Input
                name="creditNoteAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={Number(invoice.total).toFixed(2)}
                invalid={!!errors.creditNoteAmount}
              />
            </Field>
          </div>
          <Field label="Observación" name="notes" error={errors.notes} hint="Opcional: por qué se anuló.">
            <Textarea name="notes" maxLength={250} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/** Quita un adelanto anotado por error. El voucher se queda entre los archivos de la factura. */
export function RemoveAdvanceButton({ id, detalle }: { id: string; detalle: string }) {
  return (
    <ConfirmButton
      action={() => removeAdvance(id)}
      title="Quitar el adelanto"
      message={`Se quitará el adelanto de ${detalle} y el saldo de la factura volverá a subir. El comprobante queda entre los archivos.`}
      confirmLabel="Quitar"
      confirmVariant="danger"
      triggerVariant="ghost"
      triggerLabel={<Trash2 className="h-4 w-4" />}
      triggerTitle="Quitar el adelanto"
      size="icon"
    />
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
