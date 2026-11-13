"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { reinstateEmployee, terminateEmployee } from "@/actions/returns";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { PendingItem } from "@/components/deliveries/return-modal";
import { formatDate, formatMoney, todayLima } from "@/lib/utils";

type Props = {
  employee: { id: string; name: string; hireDate: string | null };
  /** Unidades de EPP que todavía tiene a su cargo, para avisarlo antes de cesarlo. */
  pendiente: number;
  tipos: number;
  /** El detalle de lo que tiene: es la tabla de lo que tendrá que devolver. */
  items?: PendingItem[];
};

/**
 * Registro del cese.
 *
 * Es el botón que dispara el control de devolución: desde que hay fecha de cese, el
 * trabajador aparece en la pantalla de devoluciones pendientes hasta que entregue todo.
 * Por eso el modal dice de antemano cuánto EPP tiene a su cargo.
 */
export function TerminationModal({ employee, pendiente, tipos, items = [] }: Props) {
  const valor = items.reduce((s, i) => s + Number(i.unitPrice ?? 0) * i.pendiente, 0);
  return (
    <FormModal
      title={`Registrar el cese de ${employee.name}`}
      description="El trabajador queda inactivo y el sistema le reclama el EPP que tiene a su cargo."
      submitLabel="Registrar cese"
      submitVariant="danger"
      size={items.length ? "md" : "sm"}
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
            <>
              <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2.5 text-sm text-[#7A5A00]">
                Tiene <strong>{pendiente} unidad(es)</strong> de EPP a su cargo, de {tipos} tipo(s).
                Al registrar el cese quedará en la lista de devoluciones pendientes hasta que entregue todo.
              </p>
              {items.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-steel-200">
                  <table className="w-full border-collapse text-left text-sm" data-testid="tabla-cese">
                    <caption className="bg-steel-50 px-3 py-2 text-left text-[13px] font-semibold text-steel-600">
                      Lo que tiene que devolver
                    </caption>
                    <thead>
                      <tr className="text-[13px] text-steel-500">
                        <th className="border-y border-steel-200 px-3 py-1.5 font-medium">EPP</th>
                        <th className="border-y border-steel-200 px-3 py-1.5 text-right font-medium">Cant.</th>
                        <th className="border-y border-steel-200 px-3 py-1.5 text-right font-medium">P. unit.</th>
                        <th className="border-y border-steel-200 px-3 py-1.5 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <tr key={i.productId} className="border-b border-steel-100 last:border-b-0">
                          <td className="px-3 py-1.5">{i.productName}{i.size && <span className="text-steel-500"> · {i.size}</span>}</td>
                          <td className="px-3 py-1.5 text-right tabular">{i.pendiente}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-steel-600">{i.unitPrice != null ? formatMoney(i.unitPrice) : "—"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{i.unitPrice != null ? formatMoney(Number(i.unitPrice) * i.pendiente) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                    {valor > 0 && (
                      <tfoot>
                        <tr className="bg-steel-50 font-semibold">
                          <td className="px-3 py-1.5" colSpan={3}>Total</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{formatMoney(valor)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
              <p className="text-sm text-steel-500">
                Después del cese, “Registrar devolución” abre esta misma tabla para marcar lo que entrega y sacar el acta.
              </p>
            </>
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
