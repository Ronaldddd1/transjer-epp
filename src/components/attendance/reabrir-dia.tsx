"use client";

import { LockOpen } from "lucide-react";
import { reabrirAsistencia } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { formatDate, HORAS_PARA_CORREGIR_ASISTENCIA } from "@/lib/utils";

/**
 * Reabre un día de asistencia cerrado para corregir un error. Pide el motivo, que queda
 * en la auditoría y en la pantalla del día.
 */
export function ReabrirDia({ dia, cerradas }: { dia: string; cerradas: number }) {
  return (
    <FormModal
      title={`Reabrir la asistencia del ${formatDate(dia)}`}
      description={`${cerradas} marca(s) cerradas. Al reabrir, se pueden corregir durante ${HORAS_PARA_CORREGIR_ASISTENCIA} horas y después se vuelven a cerrar.`}
      submitLabel="Reabrir para corregir"
      size="sm"
      action={(fd) => { fd.set("day", dia); return reabrirAsistencia(fd); }}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open}>
          <LockOpen className="h-4 w-4" /> Reabrir para corregir
        </Button>
      )}
    >
      {({ errors }) => (
        <Field label="Qué hay que corregir" name="motivo" required error={errors.motivo}
          hint="Queda registrado con tu nombre, junto con la fecha y la hora.">
          <Textarea name="motivo" rows={3} maxLength={200} placeholder="Se marcó falta a Juan Pérez, pero sí vino a la descarga" invalid={!!errors.motivo} />
        </Field>
      )}
    </FormModal>
  );
}
