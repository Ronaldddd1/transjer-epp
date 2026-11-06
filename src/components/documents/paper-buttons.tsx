"use client";

import { Eye, FileUp } from "lucide-react";
import { attachDocumentFile, createDocument } from "@/actions/documents";
import { DateInput } from "@/components/ui/date-field";
import { Field } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { ImageInput } from "@/components/ui/image-input";
import { cn, formatDate } from "@/lib/utils";

/**
 * Los dos botones debajo de cada papel de la tabla de la flota: subirlo y verlo.
 *
 * "Subir" hace lo que corresponde según cómo está el papel:
 *  - si figura solo con la fecha (lo que entra por el Excel), le pone el archivo a ese
 *    mismo documento, para no dejar dos SOAT: uno con la fecha y otro con el papel;
 *  - si falta, o si ya tiene archivo (es la renovación), registra uno nuevo con su fecha.
 *    El anterior queda en el historial y en la tabla pasa a mostrarse el que vence después.
 *
 * "Ver" queda apagado mientras no haya archivo: un enlace que lleva a un error hace perder
 * el viaje a quien lo pulsa creyendo que el papel está.
 */

type Papel = { id: string; expiresAt: string | null; tieneArchivo: boolean } | null;

const ACEPTA = "application/pdf,image/jpeg,image/png,image/webp,image/heic";
const CLASE_ARCHIVO = "block w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1.5 file:text-sm file:font-medium";
const BOTON = "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-tight";

export function PaperButtons({ vehicleId, plate, kind, label, papel, puedeSubir }: {
  vehicleId: string;
  plate: string;
  kind: string;
  /** "SOAT", "revisión técnica"… para los textos. */
  label: string;
  papel: Papel;
  puedeSubir: boolean;
}) {
  const soloFecha = !!papel && !papel.tieneArchivo;

  return (
    <span className="mt-1.5 flex items-center gap-1">
      {puedeSubir && (
        <FormModal
          title={soloFecha ? `Adjuntar el ${label}` : papel ? `Subir el ${label} renovado` : `Subir el ${label}`}
          description={soloFecha
            ? `${plate} · ya figura con vencimiento ${papel!.expiresAt ? formatDate(papel!.expiresAt) : "sin fecha"}. Aquí va el PDF o la foto.`
            : papel
              ? `${plate} · se guarda como uno nuevo; el anterior queda en el historial de la unidad.`
              : `${plate} · todavía no tiene ${label} cargado.`}
          submitLabel="Guardar"
          size="md"
          action={soloFecha ? (fd) => attachDocumentFile(papel!.id, fd) : createDocument}
          trigger={(open) => (
            <button
              type="button"
              onClick={open}
              title={`Subir documento: ${label} de ${plate}`}
              className={cn(BOTON, "border-steel-300 bg-white text-steel-700 hover:border-ink hover:text-ink")}
            >
              <FileUp className="h-3 w-3" aria-hidden /> Subir
            </button>
          )}
        >
          {({ errors }) => (
            <div className="grid gap-4">
              {!soloFecha && (
                <>
                  <input type="hidden" name="vehicleId" value={vehicleId} />
                  <input type="hidden" name="kind" value={kind} />
                </>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Vence el"
                  name="expiresAt"
                  error={errors.expiresAt}
                  hint={soloFecha ? "Déjala igual si es la misma." : "Sin esta fecha no se avisa cuando caduque."}
                >
                  <DateInput name="expiresAt" defaultValue={soloFecha ? papel!.expiresAt ?? "" : ""} invalid={!!errors.expiresAt} />
                </Field>
                {!soloFecha && (
                  <Field label="Fecha de emisión" name="issuedAt" error={errors.issuedAt}>
                    <DateInput name="issuedAt" invalid={!!errors.issuedAt} />
                  </Field>
                )}
              </div>
              <Field label="Archivo" name="archivo" required hint="PDF o foto del documento.">
                <ImageInput name="archivo" required accept={ACEPTA} className={CLASE_ARCHIVO} />
              </Field>
            </div>
          )}
        </FormModal>
      )}

      {papel?.tieneArchivo ? (
        <a
          href={`/api/documentos/${papel.id}`}
          target="_blank"
          rel="noopener"
          title={`Ver documento: ${label} de ${plate}`}
          className={cn(BOTON, "border-steel-300 bg-white text-steel-700 hover:border-ink hover:text-ink")}
        >
          <Eye className="h-3 w-3" aria-hidden /> Ver
        </a>
      ) : (
        <span
          title="Todavía no tiene archivo cargado"
          aria-disabled="true"
          className={cn(BOTON, "cursor-not-allowed border-steel-200 bg-steel-50 text-steel-300")}
        >
          <Eye className="h-3 w-3" aria-hidden /> Ver
        </span>
      )}
    </span>
  );
}
