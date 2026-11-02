"use client";

import { MapPinPlus, Pencil } from "lucide-react";
import { createProvinceClient, updateProvinceClient } from "@/actions/province-clients";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

export type ProvinceClientData = {
  id: string;
  province: string;
  clientName: string;
  location: string | null;
  clientPhone: string | null;
  stevedoreName: string | null;
  stevedorePhone: string | null;
  costPerTon: string | null;
  notes: string | null;
};

/**
 * Las provincias a las que se viaja, como sugerencia escribible.
 *
 * Es una lista de arranque, no una lista cerrada: el campo acepta cualquier texto, porque
 * el destino nuevo siempre aparece antes que la lista que lo contempla.
 */
export const PROVINCIAS = [
  "Jaén", "Chiclayo", "Trujillo", "Piura", "Cajamarca", "Tarapoto", "Bagua", "Chachapoyas",
  "Huancayo", "Arequipa", "Cusco", "Ayacucho", "Pucallpa", "Iquitos", "Tacna", "Juliaca",
];

export function ProvinceClientModal({ cliente, provincias = [], variant = "full" }: {
  cliente?: ProvinceClientData;
  provincias?: string[];
  variant?: "full" | "icon";
}) {
  const editando = !!cliente;
  const lista = Array.from(new Set([...PROVINCIAS, ...provincias]));

  return (
    <FormModal
      title={editando ? `Ficha de ${cliente.clientName}` : "Nuevo cliente de provincia"}
      description="Lo que hace falta saber antes de mandar un viaje allá."
      submitLabel={editando ? "Guardar cambios" : "Registrar cliente"}
      size="lg"
      action={(fd) => (editando ? updateProvinceClient(cliente.id, fd) : createProvinceClient(fd))}
      trigger={(open) =>
        editando ? (
          <Button variant={variant === "icon" ? "ghost" : "outline"} size={variant === "icon" ? "sm" : "md"} onClick={open} title="Editar la ficha">
            <Pencil className="h-4 w-4" />
            <span className={variant === "icon" ? "sr-only 2xl:not-sr-only" : ""}>Editar</span>
          </Button>
        ) : (
          <Button onClick={open}><MapPinPlus className="h-4 w-4" /> Nuevo cliente</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provincia" name="province" required error={errors.province} hint="A dónde va la carga.">
            <Input
              name="province"
              list="provincia-options"
              defaultValue={cliente?.province}
              invalid={!!errors.province}
              maxLength={80}
              autoFocus={!editando}
            />
            <datalist id="provincia-options">{lista.map((p) => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field
            label="Cliente destinatario"
            name="clientName"
            required
            error={errors.clientName}
            hint="A quién se le entrega. Es por donde se busca después."
          >
            <Input name="clientName" defaultValue={cliente?.clientName} invalid={!!errors.clientName} maxLength={160} />
          </Field>

          <Field label="Ubicación" name="location" error={errors.location} className="sm:col-span-2" hint="Dirección o referencia para llegar.">
            <Input name="location" defaultValue={cliente?.location ?? ""} maxLength={250} placeholder="Av. Mesones Muro 1250, frente al grifo Primax" />
          </Field>

          <Field label="Número del cliente" name="clientPhone" error={errors.clientPhone}>
            <Input name="clientPhone" inputMode="tel" defaultValue={cliente?.clientPhone ?? ""} maxLength={40} placeholder="976 543 210" />
          </Field>
          <Field
            label="Costo por tonelada"
            name="costPerTon"
            error={errors.costPerTon}
            hint="Lo que cobra la estiba por tonelada. Déjalo vacío si todavía no hay precio."
          >
            <Input name="costPerTon" inputMode="decimal" defaultValue={cliente?.costPerTon ?? ""} placeholder="35.00" invalid={!!errors.costPerTon} />
          </Field>

          <Field label="Estibador" name="stevedoreName" error={errors.stevedoreName} hint="Quién descarga allá.">
            <Input name="stevedoreName" defaultValue={cliente?.stevedoreName ?? ""} maxLength={120} />
          </Field>
          <Field label="Número del estibador" name="stevedorePhone" error={errors.stevedorePhone}>
            <Input name="stevedorePhone" inputMode="tel" defaultValue={cliente?.stevedorePhone ?? ""} maxLength={40} placeholder="976 543 210" />
          </Field>

          <Field
            label="Observaciones"
            name="notes"
            error={errors.notes}
            className="sm:col-span-2"
            hint="Horarios de recepción, si pide guía firmada, con quién coordinar."
          >
            <Textarea name="notes" defaultValue={cliente?.notes ?? ""} maxLength={1000} rows={3} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
