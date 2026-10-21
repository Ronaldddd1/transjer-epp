"use client";

import { Gauge, Plus, Settings2, Trash2, Wrench } from "lucide-react";
import { useState } from "react";
import {
  deleteMaintenance, registerMaintenance, setMaintenancePlan, setOdometer,
} from "@/actions/maintenance";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import {
  MAINTENANCE_DEFAULTS, MAINTENANCE_KIND_LABEL, todayLima, type MaintenanceKind,
} from "@/lib/utils";

export type UnidadRef = {
  id: string;
  plate: string;
  odometerKm: number | null;
  odometerAt: string | null;
};

const km = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toLocaleString("es-PE"));

/**
 * Registra un mantenimiento que ya se hizo.
 *
 * El kilometraje viene con el de la unidad puesto: quien registra el servicio casi siempre
 * lo hace el mismo día y con el tablero delante, así que corregir un número es más rápido
 * que escribirlo entero.
 */
export function MaintenanceModal({ unidad, kind, compact = false }: {
  unidad: UnidadRef;
  /** Si se abre desde una fila concreta, ese tipo viene elegido. */
  kind?: MaintenanceKind;
  compact?: boolean;
}) {
  const [tipo, setTipo] = useState<MaintenanceKind>(kind ?? "ACEITE");

  return (
    <FormModal
      title={`Registrar mantenimiento de ${unidad.plate}`}
      description="Queda en el historial de la unidad y de ahí sale cuándo toca el siguiente."
      submitLabel="Registrar"
      size="md"
      action={(fd) => registerMaintenance(unidad.id, fd)}
      trigger={(open) => (
        compact ? (
          <Button variant="ghost" size="sm" onClick={open} title={`Registrar ${MAINTENANCE_KIND_LABEL[kind ?? "OTRO"].toLowerCase()}`}>
            <Plus className="h-4 w-4" /><span className="sr-only">Registrar</span>
          </Button>
        ) : (
          <Button variant="primary" onClick={open}>
            <Wrench className="h-4 w-4" /> Registrar mantenimiento
          </Button>
        )
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Qué se le hizo" name="kind" required error={errors.kind}>
              <Select name="kind" value={tipo} onChange={(e) => setTipo(e.target.value as MaintenanceKind)}>
                {Object.entries(MAINTENANCE_KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Fecha" name="servicedAt" required error={errors.servicedAt}>
              <DateInput name="servicedAt" defaultValue={todayLima()} max={todayLima()} invalid={!!errors.servicedAt} />
            </Field>
          </div>

          <Field
            label="Kilometraje"
            name="odometerKm"
            error={errors.odometerKm}
            hint={unidad.odometerKm !== null
              ? `La unidad tiene ${km(unidad.odometerKm)} km anotados. Corrígelo si el tablero dice otra cosa.`
              : "El del tablero el día del servicio. Es lo que decide cuándo toca el siguiente."}
          >
            <Input
              name="odometerKm"
              type="number"
              min="0"
              step="1"
              defaultValue={unidad.odometerKm ?? ""}
              placeholder="185000"
              invalid={!!errors.odometerKm}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Costo" name="cost" error={errors.cost} hint="Opcional, en soles.">
              <Input name="cost" type="number" step="0.01" min="0" placeholder="350.00" invalid={!!errors.cost} />
            </Field>
            <Field label="Taller" name="workshop" error={errors.workshop}>
              <Input name="workshop" maxLength={120} placeholder="Taller San Martín" />
            </Field>
          </div>

          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" rows={2} maxLength={1000} placeholder="Se cambió también el filtro de aire." />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/** Anota la lectura del odómetro sin registrar ningún servicio. */
export function OdometerModal({ unidad }: { unidad: UnidadRef }) {
  return (
    <FormModal
      title={`Kilometraje de ${unidad.plate}`}
      description="Sirve para saber cuánto falta para el próximo mantenimiento por kilómetros."
      submitLabel="Guardar el kilometraje"
      size="sm"
      action={(fd) => setOdometer(unidad.id, fd)}
      trigger={(open) => (
        <Button variant="outline" onClick={open} title="Anotar el kilometraje">
          <Gauge className="h-4 w-4" /> Kilometraje
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <Field
            label="Kilómetros"
            name="odometerKm"
            required
            error={errors.odometerKm}
            hint={unidad.odometerKm !== null ? `Ahora figura con ${km(unidad.odometerKm)} km.` : "Todavía no tiene kilometraje anotado."}
          >
            <Input
              name="odometerKm"
              type="number"
              min="0"
              step="1"
              defaultValue={unidad.odometerKm ?? ""}
              invalid={!!errors.odometerKm}
              autoFocus
            />
          </Field>
          <Field
            label="Fecha de la lectura"
            name="odometerAt"
            required
            error={errors.odometerAt}
            hint="Un kilometraje sin fecha no sirve para calcular nada."
          >
            <DateInput name="odometerAt" defaultValue={todayLima()} max={todayLima()} invalid={!!errors.odometerAt} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/** Cambia cada cuánto le toca un mantenimiento a esta unidad. */
export function MaintenancePlanModal({ unidad, kind, everyKm, everyDays, propia }: {
  unidad: UnidadRef;
  kind: MaintenanceKind;
  everyKm: number | null;
  everyDays: number | null;
  /** Si ya tiene una regla propia o está usando la de por defecto. */
  propia: boolean;
}) {
  const porDefecto = MAINTENANCE_DEFAULTS[kind];
  return (
    <FormModal
      title={`${MAINTENANCE_KIND_LABEL[kind]} de ${unidad.plate}`}
      description={propia
        ? "Esta unidad tiene su propia periodicidad."
        : "Ahora usa la periodicidad corriente. Si la cambias, solo cambia para esta unidad."}
      submitLabel="Guardar la periodicidad"
      size="sm"
      action={(fd) => setMaintenancePlan(unidad.id, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} title="Cambiar cada cuánto toca">
          <Settings2 className="h-4 w-4" /><span className="sr-only">Periodicidad</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <input type="hidden" name="kind" value={kind} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Cada cuántos km"
              name="everyKm"
              error={errors.everyKm}
              hint={porDefecto.everyKm ? `Por defecto: ${km(porDefecto.everyKm)}` : "No aplica por defecto"}
            >
              <Input name="everyKm" type="number" min="1" step="1" defaultValue={everyKm ?? ""} invalid={!!errors.everyKm} />
            </Field>
            <Field
              label="Cada cuántos días"
              name="everyDays"
              error={errors.everyDays}
              hint={porDefecto.everyDays ? `Por defecto: ${porDefecto.everyDays}` : "No aplica por defecto"}
            >
              <Input name="everyDays" type="number" min="1" step="1" defaultValue={everyDays ?? ""} invalid={!!errors.everyDays} />
            </Field>
          </div>
          <p className="text-sm text-steel-500">
            Si pones los dos, manda el que llegue antes: un camión parado necesita su cambio de
            aceite aunque no haya rodado los kilómetros.
          </p>
          <label className="flex items-start gap-2 rounded-md border border-steel-200 px-3 py-2.5 text-sm">
            <input type="checkbox" name="active" value="true" defaultChecked className="mt-0.5 h-4 w-4" />
            <span>
              Controlarle este mantenimiento
              <span className="block text-xs text-steel-500">
                Desmárcalo si a esta unidad no se le hace: deja de aparecer en la lista.
              </span>
            </span>
          </label>
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" rows={2} maxLength={1000} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

export function DeleteMaintenanceButton({ id, etiqueta }: { id: string; etiqueta: string }) {
  return (
    <ConfirmButton
      action={() => deleteMaintenance(id)}
      title="Borrar el registro"
      message={`Se borrará ${etiqueta} del historial. El kilometraje de la unidad se mantiene.`}
      confirmLabel="Borrar"
      triggerVariant="ghost"
      triggerLabel={<><Trash2 className="h-4 w-4" /><span className="sr-only">Borrar</span></>}
      triggerTitle="Borrar"
    />
  );
}
