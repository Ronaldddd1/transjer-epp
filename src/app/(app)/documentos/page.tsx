import { AlertTriangle, FileText, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocumentFormModal, VehicleFormModal } from "@/components/documents/document-actions";
import { FleetTable, LeyendaFlota } from "@/components/documents/fleet-table";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { TabLinks } from "@/components/ui/tab-links";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { first, type SearchParams } from "@/lib/utils";
import {
  documentCounts, employeeOptions, fleetCounts, listFleet, vehicleOptions,
} from "@/server/document-queries";

export const metadata: Metadata = { title: "Documentos" };

/**
 * El archivo de documentos, ordenado por unidad.
 *
 * Una lista de papeles sueltos no responde la pregunta que se hace todos los días: ¿esta
 * unidad puede salir hoy? Por eso la pantalla es una fila por placa con el SOAT, la
 * revisión técnica, la habilitación MTC y la tarjeta de propiedad en columnas, el botón al
 * PDF al lado de cada fecha, y el conductor asignado con sus propios papeles.
 *
 * La lista plana sigue existiendo en /documentos/todos, para cuando lo que se busca es un
 * documento concreto y no una unidad.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("documents.view");
  const sp = await searchParams;
  const canManage = can(user.role, "documents.manage");

  const cuentas = await fleetCounts();

  // Se abre en lo que urge, si hay algo. Con la flota en orden, abrir en una lista vacía
  // no diría nada, así que ahí se muestra todo.
  // "Toda la flota" llega como estado="" y eso es una elección, no la ausencia de una:
  // solo cuando el parámetro no viene se aplica el filtro de entrada.
  const sinElegir = first(sp.estado) === undefined;
  const hayUrgente = cuentas.vencido > 0 || cuentas.falta > 0;
  const porDefecto = sinElegir && !first(sp.q) && hayUrgente
    ? (cuentas.vencido > 0 ? "VENCIDO" : "FALTA")
    : "";
  const estado = sinElegir ? porDefecto : first(sp.estado)!;
  const q = first(sp.q)?.trim() || undefined;

  const [rows, docs, vehiculos, trabajadores] = await Promise.all([
    listFleet({ q, estado: estado || undefined }),
    documentCounts(),
    canManage ? vehicleOptions() : Promise.resolve([]),
    canManage ? employeeOptions() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Documentos"
        description="La flota unidad por unidad, con sus papeles y su conductor."
        actions={
          <>
            <ExportTable
              tabla="flota"
              label="Descargar"
              enlaces={[{
                href: "/api/documentos/zip",
                label: "Documentos en ZIP",
                detalle: "todos los PDF, en carpetas por placa",
              }]}
            />
            <Link
              href="/documentos/todos"
              className="inline-flex items-center gap-2 rounded-md border border-steel-200 bg-white px-3.5 py-2 text-sm font-medium text-steel-600 hover:border-steel-400 hover:text-ink"
            >
              <FileText className="h-4 w-4" aria-hidden /> Todos los documentos
            </Link>
            <Link
              href="/documentos/todos?de=TRABAJADOR"
              className="inline-flex items-center gap-2 rounded-md border border-steel-200 bg-white px-3.5 py-2 text-sm font-medium text-steel-600 hover:border-steel-400 hover:text-ink"
            >
              <UserRound className="h-4 w-4" aria-hidden /> Trabajadores
            </Link>
            {canManage && <VehicleFormModal />}
            {canManage && (
              <DocumentFormModal
                vehiculos={vehiculos.map((v) => ({ id: v.id, etiqueta: v.description ? `${v.plate} — ${v.description}` : v.plate }))}
                trabajadores={trabajadores.map((t) => ({ id: t.id, etiqueta: `${t.name} · ${t.dni}` }))}
              />
            )}
          </>
        }
      />

      {cuentas.vencido > 0 && (
        <Link
          href="/documentos?estado=VENCIDO"
          className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{cuentas.vencido} unidad(es)</strong> tienen un papel vencido, suyo o de su
            conductor. Circular así es una multa y un seguro que no responde.
          </span>
        </Link>
      )}

      <TabLinks
        name="estado"
        current={estado}
        base="/documentos"
        params={sp}
        className="mb-3"
        tabs={[
          { value: "VENCIDO", label: "Con algo vencido", count: cuentas.vencido },
          { value: "FALTA", label: "Falta un papel", count: cuentas.falta },
          { value: "POR_VENCER", label: "Vencen en 30 días", count: cuentas.porVencer },
          { value: "AL_DIA", label: "Pueden salir", count: cuentas.alDia },
          { value: "", label: "Toda la flota", count: cuentas.total },
        ]}
      />

      <FilterBar searchPlaceholder="Buscar por placa, marca, modelo o conductor" filters={[]} />

      <LeyendaFlota />
      <FleetTable rows={rows} />

      {rows.length === 0 && cuentas.total > 0 && (
        <p className="mt-3 text-sm text-steel-500">
          Ninguna unidad en esa situación.{" "}
          <Link href="/documentos?estado=" className="underline">Ver toda la flota</Link>
        </p>
      )}

      <p className="mt-3 text-sm text-steel-500">
        {docs.total} documento(s) guardados en total
        {docs.sinFecha > 0 && (
          <>
            {", "}{docs.sinFecha} sin fecha de vencimiento: si alguno caduca, nadie se va a
            enterar.{" "}
            <Link href="/documentos/todos?estado=SIN_FECHA" className="underline">Verlos</Link>
          </>
        )}
        {docs.sinFecha === 0 && "."}
      </p>
    </>
  );
}
