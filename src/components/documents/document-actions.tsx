"use client";

import { Car, FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  createDocument, createVehicle, deleteDocument, toggleVehicle, updateDocument, updateVehicle,
} from "@/actions/documents";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import {
  DOCUMENT_KINDS_THAT_EXPIRE, EMPLOYEE_DOCUMENT_KINDS, VEHICLE_DOCUMENT_KINDS,
} from "@/lib/utils";

export type DocumentValues = {
  id: string;
  kind: string;
  title: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  filename: string | null;
};

type Opcion = { id: string; etiqueta: string };

/**
 * Alta de un documento.
 *
 * Cuando se abre desde la ficha de un vehículo o de un trabajador, el dueño ya viene dado
 * y no se pregunta. Desde la pantalla general hay que elegirlo.
 */
export function DocumentFormModal({ vehicleId, employeeId, vehiculos = [], trabajadores = [], etiqueta }: {
  vehicleId?: string;
  employeeId?: string;
  vehiculos?: Opcion[];
  trabajadores?: Opcion[];
  /** De quién es, cuando ya se sabe. Se muestra para que no haya dudas. */
  etiqueta?: string;
}) {
  const fijo = !!vehicleId || !!employeeId;
  const [de, setDe] = useState<"VEHICULO" | "TRABAJADOR">(
    vehicleId ? "VEHICULO" : employeeId ? "TRABAJADOR" : "VEHICULO",
  );
  const [tipo, setTipo] = useState(() => (de === "VEHICULO" ? "SOAT" : "LICENCIA"));

  const tipos = de === "VEHICULO" ? VEHICLE_DOCUMENT_KINDS : EMPLOYEE_DOCUMENT_KINDS;
  const caduca = DOCUMENT_KINDS_THAT_EXPIRE.has(tipo);

  const cambiarDe = (valor: "VEHICULO" | "TRABAJADOR") => {
    setDe(valor);
    // El tipo tiene que seguir existiendo en la lista nueva: un SOAT no es un documento
    // de trabajador y quedaría elegido algo imposible.
    setTipo(valor === "VEHICULO" ? "SOAT" : "LICENCIA");
  };

  return (
    <FormModal
      title="Subir documento"
      description={etiqueta ? `Se guardará en ${etiqueta}.` : "Guarda el PDF o la foto del documento, con su fecha de vencimiento."}
      submitLabel="Guardar documento"
      size="lg"
      action={createDocument}
      trigger={(open) => (
        <Button onClick={open}><FileUp className="h-4 w-4" /> Subir documento</Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          {fijo ? (
            <>
              {vehicleId && <input type="hidden" name="vehicleId" value={vehicleId} />}
              {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="¿De quién es?" name="de">
                <Select value={de} onChange={(e) => cambiarDe(e.target.value as "VEHICULO" | "TRABAJADOR")}>
                  <option value="VEHICULO">De un vehículo</option>
                  <option value="TRABAJADOR">De un trabajador</option>
                </Select>
              </Field>
              {de === "VEHICULO" ? (
                <Field label="Vehículo" name="vehicleId" required error={errors.vehicleId}>
                  <Select name="vehicleId" defaultValue="">
                    <option value="" disabled>Elige la placa…</option>
                    {vehiculos.map((v) => <option key={v.id} value={v.id}>{v.etiqueta}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="Trabajador" name="employeeId" required error={errors.employeeId}>
                  <Select name="employeeId" defaultValue="">
                    <option value="" disabled>Elige el trabajador…</option>
                    {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.etiqueta}</option>)}
                  </Select>
                </Field>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Qué documento es" name="kind" required error={errors.kind}>
              <Select name="kind" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(tipos).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Nombre" name="title" error={errors.title} hint="Opcional, por si hay dos del mismo tipo.">
              <Input name="title" maxLength={160} placeholder="SOAT 2026" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de emisión" name="issuedAt" error={errors.issuedAt}>
              <DateInput name="issuedAt" invalid={!!errors.issuedAt} />
            </Field>
            <Field
              label="Vence el"
              name="expiresAt"
              error={errors.expiresAt}
              hint={caduca ? "Sin esta fecha nadie se va a enterar cuando caduque." : "Déjala vacía si no caduca."}
            >
              <DateInput name="expiresAt" invalid={!!errors.expiresAt} />
            </Field>
          </div>

          <Field
            label="Archivo"
            name="archivo"
            required
            hint="PDF o foto del documento. Lo que sale del escáner o de la cámara del celular."
          >
            <input
              type="file"
              name="archivo"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              className="block w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </Field>

          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/**
 * Corrige los datos de un documento, y adjunta el archivo si todavía no lo tiene.
 *
 * Los documentos que vienen del Excel de mantenimiento traen solo la fecha. El PDF llega
 * después, y tiene que poder entrar en el mismo documento: dos SOAT para la misma unidad,
 * uno con la fecha y otro con el papel, es la receta para no saber cuál es el bueno.
 */
export function EditDocumentModal({ documento, esVehiculo }: {
  documento: DocumentValues;
  esVehiculo: boolean;
}) {
  const [tipo, setTipo] = useState(documento.kind);
  const tipos = esVehiculo ? VEHICLE_DOCUMENT_KINDS : EMPLOYEE_DOCUMENT_KINDS;
  const caduca = DOCUMENT_KINDS_THAT_EXPIRE.has(tipo);

  return (
    <FormModal
      title="Corregir datos del documento"
      description={documento.filename ?? "Sin archivo cargado"}
      submitLabel="Guardar cambios"
      size="md"
      action={(fd) => updateDocument(documento.id, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} title="Corregir los datos">
          <Pencil className="h-4 w-4" /><span className="sr-only">Editar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <Field label="Qué documento es" name="kind" required error={errors.kind}>
            <Select name="kind" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(tipos).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {!(tipo in tipos) && <option value={tipo}>{tipo}</option>}
            </Select>
          </Field>
          <Field label="Nombre" name="title" error={errors.title}>
            <Input name="title" defaultValue={documento.title ?? ""} maxLength={160} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha de emisión" name="issuedAt" error={errors.issuedAt}>
              <DateInput name="issuedAt" defaultValue={documento.issuedAt ?? ""} invalid={!!errors.issuedAt} />
            </Field>
            <Field
              label="Vence el"
              name="expiresAt"
              error={errors.expiresAt}
              hint={caduca ? "Sin fecha nadie se entera cuando caduque." : undefined}
            >
              <DateInput name="expiresAt" defaultValue={documento.expiresAt ?? ""} invalid={!!errors.expiresAt} />
            </Field>
          </div>
          <Field
            label={documento.filename ? "Reemplazar el archivo" : "Adjuntar el archivo"}
            name="archivo"
            hint={documento.filename
              ? `Ahora tiene "${documento.filename}". Si subes otro, ese queda en su lugar. Déjalo vacío para no tocarlo.`
              : "Este documento solo tiene la fecha. Sube el PDF o la foto cuando lo tengas a mano."}
          >
            <input
              type="file"
              name="archivo"
              accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
              className="block w-full rounded-md border border-steel-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
            />
          </Field>

          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" defaultValue={documento.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

export function DeleteDocumentButton({ id, filename }: { id: string; filename: string | null }) {
  return (
    <ConfirmButton
      title="Eliminar el documento"
      message={filename
        ? `Se borrará "${filename}" y su archivo. Esto no se puede deshacer.`
        : "Se borrará el registro del documento. Esto no se puede deshacer."}
      confirmLabel="Eliminar"
      triggerVariant="ghost"
      triggerLabel={<><Trash2 className="h-4 w-4" /><span className="sr-only">Eliminar</span></>}
      triggerTitle="Eliminar"
      action={() => deleteDocument(id)}
    />
  );
}

// ---------- Vehículos ----------

export type VehicleValues = {
  id: string;
  plate: string;
  description: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  capacityTn: string | null;
  capacityM3: string | null;
  mtcCode: string | null;
  hasGps: boolean;
  driverId: string | null;
  notes: string | null;
};

export function VehicleFormModal({ vehiculo, conductores = [] }: {
  vehiculo?: VehicleValues;
  /** Los trabajadores que pueden manejar. Vacío si quien mira no los puede consultar. */
  conductores?: { id: string; etiqueta: string }[];
}) {
  const editando = !!vehiculo;
  return (
    <FormModal
      title={editando ? `Editar ${vehiculo.plate}` : "Nuevo vehículo"}
      description="La placa identifica la unidad. Se guarda siempre en mayúsculas y con guion."
      submitLabel={editando ? "Guardar cambios" : "Registrar vehículo"}
      size="md"
      action={(fd) => (editando ? updateVehicle(vehiculo.id, fd) : createVehicle(fd))}
      trigger={(open) =>
        editando ? (
          <Button variant="outline" size="sm" onClick={open} title="Editar la unidad">
            <Pencil className="h-4 w-4" /> Editar la unidad
          </Button>
        ) : (
          <Button variant="outline" onClick={open}><Plus className="h-4 w-4" /> Nuevo vehículo</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <Field label="Placa" name="plate" required error={errors.plate} hint="Por ejemplo BJA-838. Da igual cómo la escribas.">
            <Input name="plate" defaultValue={vehiculo?.plate ?? ""} maxLength={10} placeholder="BJA-838" invalid={!!errors.plate} autoCapitalize="characters" />
          </Field>
          <Field label="Descripción" name="description" error={errors.description} hint="Como la llamen en operaciones: tracto, furgón, la camioneta chica.">
            <Input name="description" defaultValue={vehiculo?.description ?? ""} maxLength={160} placeholder="Tracto" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Marca" name="brand" error={errors.brand}>
              <Input name="brand" defaultValue={vehiculo?.brand ?? ""} maxLength={60} placeholder="Volvo" />
            </Field>
            <Field label="Modelo" name="model" error={errors.model}>
              <Input name="model" defaultValue={vehiculo?.model ?? ""} maxLength={60} placeholder="FH 440" />
            </Field>
            <Field label="Año" name="year" error={errors.year}>
              <Input name="year" type="number" min={1970} max={2100} defaultValue={vehiculo?.year ?? ""} placeholder="2018" invalid={!!errors.year} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Capacidad (TN)" name="capacityTn" error={errors.capacityTn} hint="Toneladas de carga útil.">
              <Input name="capacityTn" type="number" step="0.01" min="0" defaultValue={vehiculo?.capacityTn ?? ""} placeholder="30" invalid={!!errors.capacityTn} />
            </Field>
            <Field label="Capacidad (m³)" name="capacityM3" error={errors.capacityM3}>
              <Input name="capacityM3" type="number" step="0.01" min="0" defaultValue={vehiculo?.capacityM3 ?? ""} placeholder="85" invalid={!!errors.capacityM3} />
            </Field>
          </div>
          <Field
            label="Código MTC"
            name="mtcCode"
            error={errors.mtcCode}
            hint="El de la constancia de habilitación vehicular. El PDF se sube aparte, como documento."
          >
            <Input name="mtcCode" defaultValue={vehiculo?.mtcCode ?? ""} maxLength={40} placeholder="0123456-2024" />
          </Field>
          <Field
            label="Conductor asignado"
            name="driverId"
            error={errors.driverId}
            hint="Se puede dejar en blanco. Asignándolo, su DNI y su licencia salen junto a la unidad."
          >
            <Select name="driverId" defaultValue={vehiculo?.driverId ?? ""}>
              <option value="">Sin asignar</option>
              {conductores.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-steel-600">
            <input
              type="checkbox"
              name="hasGps"
              defaultChecked={vehiculo?.hasGps ?? false}
              className="h-4 w-4 rounded border-steel-300 text-brand focus:ring-brand"
            />
            Tiene GPS instalado
          </label>
          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" defaultValue={vehiculo?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/**
 * Da de baja un vehículo sin borrarlo.
 *
 * Nunca se elimina: sus documentos son el respaldo de lo que circuló, y una unidad
 * vendida sigue necesitando que se pueda mostrar su SOAT de cuando estaba en la flota.
 */
export function ToggleVehicleButton({ id, plate, active }: { id: string; plate: string; active: boolean }) {
  return (
    <ConfirmButton
      title={active ? `Dar de baja ${plate}` : `Reactivar ${plate}`}
      message={active
        ? "Deja de aparecer al subir documentos nuevos. Los que ya tiene se conservan y se siguen pudiendo consultar."
        : "Vuelve a aparecer en la lista para subirle documentos."}
      confirmLabel={active ? "Dar de baja" : "Reactivar"}
      confirmVariant={active ? "danger" : "primary"}
      triggerVariant="ghost"
      triggerLabel={<><Car className="h-4 w-4" /> {active ? "Dar de baja" : "Reactivar"}</>}
      triggerTitle={active ? "Dar de baja" : "Reactivar"}
      action={() => toggleVehicle(id)}
    />
  );
}
