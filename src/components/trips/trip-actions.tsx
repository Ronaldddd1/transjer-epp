"use client";

import { CheckCircle2, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { createTrip, deleteTrip, settleTrip, unsettleTrip, updateTrip } from "@/actions/trips";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { esAlicorp, formatDate, todayLima, TRIP_DOC_LABEL } from "@/lib/utils";

export type TripOptions = {
  vehiculos: { id: string; plate: string; driverId: string | null }[];
  conductores: { id: string; nombre: string; position: string }[];
  clientes: string[];
};

type TripData = {
  id: string; day: string; vehicleId: string; driverId: string | null; client: string;
  destination: string | null; docType: string; docNumber: string; notes: string | null;
};

/**
 * Los campos de una salida. Va aparte para poder llevar estado: el conductor se propone
 * al elegir la unidad, y si el cliente es Alicorp el documento pasa a ser un FO sin
 * preguntar, que es como trabaja Alicorp.
 */
function CamposSalida({ opciones, salida, dia, errors }: {
  opciones: TripOptions; salida?: TripData; dia: string; errors: Record<string, string>;
}) {
  const [vehiculo, setVehiculo] = useState(salida?.vehicleId ?? "");
  const [conductor, setConductor] = useState(salida?.driverId ?? "");
  const [cliente, setCliente] = useState(salida?.client ?? "");
  const [tipo, setTipo] = useState(salida?.docType && salida.docType !== "FO" ? salida.docType : "GUIA");
  const alicorp = esAlicorp(cliente);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Fecha de la salida" name="day" required error={errors.day}>
        <DateInput name="day" defaultValue={salida?.day ?? dia} max={todayLima()} invalid={!!errors.day} />
      </Field>
      <Field label="Unidad" name="vehicleId" required error={errors.vehicleId}>
        <Select
          name="vehicleId"
          value={vehiculo}
          onChange={(e) => {
            setVehiculo(e.target.value);
            // Se propone su conductor habitual, solo si todavía no se eligió otro.
            const habitual = opciones.vehiculos.find((v) => v.id === e.target.value)?.driverId;
            if (habitual && !conductor) setConductor(habitual);
          }}
          invalid={!!errors.vehicleId}
        >
          <option value="" disabled>Elige la placa…</option>
          {opciones.vehiculos.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
        </Select>
      </Field>
      <Field label="Conductor" name="driverId" error={errors.driverId}>
        <Select name="driverId" value={conductor} onChange={(e) => setConductor(e.target.value)}>
          <option value="">Sin indicar</option>
          {opciones.conductores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </Select>
      </Field>
      <Field label="Cliente" name="client" required error={errors.client}>
        <Input
          name="client"
          list="clientes-salida"
          value={cliente}
          onChange={(e) => setCliente(e.target.value)}
          maxLength={120}
          autoComplete="off"
          placeholder="Alicorp, Vainsa…"
          invalid={!!errors.client}
        />
        <datalist id="clientes-salida">{opciones.clientes.map((c) => <option key={c} value={c} />)}</datalist>
      </Field>
      <Field label="Destino" name="destination" error={errors.destination}>
        <Input name="destination" defaultValue={salida?.destination ?? ""} maxLength={160} placeholder="Lurín, Huacho, Jaén…" />
      </Field>
      {alicorp ? (
        <Field label="N° de FO" name="docNumber" required error={errors.docNumber} hint="Alicorp trabaja con FO.">
          <input type="hidden" name="docType" value="FO" />
          <Input name="docNumber" defaultValue={salida?.docNumber ?? ""} maxLength={40} className="uppercase" invalid={!!errors.docNumber} />
        </Field>
      ) : (
        <>
          <Field label="Tipo de documento" name="docType" required error={errors.docType}>
            <Select name="docType" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="GUIA">{TRIP_DOC_LABEL.GUIA}</option>
              <option value="OS">{TRIP_DOC_LABEL.OS}</option>
              <option value="FO">{TRIP_DOC_LABEL.FO}</option>
              <option value="OTRO">{TRIP_DOC_LABEL.OTRO}</option>
            </Select>
          </Field>
          <Field label="N° de documento" name="docNumber" required error={errors.docNumber}>
            <Input name="docNumber" defaultValue={salida?.docNumber ?? ""} maxLength={40} className="uppercase" invalid={!!errors.docNumber} />
          </Field>
        </>
      )}
      <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
        <Textarea name="notes" defaultValue={salida?.notes ?? ""} rows={2} maxLength={500} />
      </Field>
    </div>
  );
}

export function TripFormModal({ opciones, dia, salida }: { opciones: TripOptions; dia: string; salida?: TripData }) {
  const editando = !!salida;
  return (
    <FormModal
      title={editando ? `Corregir la salida de ${opciones.vehiculos.find((v) => v.id === salida.vehicleId)?.plate ?? "la unidad"}` : "Registrar salida"}
      description={editando ? undefined : "Qué unidad salió, para qué cliente y con qué documento."}
      submitLabel={editando ? "Guardar cambios" : "Registrar salida"}
      size="lg"
      action={(fd) => (editando ? updateTrip(salida.id, fd) : createTrip(fd))}
      trigger={(open) => editando ? (
        <Button variant="ghost" size="sm" onClick={open} title="Corregir la salida" aria-label="Corregir la salida">
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button onClick={open}><Plus className="h-4 w-4" /> Registrar salida</Button>
      )}
    >
      {({ errors }) => <CamposSalida opciones={opciones} salida={salida} dia={dia} errors={errors} />}
    </FormModal>
  );
}

export function SettleTripButton({ id, documento, dia }: { id: string; documento: string; dia: string }) {
  return (
    <FormModal
      title={`Liquidar ${documento}`}
      description="Marca el documento como liquidado con el cliente."
      submitLabel="Marcar liquidado"
      size="sm"
      action={(fd) => settleTrip(id, fd)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open} title={`Liquidar ${documento}`}>
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Liquidar
        </Button>
      )}
    >
      {({ errors }) => (
        <Field label="Fecha de liquidación" name="settledAt" required error={errors.settledAt} hint={`La salida fue el ${formatDate(dia)}.`}>
          <DateInput name="settledAt" defaultValue={todayLima()} max={todayLima()} />
        </Field>
      )}
    </FormModal>
  );
}

export function UnsettleTripButton({ id, documento }: { id: string; documento: string }) {
  return (
    <ConfirmButton
      action={() => unsettleTrip(id)}
      title={`Deshacer la liquidación de ${documento}`}
      message="Vuelve a quedar pendiente. Úsalo solo si se marcó liquidado por error; queda registrado en auditoría."
      confirmLabel="Deshacer"
      confirmVariant="primary"
      triggerTitle="Deshacer la liquidación"
      triggerLabel={<Undo2 className="h-4 w-4 text-steel-500" />}
    />
  );
}

export function DeleteTripButton({ id, documento }: { id: string; documento: string }) {
  return (
    <ConfirmButton
      action={() => deleteTrip(id)}
      title="Eliminar salida"
      message={`Se borra la salida con ${documento}. Hazlo solo si se registró por error.`}
      confirmLabel="Eliminar"
      triggerTitle="Eliminar la salida"
      triggerLabel={<Trash2 className="h-4 w-4 text-red-600" />}
    />
  );
}
