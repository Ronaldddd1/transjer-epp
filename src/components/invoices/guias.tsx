"use client";

import { CheckCheck, FilePlus2, PackageCheck, Undo2, X } from "lucide-react";
import { agregarGuia, deshacerLlegadaGuia, marcarGuiasLlegadas, quitarGuia } from "@/actions/invoice-guides";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { GUIA_TIPO_LABEL, PLAZO_TRANSPORTE_DIAS } from "@/lib/guias";
import { formatDate, todayLima } from "@/lib/utils";

export type Guia = { id: string; kind: "TRANSPORTISTA" | "REMITENTE"; number: string | null; receivedAt: string | null };

const nombre = (g: Guia) => g.number ?? "Sin número";

/** Las guías de una factura, como chips: ✓ con la fecha si llegó, "por llegar" si no. */
export function GuiasChips({ guias, legado }: { guias: Guia[]; legado?: string | null }) {
  if (!guias.length) {
    return legado
      ? <span className="text-xs text-steel-600">Guía entregada el {formatDate(legado)}</span>
      : <span className="text-xs text-steel-500">Sin guías anotadas</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {guias.map((g) => (
        <li
          key={g.id}
          title={GUIA_TIPO_LABEL[g.kind]}
          className={g.receivedAt
            ? "rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900"
            : "rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"}
        >
          {nombre(g)} · {g.receivedAt ? `llegó ${formatDate(g.receivedAt).slice(0, 5)}` : "por llegar"}
        </li>
      ))}
    </ul>
  );
}

/** Anotar que llegaron las guías: se marcan cuáles (todas las que faltan, por defecto). */
export function LlegaronGuiasModal({ invoiceId, factura, guias, compact = false }: {
  invoiceId: string; factura: string; guias: Guia[]; compact?: boolean;
}) {
  const pendientes = guias.filter((g) => !g.receivedAt);
  if (!pendientes.length) return null;
  return (
    <FormModal
      title="Llegaron las guías"
      description={`Factura ${factura}. Cuando llega la última, la factura vence ${PLAZO_TRANSPORTE_DIAS} días después.`}
      submitLabel="Anotar llegada"
      size="sm"
      action={(fd) => marcarGuiasLlegadas(invoiceId, fd)}
      trigger={(open) => (
        <Button size="sm" onClick={open} title="Anotar que llegaron las guías" className="whitespace-nowrap">
          <PackageCheck className="h-4 w-4" /><span className={compact ? "sr-only xl:not-sr-only" : ""}>Llegó la guía</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">¿Cuáles llegaron?</legend>
            {pendientes.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="guias" value={g.id} defaultChecked className="h-4 w-4 accent-[#F5B800]" />
                <span className="font-medium">{nombre(g)}</span>
                <span className="text-steel-500">· {GUIA_TIPO_LABEL[g.kind]}</span>
              </label>
            ))}
          </fieldset>
          <Field label="Llegaron el" name="fecha" required error={errors.fecha} hint="El día que estuvieron en la oficina, en físico.">
            <DateInput name="fecha" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.fecha} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

export function AgregarGuiaModal({ invoiceId, factura }: { invoiceId: string; factura: string }) {
  return (
    <FormModal
      title="Agregar una guía"
      description={`A la factura ${factura}. Si todavía no llegó, la factura vuelve a esperarla para tener fecha de pago.`}
      submitLabel="Agregar"
      size="sm"
      action={(fd) => agregarGuia(invoiceId, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} title="Agregar una guía a esta factura" aria-label="Agregar una guía">
          <FilePlus2 className="h-4 w-4" />
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <Field label="Número de guía" name="numero" error={errors.numero} hint="Déjalo vacío si todavía no se sabe.">
            <Input name="numero" maxLength={40} placeholder="T001-000123" className="uppercase" />
          </Field>
          <Field label="Tipo" name="tipo" error={errors.tipo}>
            <Select name="tipo" defaultValue="TRANSPORTISTA">
              {Object.entries(GUIA_TIPO_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Ya llegó el" name="llego" error={errors.llego} hint="Solo si ya está en la oficina.">
            <DateInput name="llego" max={todayLima()} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

/** El panel completo, para la ficha de la factura: cada guía con lo que se puede hacer con ella. */
export function GuiasPanel({ invoiceId, factura, guias, puedeEditar, pagada }: {
  invoiceId: string; factura: string; guias: Guia[]; puedeEditar: boolean; pagada: boolean;
}) {
  const llegaron = guias.filter((g) => g.receivedAt).length;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-steel-600">
          {guias.length === 0
            ? "Sin guías anotadas."
            : llegaron === guias.length
              ? <><CheckCheck className="mr-1 inline h-4 w-4 text-emerald-700" aria-hidden />Llegaron todas las guías.</>
              : `Llegaron ${llegaron} de ${guias.length} guía(s). Se paga ${PLAZO_TRANSPORTE_DIAS} días después de la última.`}
        </p>
        {puedeEditar && (
          <div className="ml-auto flex items-center gap-1">
            <LlegaronGuiasModal invoiceId={invoiceId} factura={factura} guias={guias} />
            <AgregarGuiaModal invoiceId={invoiceId} factura={factura} />
          </div>
        )}
      </div>
      {guias.length > 0 && (
        <ul className="divide-y divide-steel-100 rounded-md border border-steel-200">
          {guias.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="font-semibold tabular">{nombre(g)}</span>
              <span className="text-xs text-steel-500">{GUIA_TIPO_LABEL[g.kind]}</span>
              <span className={g.receivedAt ? "text-emerald-800" : "text-amber-800"}>
                {g.receivedAt ? `Llegó el ${formatDate(g.receivedAt)}` : "Por llegar"}
              </span>
              {puedeEditar && (
                <span className="ml-auto flex items-center gap-1">
                  {g.receivedAt && !pagada && (
                    <ConfirmButton
                      action={() => deshacerLlegadaGuia(g.id)}
                      title="Deshacer la llegada"
                      message={`La guía ${nombre(g)} vuelve a figurar por llegar, y la factura se queda sin fecha de pago hasta que llegue.`}
                      confirmLabel="Deshacer"
                      confirmVariant="primary"
                      triggerLabel={<Undo2 className="h-4 w-4" />}
                      triggerTitle={`Deshacer la llegada de ${nombre(g)}`}
                    />
                  )}
                  {guias.length > 1 && (
                    <ConfirmButton
                      action={() => quitarGuia(g.id)}
                      title="Quitar la guía"
                      message={`¿Quitar la guía ${nombre(g)} de esta factura? Úsalo si se anotó por error.`}
                      confirmLabel="Quitar"
                      triggerLabel={<X className="h-4 w-4" />}
                      triggerTitle={`Quitar la guía ${nombre(g)}`}
                    />
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
