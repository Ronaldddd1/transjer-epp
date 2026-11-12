"use client";

import { MapPinPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
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
  estibas?: { name: string | null; phone: string | null; costPerTon: string | null; notes: string | null }[];
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
          <div aria-hidden className="hidden sm:block" />

          <EstibasCampos
            iniciales={cliente?.estibas ?? (cliente && (cliente.stevedoreName || cliente.stevedorePhone || cliente.costPerTon)
              ? [{ name: cliente.stevedoreName, phone: cliente.stevedorePhone, costPerTon: cliente.costPerTon, notes: null }]
              : [])}
            errors={errors}
          />

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

type FilaEstiba = { key: number; name: string; phone: string; costPerTon: string; notes: string };

/**
 * Las estibas del cliente: una o varias, para comparar lo que cobra cada una y tener a
 * quién llamar si la de siempre no puede. Se resalta la más barata.
 */
function EstibasCampos({ iniciales, errors }: {
  iniciales: { name: string | null; phone: string | null; costPerTon: string | null; notes: string | null }[];
  errors: Record<string, string>;
}) {
  const [filas, setFilas] = useState<FilaEstiba[]>(() => {
    const base = iniciales.map((e, i) => ({
      key: i, name: e.name ?? "", phone: e.phone ?? "", costPerTon: e.costPerTon ?? "", notes: e.notes ?? "",
    }));
    return base.length ? base : [{ key: 0, name: "", phone: "", costPerTon: "", notes: "" }];
  });
  const cambiar = (key: number, campo: keyof Omit<FilaEstiba, "key">, valor: string) =>
    setFilas((f) => f.map((x) => (x.key === key ? { ...x, [campo]: valor } : x)));
  const precios = filas.map((f) => Number(f.costPerTon.replace(/,/g, ""))).filter((n) => precioValido(n));
  const minimo = precios.length > 1 ? Math.min(...precios) : null;

  return (
    <fieldset className="grid gap-3 rounded-lg border border-steel-200 bg-steel-50 p-4 sm:col-span-2">
      <legend className="px-1 text-sm font-semibold text-ink">Estibas</legend>
      <p className="-mt-1 text-sm text-steel-500">
        Anota todas las que conozcas en ese destino, con lo que cobra cada una por tonelada. La más barata se marca sola.
      </p>
      {filas.map((f, i) => {
        const costo = Number(f.costPerTon.replace(/,/g, ""));
        const masBarata = minimo !== null && precioValido(costo) && costo === minimo;
        return (
          <div key={f.key} className="grid gap-2 rounded-md border border-steel-200 bg-white p-3 sm:grid-cols-[1fr_9rem_8rem_auto] sm:items-end">
            <Field label={`Estiba ${i + 1}`} name={`estiba_nombre_${i}`} error={errors[`estiba_nombre_${i}`]}>
              <Input name="estiba_nombre" value={f.name} onChange={(e) => cambiar(f.key, "name", e.target.value)} maxLength={120} placeholder="Quién descarga allá" />
            </Field>
            <Field label="Número" name={`estiba_telefono_${i}`} error={errors[`estiba_telefono_${i}`]}>
              <Input name="estiba_telefono" inputMode="tel" value={f.phone} onChange={(e) => cambiar(f.key, "phone", e.target.value)} maxLength={40} placeholder="976 543 210" invalid={!!errors[`estiba_telefono_${i}`]} />
            </Field>
            <Field label="S/ por tonelada" name={`estiba_costo_${i}`} error={errors[`estiba_costo_${i}`]}>
              <Input name="estiba_costo" inputMode="decimal" value={f.costPerTon} onChange={(e) => cambiar(f.key, "costPerTon", e.target.value)} placeholder="35.00" invalid={!!errors[`estiba_costo_${i}`]} />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilas((x) => (x.length > 1 ? x.filter((y) => y.key !== f.key) : [{ key: Date.now(), name: "", phone: "", costPerTon: "", notes: "" }]))}
              title="Quitar esta estiba"
              aria-label={`Quitar la estiba ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
              <Input
                name="estiba_nota"
                value={f.notes}
                onChange={(e) => cambiar(f.key, "notes", e.target.value)}
                maxLength={250}
                placeholder="Nota: horario, si trae gente, si cobra aparte el montacargas…"
                aria-label={`Nota de la estiba ${i + 1}`}
                className="min-w-0 flex-1"
              />
              {masBarata && <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">La más barata</span>}
            </div>
          </div>
        );
      })}
      {errors.estibas && <p className="text-sm text-red-700">{errors.estibas}</p>}
      {filas.length < 10 && (
        <Button
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setFilas((x) => [...x, { key: Date.now(), name: "", phone: "", costPerTon: "", notes: "" }])}
        >
          <Plus className="h-4 w-4" /> Agregar otra estiba
        </Button>
      )}
    </fieldset>
  );
}

function precioValido(n: number) {
  return Number.isFinite(n) && n > 0;
}
