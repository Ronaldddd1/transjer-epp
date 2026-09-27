"use client";

import { FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { createInvoice, importInvoiceFromFiles, updateInvoice } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { INVOICE_DOC_TYPE_LABEL, todayLima } from "@/lib/utils";

export type SupplierOption = { id: string; ruc: string; name: string };

export type InvoiceFormValues = {
  id: string;
  supplierId: string;
  docType: string;
  series: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  serviceDate: string | null;
  currency: string;
  subtotal: string | null;
  igv: string | null;
  total: string;
  description: string | null;
  grtNumber: string | null;
  notes: string | null;
  receptionDate: string;
};

const IGV_RATE = 0.18;

export function InvoiceFormModal({ suppliers, invoice }: { suppliers: SupplierOption[]; invoice?: InvoiceFormValues }) {
  const editing = !!invoice;
  const [subtotal, setSubtotal] = useState(invoice?.subtotal ?? "");
  const [igv, setIgv] = useState(invoice?.igv ?? "");
  const [total, setTotal] = useState(invoice?.total ?? "");

  /** Al escribir el subtotal se propone el IGV y el total; ambos se pueden corregir a mano. */
  const onSubtotal = (value: string) => {
    setSubtotal(value);
    const n = Number(value.replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) {
      const tax = n * IGV_RATE;
      setIgv(tax.toFixed(2));
      setTotal((n + tax).toFixed(2));
    }
  };

  return (
    <FormModal
      title={editing ? `Editar ${invoice.series}-${invoice.number}` : "Nueva factura"}
      description={editing ? "Corrige los datos del comprobante registrado." : "Registra una factura de proveedor por servicios de transporte."}
      submitLabel={editing ? "Guardar cambios" : "Registrar factura"}
      size="lg"
      action={(fd) => (editing ? updateInvoice(invoice.id, fd) : createInvoice(fd))}
      trigger={(open) =>
        editing ? (
          <Button variant="outline" size="sm" onClick={open}><Pencil className="h-4 w-4" /> Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="h-4 w-4" /> Nueva factura</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Proveedor" name="supplierId" required error={errors.supplierId} className="sm:col-span-6">
            <Select name="supplierId" defaultValue={invoice?.supplierId ?? ""} invalid={!!errors.supplierId}>
              <option value="" disabled>{suppliers.length ? "Selecciona un proveedor…" : "No hay proveedores activos"}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} — RUC {s.ruc}</option>)}
            </Select>
          </Field>

          <Field label="Tipo" name="docType" required error={errors.docType} className="sm:col-span-2">
            <Select name="docType" defaultValue={invoice?.docType ?? "FACTURA"}>
              {Object.entries(INVOICE_DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Serie" name="series" required error={errors.series} hint="Ejemplo: F001" className="sm:col-span-2">
            <Input name="series" defaultValue={invoice?.series ?? ""} invalid={!!errors.series} className="uppercase" maxLength={8} placeholder="F001" />
          </Field>
          <Field label="Número" name="number" required error={errors.number} hint="Ejemplo: 2589" className="sm:col-span-2">
            <Input name="number" defaultValue={invoice?.number ?? ""} invalid={!!errors.number} maxLength={12} inputMode="numeric" placeholder="2589" />
          </Field>

          <Field label="Fecha de emisión" name="issueDate" required error={errors.issueDate} className="sm:col-span-2">
            <Input name="issueDate" type="date" defaultValue={invoice?.issueDate ?? todayLima()} invalid={!!errors.issueDate} />
          </Field>
          <Field label="Llegó el" name="receivedDate" required error={errors.receivedDate} hint="Define el viernes en que se paga." className="sm:col-span-2">
            <Input name="receivedDate" type="date" defaultValue={invoice?.receptionDate ?? todayLima()} max={todayLima()} invalid={!!errors.receivedDate} />
          </Field>
          <Field label="Vencimiento" name="dueDate" error={errors.dueDate} hint="Para avisar de las que ya vencieron." className="sm:col-span-2">
            <Input name="dueDate" type="date" defaultValue={invoice?.dueDate ?? ""} invalid={!!errors.dueDate} />
          </Field>

          <Field label="Moneda" name="currency" required error={errors.currency} className="sm:col-span-2">
            <Select name="currency" defaultValue={invoice?.currency ?? "PEN"}>
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </Select>
          </Field>
          <Field label="Subtotal" name="subtotal" error={errors.subtotal} hint="Opcional: calcula el IGV." className="sm:col-span-2">
            <Input name="subtotal" value={subtotal} onChange={(e) => onSubtotal(e.target.value)} inputMode="decimal" placeholder="1000.00" invalid={!!errors.subtotal} />
          </Field>
          <Field label="IGV" name="igv" error={errors.igv} className="sm:col-span-2">
            <Input name="igv" value={igv} onChange={(e) => setIgv(e.target.value)} inputMode="decimal" placeholder="180.00" invalid={!!errors.igv} />
          </Field>

          <Field label="Importe total" name="total" required error={errors.total} hint="Es el importe que se pagará." className="sm:col-span-3">
            <Input name="total" value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="1180.00" invalid={!!errors.total} />
          </Field>
          <Field label="Guía de remisión (GRT)" name="grtNumber" error={errors.grtNumber} hint="Ejemplo: T001-000123" className="sm:col-span-3">
            <Input name="grtNumber" defaultValue={invoice?.grtNumber ?? ""} maxLength={40} />
          </Field>
          <Field label="Fecha del servicio" name="serviceDate" error={errors.serviceDate} className="sm:col-span-3">
            <Input name="serviceDate" type="date" defaultValue={invoice?.serviceDate ?? ""} />
          </Field>

          <Field label="Concepto del servicio" name="description" error={errors.description} className="sm:col-span-6">
            <Input name="description" defaultValue={invoice?.description ?? ""} maxLength={250} placeholder="Servicio de transporte Lima - Trujillo" />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-6">
            <Textarea name="notes" defaultValue={invoice?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/** Registro rápido leyendo el XML del comprobante electrónico. */
export function ImportInvoiceModal({ maxMb }: { maxMb: number }) {
  return (
    <FormModal
      title="Cargar factura desde el XML"
      description="Selecciona el XML del comprobante y, si lo tienes, el PDF y la guía de remisión. Los datos se leen solos."
      submitLabel="Leer y registrar"
      size="md"
      action={importInvoiceFromFiles}
      trigger={(open) => (
        <Button variant="outline" onClick={open}><FileText className="h-4 w-4" /> Cargar XML</Button>
      )}
    >
      {({ errors }) => (
        <>
          <Field
            label="Archivos del comprobante"
            name="files"
            required
            error={errors.files ?? errors.form}
            hint={`XML obligatorio. Puedes añadir el PDF y la guía. Máximo ${maxMb} MB por archivo.`}
          >
            <input
              id="files"
              name="files"
              type="file"
              multiple
              accept=".xml,.zip,.pdf,.png,.jpg,.jpeg"
              className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-ink-700"
            />
          </Field>
          <p className="rounded-md border border-steel-200 bg-steel-50 p-3 text-sm text-steel-600">
            El XML es el archivo que SUNAT exige junto a la factura. De ahí se leen el proveedor, la serie,
            el número, la fecha y los importes, así no hay que escribirlos a mano.
          </p>
        </>
      )}
    </FormModal>
  );
}
