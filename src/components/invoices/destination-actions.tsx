"use client";

import { PenLine, Wand2 } from "lucide-react";
import { renameDestination, unifyAllDestinations } from "@/actions/destinations";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, Input } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

type Variante = { name: string; facturas: number };

/** Renombra un destino (con todas sus escrituras), o lo junta con otro escribiendo el nombre de ese. */
export function RenameDestinationModal({ variantes, todos }: { variantes: Variante[]; todos: string[] }) {
  const principal = variantes[0].name;
  const facturas = variantes.reduce((n, v) => n + v.facturas, 0);
  return (
    <FormModal
      title={`Renombrar "${principal}"`}
      description={`${facturas} factura(s)${variantes.length > 1 ? `, escrito de ${variantes.length} maneras` : ""}.`}
      submitLabel="Guardar"
      size="md"
      action={renameDestination}
      trigger={(open) => (
        <Button variant={variantes.length > 1 ? "outline" : "ghost"} size="sm" onClick={open} title="Renombrar o juntar con otro destino">
          <PenLine className="h-4 w-4" /> {variantes.length > 1 ? "Unificar" : "Renombrar"}
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-3">
          {variantes.map((v) => <input key={v.name} type="hidden" name="variante" value={v.name} />)}
          <Field
            label="Debe quedar como"
            name="final"
            required
            error={errors.final}
            hint="Para juntarlo con otro destino, escribe el nombre de ese: se usa su misma escritura."
          >
            <Input name="final" defaultValue={principal.replace(/\s+/g, " ").trim()} list="destinos-existentes" maxLength={120} autoComplete="off" />
            <datalist id="destinos-existentes">{todos.map((d) => <option key={d} value={d} />)}</datalist>
          </Field>
          {variantes.length > 1 && (
            <p className="text-sm text-steel-600">
              Se cambian: {variantes.map((v) => `"${v.name}" (${v.facturas})`).join(", ")}.
            </p>
          )}
        </div>
      )}
    </FormModal>
  );
}

export function UnifyAllDestinationsButton({ grupos, facturas }: { grupos: number; facturas: number }) {
  return (
    <ConfirmButton
      action={unifyAllDestinations}
      title="Unificar destinos escritos de varias maneras"
      message={`${grupos} destino(s) están escritos de varias maneras (solo cambian mayúsculas, tildes o espacios). Cada uno queda con la escritura que usan más facturas; se corrigen ${facturas} factura(s). Queda en auditoría.`}
      confirmLabel="Unificar"
      confirmVariant="primary"
      triggerVariant="primary"
      size="md"
      triggerLabel={<><Wand2 className="h-4 w-4" /> Unificar todos ({grupos})</>}
      triggerTitle="Unificar todos los destinos repetidos"
    />
  );
}
