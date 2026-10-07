"use client";

import { Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { createSupplier, updateSupplier } from "@/actions/suppliers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { DEFAULT_TERM_DAYS, type PaymentTermKey } from "@/lib/utils";

export type SupplierRow = {
  id: string;
  ruc: string | null;
  businessName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  notes: string | null;
  defaultPaymentTerm: string;
  defaultTermDays: number;
};

export function SupplierFormModal({ supplier }: { supplier?: SupplierRow }) {
  const editing = !!supplier;
  const [term, setTerm] = useState<PaymentTermKey>((supplier?.defaultPaymentTerm as PaymentTermKey) ?? "CONTADO");
  const [days, setDays] = useState(String(supplier?.defaultTermDays ?? DEFAULT_TERM_DAYS.CONTADO));

  const onTerm = (value: PaymentTermKey) => {
    setTerm(value);
    setDays(String(DEFAULT_TERM_DAYS[value]));
  };

  /** Al cerrar sin guardar, el alta siguiente empieza limpia. */
  const limpiar = () => {
    if (editing) return;
    setTerm("CONTADO");
    setDays(String(DEFAULT_TERM_DAYS.CONTADO));
  };

  return (
    <FormModal
      title={editing ? `Editar ${supplier.businessName}` : "Nuevo proveedor"}
      description={editing ? undefined : "Empresa que presta servicios de transporte y emite facturas."}
      submitLabel={editing ? "Guardar cambios" : "Registrar proveedor"}
      size="md"
      action={(fd) => (editing ? updateSupplier(supplier.id, fd) : createSupplier(fd))}
      onClosed={limpiar}
      trigger={(open) =>
        editing ? (
          <Button variant="ghost" size="sm" onClick={open} title="Editar" aria-label="Editar proveedor">
            <Pencil className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Editar</span>
          </Button>
        ) : (
          <Button onClick={open}><Plus className="h-4 w-4" /> Nuevo proveedor</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="RUC" name="ruc" error={errors.ruc} hint="11 dígitos. Si aún no lo tienes, déjalo vacío: se completa solo cuando llegue una factura con su XML.">
            <Input name="ruc" defaultValue={supplier?.ruc ?? ""} invalid={!!errors.ruc} maxLength={11} inputMode="numeric" placeholder="20548392117" />
          </Field>
          <Field label="Razón social" name="businessName" required error={errors.businessName}>
            <Input name="businessName" defaultValue={supplier?.businessName ?? ""} invalid={!!errors.businessName} maxLength={200} />
          </Field>
          <Field label="Nombre comercial" name="tradeName" error={errors.tradeName}>
            <Input name="tradeName" defaultValue={supplier?.tradeName ?? ""} maxLength={200} />
          </Field>
          <Field label="Contacto" name="contactName" error={errors.contactName}>
            <Input name="contactName" defaultValue={supplier?.contactName ?? ""} maxLength={120} />
          </Field>
          <Field label="Correo" name="email" error={errors.email} hint="Desde donde envía sus facturas.">
            <Input name="email" type="email" defaultValue={supplier?.email ?? ""} invalid={!!errors.email} maxLength={160} />
          </Field>
          <Field label="Teléfono" name="phone" error={errors.phone}>
            <Input name="phone" defaultValue={supplier?.phone ?? ""} invalid={!!errors.phone} maxLength={20} />
          </Field>
          <div className="rounded-lg border border-steel-200 bg-steel-50 p-4 sm:col-span-2">
            <p className="mb-3 text-sm font-semibold text-ink">Condición de pago pactada</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Condición" name="defaultPaymentTerm" error={errors.defaultPaymentTerm}>
                <Select name="defaultPaymentTerm" value={term} onChange={(e) => onTerm(e.target.value as PaymentTermKey)}>
                  <option value="CONTADO">Contado</option>
                  <option value="CREDITO">Crédito</option>
                </Select>
              </Field>
              <Field label="Días de plazo" name="defaultTermDays" error={errors.defaultTermDays}>
                <Input name="defaultTermDays" value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" invalid={!!errors.defaultTermDays} />
              </Field>
            </div>
            <p className="mt-3 text-sm text-steel-600">
              {term === "CONTADO"
                ? `Sus facturas vencerán ${days} día(s) después de que llegue el correo.`
                : `Sus facturas vencerán ${days} día(s) después de que entregue la guía en físico. Hasta entonces no tendrán fecha de pago.`}
            </p>
            <p className="mt-1 text-xs text-steel-500">
              Es solo la propuesta: al registrar cada factura se puede cambiar.
            </p>
          </div>

          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={supplier?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
