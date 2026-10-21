import { ArrowLeft, Car, FileArchive, IdCard, MapPin, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DocumentFormModal, ToggleVehicleButton, VehicleFormModal,
} from "@/components/documents/document-actions";
import { DocumentTable, LeyendaVencimientos } from "@/components/documents/document-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  anioPrimeraRevision, DOCUMENT_KIND_LABEL, documentStatus, exigeRevisionTecnica, formatDate,
  formatMoney, MAINTENANCE_KIND_LABEL, type MaintenanceKind,
} from "@/lib/utils";
import {
  DeleteMaintenanceButton, MaintenanceModal, OdometerModal,
} from "@/components/maintenance/maintenance-actions";
import { listMaintenanceFor, maintenanceForVehicle } from "@/server/maintenance-queries";
import {
  employeeOptions, getVehicle, listDocumentsFor, listFleet,
} from "@/server/document-queries";
import { getEmployee } from "@/server/queries";

export const metadata: Metadata = { title: "Vehículo" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un dato de la ficha. En blanco se muestra como raya, no se esconde: así se ve qué falta. */
function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-steel-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{children || "—"}</dd>
    </div>
  );
}

/**
 * La ficha de una unidad: sus datos, sus papeles y el conductor que la maneja.
 *
 * El conductor aparece aquí con su DNI y su licencia porque es la misma pregunta: para que
 * la unidad salga hacen falta los papeles del camión Y los del que lo maneja. Tenerlos en
 * dos pantallas distintas obliga a recordar que hay que mirar las dos.
 */
export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("documents.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const vehiculo = await getVehicle(id);
  if (!vehiculo) notFound();

  const canManage = can(user.role, "documents.manage");
  const canMaintain = can(user.role, "maintenance.view");
  const [documentos, conductores, mantenimientos, historial] = await Promise.all([
    listDocumentsFor({ vehicleId: id }),
    canManage ? employeeOptions() : Promise.resolve([]),
    canMaintain ? maintenanceForVehicle(id) : Promise.resolve([]),
    canMaintain ? listMaintenanceFor(id, 12) : Promise.resolve([]),
  ]);

  // La misma consulta de la tabla de flota, acotada a esta unidad: así la ficha y el
  // listado no pueden decir cosas distintas del mismo SOAT.
  const [resumen] = await listFleet({ id: vehiculo.id });

  const chofer = vehiculo.driverId ? await getEmployee(vehiculo.driverId) : null;
  const papelesChofer = chofer ? await listDocumentsFor({ employeeId: chofer.id }) : [];
  const deConducir = papelesChofer.filter((d) => d.kind === "DNI" || d.kind === "LICENCIA");

  // A una unidad de menos de tres años todavía no se le exige la revisión técnica.
  const unidadRef = {
    id: vehiculo.id, plate: vehiculo.plate,
    odometerKm: vehiculo.odometerKm, odometerAt: vehiculo.odometerAt,
  };

  const sinRevisionAun = !exigeRevisionTecnica(vehiculo.year) && !resumen?.revisionTecnica;

  const vencidos = documentos.filter((d) => documentStatus(d.expiresAt) === "VENCIDO");
  const porVencer = documentos.filter((d) => documentStatus(d.expiresAt) === "POR_VENCER");
  const choferVencidos = deConducir.filter((d) => documentStatus(d.expiresAt) === "VENCIDO");

  return (
    <>
      <Link href="/documentos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a la flota
      </Link>

      <PageHeader
        title={vehiculo.plate}
        description={[vehiculo.brand, vehiculo.model, vehiculo.year].filter(Boolean).join(" ")
          || vehiculo.description || "Sin descripción"}
        actions={
          <>
            <a
              href={`/api/documentos/zip?vehiculo=${vehiculo.id}`}
              download
              className="inline-flex h-10 items-center gap-2 rounded-md border border-steel-300 bg-white px-4 text-[15px] text-ink transition-colors hover:border-ink"
            >
              <FileArchive className="h-4 w-4 text-steel-500" aria-hidden />
              Bajar sus documentos
            </a>
            {canManage && (
              <DocumentFormModal
                vehicleId={vehiculo.id}
                etiqueta={`el vehículo ${vehiculo.plate}`}
              />
            )}
            {canManage && (
              <VehicleFormModal
                vehiculo={{
                  id: vehiculo.id, plate: vehiculo.plate, description: vehiculo.description,
                  brand: vehiculo.brand, model: vehiculo.model, year: vehiculo.year,
                  capacityTn: vehiculo.capacityTn, capacityM3: vehiculo.capacityM3,
                  mtcCode: vehiculo.mtcCode, hasGps: vehiculo.hasGps,
                  driverId: vehiculo.driverId, notes: vehiculo.notes,
                }}
                conductores={conductores.map((c) => ({ id: c.id, etiqueta: `${c.name} · ${c.dni}` }))}
              />
            )}
            {canManage && (
              <ToggleVehicleButton id={vehiculo.id} plate={vehiculo.plate} active={vehiculo.active} />
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Car className="h-5 w-5 text-steel-400" aria-hidden />
        {!vehiculo.active && <Badge tone="neutral">De baja</Badge>}
        {vencidos.length > 0 && <Badge tone="red">{vencidos.length} documento(s) vencido(s)</Badge>}
        {choferVencidos.length > 0 && <Badge tone="red">El conductor tiene {choferVencidos.length} papel(es) vencido(s)</Badge>}
        {vencidos.length === 0 && porVencer.length > 0 && <Badge tone="yellow">{porVencer.length} por vencer</Badge>}
        {vencidos.length === 0 && choferVencidos.length === 0 && porVencer.length === 0 && documentos.length > 0 && <Badge tone="green">Al día</Badge>}
        <span className="text-sm text-steel-500">{documentos.length} documento(s)</span>
      </div>

      {vencidos.length > 0 && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Esta unidad tiene {vencidos.length} documento(s) vencido(s):{" "}
          {vencidos.map((d) => `${d.title ?? DOCUMENT_KIND_LABEL[d.kind] ?? d.kind} (venció el ${formatDate(d.expiresAt)})`).join(", ")}.
        </p>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Datos de la unidad">
          <dl className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-3">
            <Dato label="Placa">{vehiculo.plate}</Dato>
            <Dato label="Marca">{vehiculo.brand}</Dato>
            <Dato label="Modelo">{vehiculo.model}</Dato>
            <Dato label="Año">{vehiculo.year}</Dato>
            <Dato label="Capacidad">{vehiculo.capacityTn ? `${Number(vehiculo.capacityTn)} TN` : null}</Dato>
            <Dato label="Volumen">{vehiculo.capacityM3 ? `${Number(vehiculo.capacityM3)} m³` : null}</Dato>
            <Dato label="Código MTC">{vehiculo.mtcCode}</Dato>
            <Dato label="GPS">
              {vehiculo.hasGps
                ? <span className="inline-flex items-center gap-1 text-emerald-700"><MapPin className="h-3.5 w-3.5" aria-hidden /> Instalado</span>
                : <span className="text-steel-500">Sin GPS</span>}
            </Dato>
            <Dato label="Descripción">{vehiculo.description}</Dato>
          </dl>
        </Panel>

        <Panel
          title="Conductor asignado"
          action={chofer ? <Link href={`/trabajadores/${chofer.id}`} className="text-sm text-steel-500 hover:text-ink hover:underline">Ver ficha</Link> : undefined}
        >
          {chofer ? (
            <div className="px-4 py-3">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <UserRound className="h-4 w-4 text-steel-400" aria-hidden />
                {chofer.firstName} {chofer.lastName}
              </p>
              <p className="mt-0.5 text-sm text-steel-500">
                DNI {chofer.dni}{chofer.position ? ` · ${chofer.position}` : ""}
              </p>

              {deConducir.length === 0 ? (
                <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  No tiene cargados ni el DNI ni la licencia de conducir. Sin licencia vigente no
                  debería manejar esta unidad.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-steel-100">
                  {deConducir.map((d) => {
                    const estado = documentStatus(d.expiresAt);
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="flex items-center gap-2">
                          <IdCard className="h-4 w-4 shrink-0 text-steel-400" aria-hidden />
                          <span>
                            <span className="font-medium">{DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}</span>
                            <span className={estado === "VENCIDO" ? "block text-xs font-semibold text-red-700"
                              : estado === "POR_VENCER" ? "block text-xs font-semibold text-[#7A5A00]"
                                : "block text-xs text-steel-500"}>
                              {d.expiresAt ? `vence el ${formatDate(d.expiresAt)}` : "sin fecha de vencimiento"}
                            </span>
                          </span>
                        </span>
                        {d.filename ? (
                          <Link
                            href={`/api/documentos/${d.id}`}
                            target="_blank"
                            className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-steel-600 hover:bg-steel-100 hover:text-ink"
                          >
                            Ver PDF
                          </Link>
                        ) : (
                          <span className="shrink-0 text-xs text-amber-700">falta el archivo</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <p className="px-4 py-3 text-sm text-steel-500">
              Esta unidad no tiene conductor asignado.
              {canManage && " Asígnalo con el botón Editar, y sus papeles saldrán aquí."}
            </p>
          )}
        </Panel>
      </div>

      {resumen && (
        <Panel title="Los papeles que no pueden faltar" className="mb-4">
          <TableShell>
            <thead>
              <tr>
                <Th>Documento</Th>
                <Th>Vence</Th>
                <Th className="text-right">Archivo</Th>
              </tr>
            </thead>
            <tbody>
              {([
                ["SOAT", resumen.soat, null],
                ["Revisión técnica", resumen.revisionTecnica, sinRevisionAun ? anioPrimeraRevision(vehiculo.year) : null],
                ["Habilitación MTC", resumen.mtc, null],
                ["Tarjeta de propiedad", resumen.tarjetaPropiedad, null],
              ] as const).map(([nombre, papel, noLeTocaHasta]) => {
                const estado = documentStatus(papel?.expiresAt ?? null);
                return (
                  <Tr
                    key={nombre}
                    tone={(!papel && !noLeTocaHasta) || estado === "VENCIDO" ? "bg-red-50 hover:bg-red-100/70"
                      : estado === "POR_VENCER" ? "bg-brand-soft hover:bg-[#FFEBA8]" : ""}
                  >
                    <Td className="font-medium">{nombre}</Td>
                    <Td className="tabular">
                      {!papel
                        ? noLeTocaHasta
                          ? <span className="text-steel-500">No le toca hasta {noLeTocaHasta}</span>
                          : <span className="font-semibold text-red-700">Falta cargarlo</span>
                        : papel.expiresAt
                          ? <span className={estado === "VENCIDO" ? "font-semibold text-red-700" : estado === "POR_VENCER" ? "font-semibold text-[#7A5A00]" : ""}>{formatDate(papel.expiresAt)}</span>
                          : <span className="text-steel-500">Sin fecha</span>}
                    </Td>
                    <Td className="text-right">
                      {papel?.tieneArchivo ? (
                        <Link
                          href={`/api/documentos/${papel.id}`}
                          target="_blank"
                          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-steel-600 hover:bg-steel-100 hover:text-ink"
                        >
                          Ver PDF
                        </Link>
                      ) : (
                        <span className="text-xs text-amber-700">sin archivo</span>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </TableShell>
        </Panel>
      )}

      {canMaintain && (
        <Panel
          title="Mantenimiento"
          className="mb-4"
          action={
            <div className="flex items-center gap-2">
              <Link href="/mantenimiento" className="text-sm text-steel-500 hover:text-ink hover:underline">
                Ver toda la flota
              </Link>
              {can(user.role, "maintenance.manage") && <OdometerModal unidad={unidadRef} />}
              {can(user.role, "maintenance.manage") && <MaintenanceModal unidad={unidadRef} />}
            </div>
          }
        >
          <div className="border-t border-steel-100 px-4 py-3 text-sm text-steel-600">
            {vehiculo.odometerKm !== null ? (
              <>
                <strong className="text-ink">{vehiculo.odometerKm.toLocaleString("es-PE")} km</strong>
                {vehiculo.odometerAt && <> · leídos el {formatDate(vehiculo.odometerAt)}</>}
              </>
            ) : (
              <>Sin kilometraje anotado: hasta que se anote, lo que se mide por kilómetros no se puede calcular.</>
            )}
          </div>

          <TableShell>
            <thead>
              <tr>
                <Th>Mantenimiento</Th>
                <Th>Última vez</Th>
                <Th>Toca</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {mantenimientos.map((m) => (
                <Tr
                  key={m.kind}
                  tone={m.estado === "VENCIDO" ? "bg-red-50 hover:bg-red-100/70"
                    : m.estado === "POR_VENCER" ? "bg-brand-soft hover:bg-[#FFEBA8]" : ""}
                >
                  <Td className="font-medium">{MAINTENANCE_KIND_LABEL[m.kind]}</Td>
                  <Td className="whitespace-nowrap text-sm">
                    {m.ultimaFecha ? formatDate(m.ultimaFecha) : <span className="text-steel-400">Nunca</span>}
                    {m.ultimoKm !== null && <p className="text-xs text-steel-500">{m.ultimoKm.toLocaleString("es-PE")} km</p>}
                  </Td>
                  <Td className="whitespace-nowrap text-sm">
                    {m.proximaFecha ? formatDate(m.proximaFecha) : "—"}
                    {m.proximoKm !== null && <p className="text-xs text-steel-500">{m.proximoKm.toLocaleString("es-PE")} km</p>}
                  </Td>
                  <Td>
                    {m.estado === "VENCIDO" && <Badge tone="red">Vencido</Badge>}
                    {m.estado === "POR_VENCER" && <Badge tone="yellow">Toca pronto</Badge>}
                    {m.estado === "AL_DIA" && <Badge tone="green">Al día</Badge>}
                    {m.estado === "SIN_REGISTRO" && <Badge tone="neutral">Nunca se hizo</Badge>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>

          {historial.length > 0 && (
            <div className="border-t border-steel-100 px-4 py-3">
              <h3 className="mb-2 text-sm font-semibold text-ink">Lo último que se le hizo</h3>
              <ul className="divide-y divide-steel-100">
                {historial.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{MAINTENANCE_KIND_LABEL[h.kind as MaintenanceKind] ?? h.kind}</span>
                      <span className="block text-xs text-steel-500">
                        {formatDate(h.servicedAt)}
                        {h.odometerKm !== null && ` · ${h.odometerKm.toLocaleString("es-PE")} km`}
                        {h.workshop && ` · ${h.workshop}`}
                        {h.cost && ` · ${formatMoney(h.cost, h.currency)}`}
                      </span>
                    </span>
                    {can(user.role, "maintenance.manage") && (
                      <DeleteMaintenanceButton
                        id={h.id}
                        etiqueta={`${MAINTENANCE_KIND_LABEL[h.kind as MaintenanceKind] ?? h.kind} del ${formatDate(h.servicedAt)}`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <h2 className="mb-2 font-display text-lg font-semibold text-ink">Todos los documentos de la unidad</h2>
      <LeyendaVencimientos />
      <DocumentTable rows={documentos} canManage={canManage} />

      {vehiculo.notes && (
        <Panel title="Observaciones" className="mt-4">
          <p className="px-4 py-3 text-sm text-steel-600">{vehiculo.notes}</p>
        </Panel>
      )}
    </>
  );
}
