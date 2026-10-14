"use client";

import { CalendarPlus, CheckCircle2, Coins, Handshake, Trash2, Undo2 } from "lucide-react";
import {
  deleteObligation, extendSchedule, payInstallment, renegotiateAmount, reopenInstallment,
  setInstallmentAmount, setObligationStatus,
} from "@/actions/obligations";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-field";
import { FormModal } from "@/components/ui/form-modal";
import { formatDate, formatMoney, todayLima } from "@/lib/utils";

export type InstallmentRef = {
  id: string;
  number: number;
  dueDate: string;
  total: string | null;
  currency: string;
  obligationName: string;
};

/** Registrar el pago de una cuota. */
export function PayInstallmentModal({ installment, compact = false }: { installment: InstallmentRef; compact?: boolean }) {
  return (
    <FormModal
      title={`Pagar cuota ${installment.number}`}
      description="La cuota quedará marcada como pagada, con la fecha y el responsable."
      submitLabel="Confirmar pago"
      size="sm"
      action={(fd) => payInstallment(installment.id, fd)}
      trigger={(open) => (
        <Button size={compact ? "sm" : "md"} onClick={open} title="Registrar pago">
          <CheckCircle2 className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Pagar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Obligación</dt><dd className="font-medium">{installment.obligationName}</dd>
            <dt className="text-steel-500">Cuota</dt><dd className="font-medium">N.º {installment.number} · vence {formatDate(installment.dueDate)}</dd>
            <dt className="text-steel-500">Programada</dt>
            <dd className="font-display text-base font-bold">
              {installment.total ? formatMoney(installment.total, installment.currency) : "sin importe"}
            </dd>
          </dl>
          <Field label="Fecha de pago" name="paidAt" required error={errors.paidAt}>
            <DateInput name="paidAt" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.paidAt} />
          </Field>
          <Field
            label="Importe pagado"
            name="paidAmount"
            required
            error={errors.paidAmount}
            hint="Se guarda lo que realmente salió de la cuenta, aunque difiera de la cuota."
          >
            <Input name="paidAmount" defaultValue={installment.total ?? ""} inputMode="decimal" invalid={!!errors.paidAmount} />
          </Field>
          <Field label="Referencia" name="paymentReference" error={errors.paymentReference} hint="Número de operación o transferencia.">
            <Input name="paymentReference" maxLength={120} />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" maxLength={1000} rows={2} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Anotar el importe del recibo de un servicio de monto variable. */
export function SetAmountModal({ installment, compact = false }: { installment: InstallmentRef; compact?: boolean }) {
  return (
    <FormModal
      title={`Importe de la cuota ${installment.number}`}
      description="Anota lo que dice el recibo de este mes. Después se registra el pago."
      submitLabel="Guardar importe"
      size="sm"
      action={(fd) => setInstallmentAmount(installment.id, fd)}
      trigger={(open) => (
        <Button variant="outline" size={compact ? "sm" : "md"} onClick={open} title="Anotar el importe del recibo">
          <Coins className="h-4 w-4" />
          <span className={compact ? "sr-only lg:not-sr-only" : ""}>Importe</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <p className="rounded-md border border-steel-200 bg-steel-50 p-3 text-sm text-steel-600">
            {installment.obligationName} · vence {formatDate(installment.dueDate)}
          </p>
          <Field label="Importe del recibo" name="total" required error={errors.total}>
            <Input name="total" defaultValue={installment.total ?? ""} inputMode="decimal" placeholder="382.50" invalid={!!errors.total} />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" maxLength={1000} rows={2} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/**
 * Cambiar el precio acordado de un servicio a partir de un mes.
 *
 * Lo de antes no se toca: una cochera que se pagó a 300 tiene que seguir figurando a 300,
 * o los totales del año dejan de cuadrar con lo que de verdad salió de caja.
 */
export function RenegotiateModal({ obligation }: {
  obligation: { id: string; name: string; currency: string; fixedAmount: string | null };
}) {
  // Por defecto, desde el mes que viene: lo normal es acordar un precio nuevo para
  // adelante, no para el mes que ya está corriendo.
  const hoy = todayLima();
  const [y, m] = hoy.split("-").map(Number);
  const mesSiguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  return (
    <FormModal
      title={`Renegociar ${obligation.name}`}
      description="El precio nuevo rige desde el mes que elijas. Los meses anteriores se quedan como están."
      submitLabel="Aplicar el precio nuevo"
      size="sm"
      action={(fd) => renegotiateAmount(obligation.id, fd)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open} title="Cambiar el importe acordado">
          <Handshake className="h-4 w-4" /> Renegociar
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <p className="rounded-md border border-steel-200 bg-steel-50 p-3 text-sm text-steel-600">
            Hoy se paga <strong className="text-ink">{formatMoney(obligation.fixedAmount, obligation.currency)}</strong> al mes.
          </p>
          <Field label="Importe nuevo" name="amount" required error={errors.amount}>
            <Input name="amount" defaultValue="" inputMode="decimal" placeholder="350.00" invalid={!!errors.amount} />
          </Field>
          <Field
            label="Rige desde"
            name="from"
            required
            error={errors.from}
            hint="Se aplica a los vencimientos pendientes de ese mes en adelante."
          >
            <DateInput name="from" defaultValue={mesSiguiente} required invalid={!!errors.from} />
          </Field>
          <Field label="Motivo del acuerdo" name="reason" error={errors.reason} hint="Opcional. Queda en el historial.">
            <Textarea name="reason" maxLength={300} rows={2} placeholder="Acuerdo con la playa por renovación anual." />
          </Field>
          <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2 text-sm text-[#7A5A00]">
            Las cuotas ya pagadas no se tocan, y las pendientes de meses anteriores conservan su importe.
            Así queda registrado lo que se pagó en cada mes.
          </p>
        </>
      )}
    </FormModal>
  );
}

export function ReopenInstallmentButton({ installment }: { installment: InstallmentRef }) {
  return (
    <ConfirmButton
      title={`Reabrir la cuota ${installment.number}`}
      message="El pago registrado quedará sin efecto y la cuota vuelve a estar pendiente. Queda anotado en auditoría."
      confirmLabel="Reabrir"
      action={() => reopenInstallment(installment.id)}
      triggerLabel={<><Undo2 className="h-4 w-4" /> Reabrir</>}
      triggerTitle="Reabrir"
      triggerVariant="ghost"
    />
  );
}

export function ExtendScheduleButton({ obligationId }: { obligationId: string }) {
  return (
    <ConfirmButton
      title="Extender el calendario"
      message="Se agregan los vencimientos mensuales del próximo año, para que sigan apareciendo en el calendario de pagos."
      confirmLabel="Agregar"
      action={() => extendSchedule(obligationId)}
      triggerLabel={<><CalendarPlus className="h-4 w-4" /> Extender un año</>}
      triggerTitle="Extender el calendario"
      triggerVariant="outline"
      confirmVariant="primary"
    />
  );
}

export function ObligationStatusButton({ id, status, name }: { id: string; status: string; name: string }) {
  const cerrar = status === "ACTIVA";
  return (
    <ConfirmButton
      title={cerrar ? `Cerrar "${name}"` : `Reactivar "${name}"`}
      message={
        cerrar
          ? "Deja de aparecer en el calendario de pagos. Sus cuotas pendientes se quedan como están, por si hay que consultarlas."
          : "Vuelve a aparecer en el calendario con sus cuotas pendientes."
      }
      confirmLabel={cerrar ? "Cerrar" : "Reactivar"}
      action={() => setObligationStatus(id, cerrar ? "CERRADA" : "ACTIVA")}
      triggerLabel={cerrar ? "Cerrar" : "Reactivar"}
      triggerTitle={cerrar ? "Cerrar" : "Reactivar"}
      triggerVariant="ghost"
    />
  );
}

/**
 * Elimina una obligación registrada por error.
 *
 * Solo aparece mientras no haya ni una cuota pagada. Con pagos registrados el botón se
 * cambia por el de anular: borrar dejaría un hueco en la caja que nadie podría explicar.
 */
export function DeleteObligationButton({ id, name, paidCount }: { id: string; name: string; paidCount: number }) {
  if (paidCount > 0) {
    return (
      <ConfirmButton
        action={() => setObligationStatus(id, "ANULADA")}
        title={`Anular "${name}"`}
        message={`Tiene ${paidCount} cuota(s) pagada(s), así que no se puede eliminar sin perder ese historial de pagos. Al anularla deja de contar en el calendario y en los totales de deuda, pero queda consultable.`}
        confirmLabel="Anular"
        triggerVariant="ghost"
        size="md"
        triggerLabel={<><Trash2 className="h-4 w-4 text-red-600" /> Anular</>}
        triggerTitle="Anular esta obligación"
      />
    );
  }
  return (
    <ConfirmButton
      action={() => deleteObligation(id)}
      title={`Eliminar "${name}"`}
      message={`Se borra junto con su cronograma y no se puede deshacer. No tiene ninguna cuota pagada, así que no se pierde historial de pagos; lo eliminado queda registrado en auditoría. Hazlo solo si la registraste por error.`}
      confirmLabel="Eliminar"
      triggerVariant="ghost"
      size="md"
      triggerLabel={<><Trash2 className="h-4 w-4 text-red-600" /> Eliminar</>}
      triggerTitle="Eliminar esta obligación"
    />
  );
}
