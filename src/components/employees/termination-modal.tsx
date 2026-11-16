"use client";

import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { reinstateEmployee, terminateEmployee } from "@/actions/returns";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { PendingItem } from "@/components/deliveries/return-modal";
import { cn, formatDate, formatMoney, todayLima } from "@/lib/utils";

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

/**
 * Anula un cese, preguntando qué pasó: si vuelve a trabajar (reingreso, con su nueva
 * fecha de ingreso) o si el cese fue un error (y entonces se pueden deshacer las
 * devoluciones que se registraron por él).
 */
export function ReinstateButton({ employee, devueltoDesdeCese = 0 }: {
  employee: { id: string; name: string; terminatedAt: string };
  /** Unidades devueltas desde la fecha del cese: lo que se puede deshacer si fue un error. */
  devueltoDesdeCese?: number;
}) {
  const [modo, setModo] = useState<"REINGRESO" | "ERROR" | "">("");
  const opcion = (valor: "REINGRESO" | "ERROR", titulo: string, detalle: string) => (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5",
        modo === valor ? "border-ink bg-steel-50" : "border-steel-200 hover:border-steel-400",
      )}
    >
      <input type="radio" name="modo" value={valor} checked={modo === valor} onChange={() => setModo(valor)} className="mt-1" />
      <span>
        <span className="block font-semibold">{titulo}</span>
        <span className="block text-sm text-steel-500">{detalle}</span>
      </span>
    </label>
  );

  return (
    <FormModal
      title={`Anular el cese de ${employee.name}`}
      description={`Figura cesado desde el ${formatDate(employee.terminatedAt)}. ¿Qué pasó?`}
      submitLabel={modo === "REINGRESO" ? "Reincorporar" : "Anular el cese"}
      size="md"
      action={(fd) => reinstateEmployee(employee.id, fd)}
      onClosed={() => setModo("")}
      trigger={(open) => (
        <Button variant="outline" onClick={open} title="Anular el cese o reincorporar">
          <UserPlus className="h-4 w-4" /> Anular cese
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Qué pasó</legend>
            {opcion(
              "REINGRESO",
              "Regresa a trabajar (reingreso)",
              "Se fue y vuelve. Lo que devolvió sigue devuelto, su periodo anterior queda en el historial y su ficha toma la nueva fecha de ingreso.",
            )}
            {opcion(
              "ERROR",
              "El cese fue un error",
              "Nunca se fue. Vuelve a estar activo con su fecha de ingreso de siempre.",
            )}
            {errors.modo && <p className="text-sm text-red-700">{errors.modo}</p>}
          </fieldset>

          {modo === "REINGRESO" && (
            <Field label="Fecha de reingreso" name="rehiredAt" required error={errors.rehiredAt}
              hint={`Tiene que ser después del cese (${formatDate(employee.terminatedAt)}). Para entregarle EPP otra vez, usa "Registrar entrega".`}>
              <DateInput name="rehiredAt" defaultValue={todayLima()} required invalid={!!errors.rehiredAt} />
            </Field>
          )}

          {modo === "ERROR" && devueltoDesdeCese > 0 && (
            <label className="flex gap-3 rounded-md border border-brand/60 bg-brand-soft px-3 py-2.5 text-sm text-[#7A5A00]">
              <input type="checkbox" name="deshacerDevoluciones" defaultChecked className="mt-0.5" />
              <span>
                <strong>Deshacer las devoluciones registradas desde el cese</strong> ({devueltoDesdeCese} unidad(es)):
                el EPP vuelve a su cargo y lo que había vuelto al stock sale otra vez. Desmárcalo si de verdad devolvió el EPP.
              </span>
            </label>
          )}
        </>
      )}
    </FormModal>
  );
}
