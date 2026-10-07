"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { reinstateEmployee, terminateEmployee } from "@/actions/returns";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { formatDate, todayLima } from "@/lib/utils";

type Props = {
  employee: { id: string; name: string; hireDate: string | null };
  /** Unidades de EPP que todavía tiene a su cargo, para avisarlo antes de cesarlo. */
  pendiente: number;
  tipos: number;
};

/**
 * Registro del cese.
 *
 * Es el botón que dispara el control de devolución: desde que hay fecha de cese, el
 * trabajador aparece en la pantalla de devoluciones pendientes hasta que entregue todo.
 * Por eso el modal dice de antemano cuánto EPP tiene a su cargo.
 */
export function TerminationModal({ employee, pendiente, tipos }: Props) {
  return (
    <FormModal
      title={`Registrar el cese de ${employee.name}`}
      description="El trabajador queda inactivo y el sistema le reclama el EPP que tiene a su cargo."
      submitLabel="Registrar cese"
      submitVariant="danger"
      size="sm"
      action={(fd) => terminateEmployee(employee.id, fd)}
      trigger={(open) => (
        <Button variant="outline" onClick={open}>
          <UserMinus className="h-4 w-4" /> Registrar cese
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          {pendiente > 0 ? (
            <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2.5 text-sm text-[#7A5A00]">
              Tiene <strong>{pendiente} unidad(es)</strong> de EPP a su cargo, de {tipos} tipo(s).
              Al registrar el cese quedará en la lista de devoluciones pendientes hasta que entregue todo.
            </p>
          ) : (
            <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm text-steel-600">
              No tiene EPP a su cargo, así que no quedará nada pendiente de devolución.
            </p>
          )}

          <Field
            label="Fecha de cese"
            name="terminatedAt"
            required
            error={errors.terminatedAt}
            hint={employee.hireDate ? `Ingresó el ${formatDate(employee.hireDate)}.` : undefined}
          >
            <DateInput name="terminatedAt" defaultValue={todayLima()} required invalid={!!errors.terminatedAt} />
          </Field>

          <Field label="Motivo" name="terminationReason" error={errors.terminationReason} hint="Ejemplo: renuncia, fin de contrato.">
            <Input name="terminationReason" maxLength={160} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Deshace un cese puesto por error. */
export function ReinstateButton({ employee }: { employee: { id: string; name: string; terminatedAt: string } }) {
  return (
    <ConfirmButton
      action={() => reinstateEmployee(employee.id)}
      title="Anular el cese"
      message={`${employee.name} figura cesado desde el ${formatDate(employee.terminatedAt)}. Al anularlo vuelve a estar activo y deja de aparecer en las devoluciones pendientes. Las devoluciones ya registradas se mantienen.`}
      confirmLabel="Anular el cese"
      confirmVariant="primary"
      triggerVariant="outline"
      size="md"
      triggerLabel={<><UserPlus className="h-4 w-4" /> Anular cese</>}
      triggerTitle="Anular el cese y reincorporar"
    />
  );
}
