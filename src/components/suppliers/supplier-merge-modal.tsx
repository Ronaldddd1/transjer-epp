"use client";

import { Merge } from "lucide-react";
import { useState } from "react";
import { mergeSuppliers } from "@/actions/suppliers";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

type Opcion = { id: string; name: string; ruc: string | null };

/**
 * Unir un proveedor duplicado con el correcto: sus facturas pasan al elegido y la ficha
 * duplicada se borra. Lo que se elige es a dónde van; el que se abre es el que desaparece.
 */
export function SupplierMergeModal({ origen, opciones, destinoSugerido, variante = "icono" }: {
  origen: { id: string; name: string; ruc: string | null; facturas: number };
  opciones: Opcion[];
  /** En los duplicados detectados, el que conviene conservar. */
  destinoSugerido?: string;
  variante?: "icono" | "boton";
}) {
  return (
    <FormModal
      title={`Unir "${origen.name}" con otro proveedor`}
      description="Para cuando es el mismo proveedor escrito de otra manera."
      submitLabel="Unir y pasar las facturas"
      size="md"
      action={(fd) => mergeSuppliers(origen.id, fd)}
      trigger={(open) => variante === "boton" ? (
        <Button variant="outline" size="sm" onClick={open}>
          <Merge className="h-4 w-4" /> Unir
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={open} title="Unir con otro proveedor" aria-label="Unir con otro proveedor">
          <Merge className="h-4 w-4" />
        </Button>
      )}
    >
      {({ errors }) => <Campos origen={origen} opciones={opciones} destinoSugerido={destinoSugerido} errors={errors} />}
    </FormModal>
  );
}

function Campos({ origen, opciones, destinoSugerido, errors }: {
  origen: { id: string; name: string; ruc: string | null; facturas: number };
  opciones: Opcion[];
  destinoSugerido?: string;
  errors: Record<string, string>;
}) {
  const [destino, setDestino] = useState(destinoSugerido ?? "");
  const elegido = opciones.find((o) => o.id === destino);
  const otros = opciones.filter((o) => o.id !== origen.id);

  return (
    <div className="grid gap-4">
      <Field label="Pasar sus facturas a" name="destinoId" required error={errors.destinoId}>
        <Select name="destinoId" value={destino} onChange={(e) => setDestino(e.target.value)} invalid={!!errors.destinoId}>
          <option value="" disabled>Elige el proveedor correcto…</option>
          {otros.map((o) => (
            <option key={o.id} value={o.id}>{o.name}{o.ruc ? ` · RUC ${o.ruc}` : " · sin RUC"}</option>
          ))}
        </Select>
      </Field>
      <div className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm text-steel-700">
        <p>
          Las <strong>{origen.facturas} factura(s)</strong> de <strong>{origen.name}</strong>
          {origen.ruc ? ` (RUC ${origen.ruc})` : " (sin RUC)"} pasan a{" "}
          <strong>{elegido ? elegido.name : "el que elijas"}</strong>, con su deuda y sus pagos.
        </p>
        <p className="mt-1.5">
          Después, la ficha de <strong>{origen.name}</strong> se borra. Si tenía RUC, correo o teléfono y el
          otro no, se los pasa. Queda registrado en auditoría.
        </p>
      </div>
    </div>
  );
}
