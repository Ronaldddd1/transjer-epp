"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { createObligation, updateObligation } from "@/actions/obligations";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { OBLIGATION_TYPE_HINT, OBLIGATION_TYPE_LABEL, todayLima, type ObligationTypeKey } from "@/lib/utils";

export type ObligationFormValues = {
  id: string;
  type: string;
  name: string;
  creditor: string;
  reference: string | null;
  currency: string;
  principal: string | null;
  annualRate: string | null;
  installmentsCount: number | null;
  disbursedAt: string | null;
  billingDay: number | null;
  variableAmount: boolean;
  fixedAmount: string | null;
  notes: string | null;
};

export function ObligationFormModal({ obligation }: { obligation?: ObligationFormValues }) {
  const editing = !!obligation;
  const [type, setType] = useState<ObligationTypeKey>((obligation?.type as ObligationTypeKey) ?? "PRESTAMO");
  const [variable, setVariable] = useState(obligation?.variableAmount ?? true);
  const esPrestamo = type === "PRESTAMO";

  return (
    <FormModal
      title={editing ? `Editar ${obligation.name}` : "Nueva obligación"}
      description={
        editing
          ? "Corrige los datos. El cronograma se carga aparte."
          : "Un préstamo del banco, un plan de celular, la luz, un alquiler: cualquier pago que se repite."
      }
      submitLabel={editing ? "Guardar cambios" : "Registrar"}
      size="lg"
      action={(fd) => (editing ? updateObligation(obligation.id, fd) : createObligation(fd))}
      trigger={(open) =>
        editing ? (
          <Button variant="outline" size="sm" onClick={open}><Pencil className="h-4 w-4" /> Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="h-4 w-4" /> Nueva obligación</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Tipo" name="type" required error={errors.type} hint={OBLIGATION_TYPE_HINT[type]} className="sm:col-span-3">
            <Select name="type" value={type} onChange={(e) => setType(e.target.value as ObligationTypeKey)} disabled={editing}>
              {Object.entries(OBLIGATION_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            {editing && <input type="hidden" name="type" value={type} />}
          </Field>
          <Field label="Moneda" name="currency" required error={errors.currency} className="sm:col-span-3">
            <Select name="currency" defaultValue={obligation?.currency ?? "PEN"}>
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </Select>
          </Field>

          <Field label="Nombre" name="name" required error={errors.name} hint="Como lo llaman en la empresa." className="sm:col-span-3">
            <Input name="name" defaultValue={obligation?.name ?? ""} maxLength={160} invalid={!!errors.name}
              placeholder={esPrestamo ? "Préstamo BCP capital de trabajo" : "Claro - flota de celulares"} />
          </Field>
          <Field label="Entidad" name="creditor" required error={errors.creditor} hint="A quién se le paga." className="sm:col-span-3">
            <Input name="creditor" defaultValue={obligation?.creditor ?? ""} maxLength={160} invalid={!!errors.creditor}
              placeholder={esPrestamo ? "BCP" : "Claro"} />
          </Field>

          <Field label="Número de crédito o suministro" name="reference" error={errors.reference} className="sm:col-span-6">
            <Input name="reference" defaultValue={obligation?.reference ?? ""} maxLength={80} placeholder="100-191-0000-30000006902184" />
          </Field>

          {esPrestamo ? (
            <div className="rounded-lg border border-steel-200 bg-steel-50 p-4 sm:col-span-6">
              <p className="mb-3 text-sm font-semibold text-ink">Datos del préstamo</p>
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Capital desembolsado" name="principal" error={errors.principal} className="sm:col-span-2">
                  <Input name="principal" defaultValue={obligation?.principal ?? ""} inputMode="decimal" placeholder="250000.00" invalid={!!errors.principal} />
                </Field>
                <Field label="TEA (%)" name="annualRate" error={errors.annualRate} hint="Tasa efectiva anual." className="sm:col-span-2">
                  <Input name="annualRate" defaultValue={obligation?.annualRate ?? ""} inputMode="decimal" placeholder="17.00" invalid={!!errors.annualRate} />
                </Field>
                <Field label="Fecha de desembolso" name="disbursedAt" required error={errors.disbursedAt} className="sm:col-span-2">
                  <Input name="disbursedAt" type="date" defaultValue={obligation?.disbursedAt ?? ""} max={todayLima()} invalid={!!errors.disbursedAt} />
                </Field>
              </div>
              <p className="mt-3 text-sm text-steel-600">
                El número de cuotas sale del cronograma que cargues después, así que no hace falta escribirlo aquí.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-steel-200 bg-steel-50 p-4 sm:col-span-6">
              <p className="mb-3 text-sm font-semibold text-ink">Cuándo y cuánto</p>
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Día de pago" name="billingDay" required error={errors.billingDay} hint="Del 1 al 28." className="sm:col-span-2">
                  <Input name="billingDay" defaultValue={obligation?.billingDay ?? ""} inputMode="numeric" placeholder="15" invalid={!!errors.billingDay} />
                </Field>
                {!variable && (
                  <Field label="Importe mensual" name="fixedAmount" required error={errors.fixedAmount} className="sm:col-span-2">
                    <Input name="fixedAmount" defaultValue={obligation?.fixedAmount ?? ""} inputMode="decimal" placeholder="450.00" invalid={!!errors.fixedAmount} />
                  </Field>
                )}
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name="variableAmount"
                  checked={variable}
                  onChange={(e) => setVariable(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-steel-300"
                />
                <span>
                  <strong className="text-ink">El importe cambia cada mes</strong>
                  <span className="block text-steel-600">
                    Como la luz o el celular por consumo. El sistema crea el vencimiento de cada mes
                    y la encargada anota el monto cuando llega el recibo.
                  </span>
                </span>
              </label>
            </div>
          )}

          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-6">
            <Textarea name="notes" defaultValue={obligation?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
