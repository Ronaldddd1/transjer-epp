"use client";

import { FilePlus2, RefreshCw, XCircle } from "lucide-react";
import { createInvoiceFromEmail, discardEmail, retryEmail } from "@/actions/mailbox";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { SupplierOption } from "@/components/invoices/invoice-form-modal";
import { INVOICE_DOC_TYPE_LABEL, todayLima } from "@/lib/utils";

export function RetryEmailButton({ id, subject }: { id: string; subject: string }) {
  return (
    <ConfirmButton
      action={retryEmail.bind(null, id)}
      title="Reintentar correo"
      message={`Se volverá a leer "${subject}" desde el buzón para intentar registrar la factura.`}
      confirmLabel="Reintentar"
      confirmVariant="primary"
      triggerVariant="ghost"
      triggerLabel={<RefreshCw className="h-4 w-4" />}
      triggerTitle="Reintentar"
      size="icon"
    />
  );
}

export function DiscardEmailModal({ id, subject }: { id: string; subject: string }) {
  return (
    <FormModal
      title="Descartar correo"
      description="Úsalo cuando el correo no corresponde a una factura por pagar."
      submitLabel="Descartar"
      size="sm"
      action={(fd) => discardEmail(id, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="icon" onClick={open} title="Descartar" aria-label="Descartar correo">
          <XCircle className="h-4 w-4 text-red-600" />
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <p className="text-sm text-steel-600">Correo: <strong className="text-ink">{subject}</strong></p>
          <Field label="Motivo" name="statusReason" required error={errors.statusReason} hint="Ejemplo: publicidad, no es una factura, correo repetido.">
            <Textarea name="statusReason" maxLength={250} rows={3} invalid={!!errors.statusReason} autoFocus />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** Registro manual de una factura cuyo correo no traía el XML legible. */
export function InvoiceFromEmailModal({ emailId, subject, suppliers }: { emailId: string; subject: string; suppliers: SupplierOption[] }) {
  return (
    <FormModal
      title="Registrar factura del correo"
      description="Copia los datos del PDF. Los archivos del correo quedarán adjuntos a la factura."
      submitLabel="Registrar factura"
      size="lg"
      action={(fd) => createInvoiceFromEmail(emailId, fd)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open} title="Registrar factura">
          <FilePlus2 className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Registrar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-6">
          <p className="text-sm text-steel-600 sm:col-span-6">Correo: <strong className="text-ink">{subject}</strong></p>
          <Field label="Proveedor" name="supplierId" required error={errors.supplierId} className="sm:col-span-6">
            <Select name="supplierId" defaultValue="" invalid={!!errors.supplierId}>
              <option value="" disabled>Selecciona un proveedor…</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} — RUC {s.ruc}</option>)}
            </Select>
          </Field>
          <Field label="Tipo" name="docType" required error={errors.docType} className="sm:col-span-2">
            <Select name="docType" defaultValue="FACTURA">
              {Object.entries(INVOICE_DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Serie" name="series" required error={errors.series} className="sm:col-span-2">
            <Input name="series" className="uppercase" maxLength={8} placeholder="F001" invalid={!!errors.series} />
          </Field>
          <Field label="Número" name="number" required error={errors.number} className="sm:col-span-2">
            <Input name="number" maxLength={12} inputMode="numeric" placeholder="2589" invalid={!!errors.number} />
          </Field>
          <Field label="Fecha de emisión" name="issueDate" required error={errors.issueDate} className="sm:col-span-2">
            <Input name="issueDate" type="date" defaultValue={todayLima()} invalid={!!errors.issueDate} />
          </Field>
          <Field label="Vencimiento" name="dueDate" error={errors.dueDate} className="sm:col-span-2">
            <Input name="dueDate" type="date" invalid={!!errors.dueDate} />
          </Field>
          <Field label="Moneda" name="currency" required error={errors.currency} className="sm:col-span-2">
            <Select name="currency" defaultValue="PEN">
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </Select>
          </Field>
          <Field label="Importe total" name="total" required error={errors.total} className="sm:col-span-3">
            <Input name="total" inputMode="decimal" placeholder="1180.00" invalid={!!errors.total} />
          </Field>
          <Field label="Guía de remisión (GRT)" name="grtNumber" error={errors.grtNumber} className="sm:col-span-3">
            <Input name="grtNumber" maxLength={40} />
          </Field>
          <Field label="Concepto del servicio" name="description" error={errors.description} className="sm:col-span-6">
            <Input name="description" maxLength={250} placeholder="Servicio de transporte Lima - Trujillo" />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
