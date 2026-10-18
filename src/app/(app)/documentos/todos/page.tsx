import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocumentFormModal } from "@/components/documents/document-actions";
import { DocumentTable, LeyendaVencimientos } from "@/components/documents/document-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { TabLinks } from "@/components/ui/tab-links";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  DOCUMENT_KIND_LABEL, DOCUMENT_WARNING_DAYS, EMPLOYEE_DOCUMENT_KINDS, first,
  VEHICLE_DOCUMENT_KINDS, type SearchParams,
} from "@/lib/utils";
import {
  documentCounts, employeeOptions, listDocuments, readDocumentFilters, vehicleOptions,
} from "@/server/document-queries";

export const metadata: Metadata = { title: "Todos los documentos" };

/**
 * La lista plana de todos los documentos, de trabajadores y de vehículos.
 *
 * La pantalla principal está ordenada por unidad, que es como se trabaja a diario. Esta es
 * la otra pregunta: "¿dónde está tal papel?", sin importar de quién sea. Entra directo por
 * lo que está vencido o por vencer; con todo en orden, muestra todo.
 */
export default async function TodosLosDocumentosPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("documents.view");
  const sp = await searchParams;
  const canManage = can(user.role, "documents.manage");

  const filtros = readDocumentFilters(sp);
  const cuentas = await documentCounts();

  // Sin elegir pestaña se abre en lo que urge, si hay algo. Con todo en orden no tiene
  // sentido abrir en una lista vacía, así que ahí se muestra todo.
  const hayUrgente = cuentas.vencidos > 0 || cuentas.porVencer > 0;
  const porDefecto = !sp.estado && !filtros.q && hayUrgente
    ? (cuentas.vencidos > 0 ? "VENCIDO" : "POR_VENCER")
    : "";
  const estado = first(sp.estado) ?? porDefecto;
  const f = { ...filtros, estado: estado || undefined };

  const [rows, vehiculos, trabajadores] = await Promise.all([
    listDocuments(f),
    canManage ? vehicleOptions() : Promise.resolve([]),
    canManage ? employeeOptions() : Promise.resolve([]),
  ]);

  const tipos = { ...VEHICLE_DOCUMENT_KINDS, ...EMPLOYEE_DOCUMENT_KINDS };

  return (
    <>
      <Link href="/documentos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a la flota
      </Link>

      <PageHeader
        title="Todos los documentos"
        description="Los papeles de los trabajadores y de la flota, uno por fila, con su fecha de vencimiento."
        actions={
          <>
            {canManage && (
              <DocumentFormModal
                vehiculos={vehiculos.map((v) => ({ id: v.id, etiqueta: v.description ? `${v.plate} — ${v.description}` : v.plate }))}
                trabajadores={trabajadores.map((t) => ({ id: t.id, etiqueta: `${t.name} · ${t.dni}` }))}
              />
            )}
          </>
        }
      />

      {cuentas.vencidos > 0 && (
        <Link
          href="/documentos/todos?estado=VENCIDO"
          className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{cuentas.vencidos} documento(s)</strong> están vencidos. Una unidad con el SOAT o
            la revisión técnica vencida no debería estar circulando.
          </span>
        </Link>
      )}

      <TabLinks
        name="estado"
        current={estado}
        base="/documentos/todos"
        params={sp}
        className="mb-3"
        tabs={[
          { value: "VENCIDO", label: "Vencidos", count: cuentas.vencidos },
          { value: "POR_VENCER", label: `Vencen en ${DOCUMENT_WARNING_DAYS} días`, count: cuentas.porVencer },
          { value: "VIGENTE", label: "Vigentes", count: cuentas.vigentes },
          { value: "", label: "Todos", count: cuentas.total },
        ]}
      />

      <FilterBar
        searchPlaceholder="Buscar por placa, trabajador, DNI o nombre del archivo"
        filters={[
          { type: "select", name: "de", label: "De", allLabel: "Todos", options: [
            { value: "VEHICULO", label: "Vehículos" },
            { value: "TRABAJADOR", label: "Trabajadores" },
          ] },
          { type: "select", name: "tipo", label: "Tipo de documento", allLabel: "Todos",
            options: Object.entries(tipos).map(([value, label]) => ({ value, label })) },
        ]}
      />

      <LeyendaVencimientos />
      <DocumentTable rows={rows} canManage={canManage} mostrarDuenio />

      {rows.length === 0 && cuentas.total > 0 && (
        <p className="mt-3 text-sm text-steel-500">
          No hay documentos con esos filtros.{" "}
          <Link href="/documentos/todos?estado=" className="underline">Ver todos</Link>
        </p>
      )}
      {cuentas.sinFecha > 0 && (
        <p className="mt-3 text-sm text-steel-500">
          {cuentas.sinFecha} documento(s) no tienen fecha de vencimiento. Si alguno caduca,
          nadie se va a enterar: conviene completarla.{" "}
          <Link href="/documentos/todos?estado=SIN_FECHA" className="underline">Verlos</Link>
        </p>
      )}
      <p className="mt-3 text-xs text-steel-500">
        Tipos registrados: {Object.values(DOCUMENT_KIND_LABEL).slice(0, 4).join(", ")} y más.
      </p>
    </>
  );
}
