"use client";

import { Pencil, Plus } from "lucide-react";
import { createSupplier, updateSupplier } from "@/actions/suppliers";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

export type SupplierRow = {
  id: string;
  ruc: string;
  businessName: string;
  tradeName: string | null;
  email: string | null;
  phone: string | null;
  contactName: string | null;
  notes: string | null;
};

export function SupplierFormModal({ supplier }: { supplier?: SupplierRow }) {
  const editing = !!supplier;
  return (
    <FormModal
      title={editing ? `Editar ${supplier.businessName}` : "Nuevo proveedor"}
      description={editing ? undefined : "Empresa que presta servicios de transporte y emite facturas."}
      submitLabel={editing ? "Guardar cambios" : "Registrar proveedor"}
      size="md"
      action={(fd) => (editing ? updateSupplier(supplier.id, fd) : createSupplier(fd))}
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
          <Field label="RUC" name="ruc" required error={errors.ruc} hint="11 dígitos">
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
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={supplier?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
