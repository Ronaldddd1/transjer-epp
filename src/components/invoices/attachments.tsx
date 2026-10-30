"use client";

import { Paperclip, Trash2 } from "lucide-react";
import { removeInvoiceAttachment, uploadInvoiceAttachments } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { ImageInput } from "@/components/ui/image-input";

export function UploadAttachmentsModal({ invoiceId, maxMb }: { invoiceId: string; maxMb: number }) {
  return (
    <FormModal
      title="Adjuntar archivos"
      description="Factura en PDF, XML, guía de remisión o cualquier documento de respaldo."
      submitLabel="Adjuntar"
      size="sm"
      action={(fd) => uploadInvoiceAttachments(invoiceId, fd)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open}><Paperclip className="h-4 w-4" /> Adjuntar</Button>
      )}
    >
      {() => (
        <Field label="Archivos" name="files" required hint={`PDF, XML, ZIP o imagen. Máximo ${maxMb} MB por archivo.`}>
          <ImageInput id="files" name="files" multiple accept=".pdf,.xml,.zip,.png,.jpg,.jpeg" />
        </Field>
      )}
    </FormModal>
  );
}

export function RemoveAttachmentButton({ id, filename }: { id: string; filename: string }) {
  return (
    <ConfirmButton
      action={() => removeInvoiceAttachment(id)}
      title="Eliminar archivo"
      message={`Se eliminará ${filename} de la factura. Esta acción no se puede deshacer.`}
      confirmLabel="Eliminar"
      triggerLabel={<Trash2 className="h-4 w-4 text-red-600" />}
      triggerTitle="Eliminar archivo"
      size="icon"
    />
  );
}
