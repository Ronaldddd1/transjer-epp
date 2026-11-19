"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { crearPlan } from "@/actions/rutas";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-field";
import { Field } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { addDays, todayLima } from "@/lib/utils";

/** Subir el Excel de programación que manda el cliente; abre el plan al terminar. */
export function NuevaProgramacion() {
  const router = useRouter();
  return (
    <FormModal
      title="Nueva programación"
      description="Sube el Excel que manda el cliente con los pedidos del día. Se agrupa por dirección y se ubica cada entrega en el mapa."
      submitLabel="Cargar programación"
      action={async (fd) => {
        const r = await crearPlan(fd);
        if (r.ok && r.id) router.push(`/rutas/${r.id}`);
        return r;
      }}
      trigger={(open) => (
        <Button onClick={open}><FileUp className="h-4 w-4" /> Nueva programación</Button>
      )}
    >
      {({ errors }) => (
        <>
          <Field label="Excel de la programación" name="archivo" required error={errors.archivo}
            hint="El archivo tal como lo manda el cliente (.xlsx). Se usa la hoja con los pedidos y sus direcciones.">
            <input id="archivo" name="archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="block w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1 file:font-semibold" />
          </Field>
          <Field label="Día del reparto" name="serviceDate" required error={errors.serviceDate}>
            <DateInput name="serviceDate" defaultValue={addDays(todayLima(), 1)} invalid={!!errors.serviceDate} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
