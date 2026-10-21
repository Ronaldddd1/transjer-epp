import { AlertTriangle, Car, Gauge, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { MaintenanceModal, MaintenancePlanModal } from "@/components/maintenance/maintenance-actions";
import { Badge } from "@/components/ui/badge";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { TabLinks } from "@/components/ui/tab-links";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, first, formatDate, MAINTENANCE_KIND_LABEL, type MaintenanceStatus, type SearchParams,
} from "@/lib/utils";
import {
  listMaintenance, maintenanceCounts, readMaintenanceFilters,
} from "@/server/maintenance-queries";

export const metadata: Metadata = { title: "Mantenimiento" };

const TONO: Record<MaintenanceStatus, string> = {
  VENCIDO: "bg-red-100/70 hover:bg-red-100",
  POR_VENCER: "bg-brand-soft hover:bg-[#FFEBA8]",
  SIN_REGISTRO: "",
  AL_DIA: "",
};

const km = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("es-PE")} km`);

/** Cuánto falta, dicho como lo diría una persona. */
function Falta({ dias, kms }: { dias: number | null; kms: number | null }) {
  const partes: string[] = [];
  if (dias !== null) partes.push(dias < 0 ? `${Math.abs(dias)} día(s) pasado` : `en ${dias} día(s)`);
  if (kms !== null) partes.push(kms < 0 ? `${Math.abs(kms).toLocaleString("es-PE")} km pasado` : `en ${kms.toLocaleString("es-PE")} km`);
  if (partes.length === 0) return <p className="text-xs text-steel-400">—</p>;

  const urgente = (dias !== null && dias < 0) || (kms !== null && kms < 0);
  // En bloque, no en línea: pegado a la fecha de arriba se leía "14/10/20267 día(s)".
  return (
    <p className={cn("text-xs", urgente ? "font-semibold text-red-700" : "text-steel-500")}>
      {partes.join(" · ")}
    </p>
  );
}

/**
 * Lo que le toca a cada unidad.
 *
 * Entra por lo vencido, que es lo que para un camión. Cada fila es una unidad y un
 * mantenimiento, porque así es como se trabaja: "a la BJA-838 le toca aceite", no "la
 * BJA-838 tiene cosas pendientes".
 */
export default async function MantenimientoPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("maintenance.view");
  const sp = await searchParams;
  const canManage = can(user.role, "maintenance.manage");

  const filtros = readMaintenanceFilters(sp);
  const cuentas = await maintenanceCounts({ q: filtros.q, kind: filtros.kind });

  // Se abre en lo vencido si hay algo; con todo al día, abrir en una lista vacía no diría
  // nada, así que se muestra todo.
  const sinElegir = first(sp.estado) === undefined;
  const porDefecto = sinElegir && !filtros.q && cuentas.vencido > 0 ? "VENCIDO" : "";
  const estado = sinElegir ? porDefecto : first(sp.estado)!;

  const filas = await listMaintenance({ ...filtros, estado: estado || undefined });

  return (
    <>
      <PageHeader
        title="Mantenimiento"
        description="Qué le toca a cada unidad, por kilometraje y por tiempo."
        actions={
          <>
            <ExportTable tabla="mantenimiento" label="Descargar" />
            <Link
              href="/documentos"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-steel-300 bg-white px-4 text-[15px] text-ink transition-colors hover:border-ink"
            >
              <Car className="h-4 w-4 text-steel-500" aria-hidden /> Documentos de la flota
            </Link>
          </>
        }
      />

      {cuentas.vencido > 0 && (
        <Link
          href="/mantenimiento?estado=VENCIDO"
          className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 hover:border-red-400"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{cuentas.vencido} mantenimiento(s)</strong> ya pasaron su fecha o su kilometraje.
          </span>
        </Link>
      )}

      <TabLinks
        name="estado"
        current={estado}
        base="/mantenimiento"
        params={sp}
        className="mb-3"
        tabs={[
          { value: "VENCIDO", label: "Vencidos", count: cuentas.vencido },
          { value: "POR_VENCER", label: "Tocan pronto", count: cuentas.porVencer },
          { value: "SIN_REGISTRO", label: "Nunca se hicieron", count: cuentas.sinRegistro },
          { value: "AL_DIA", label: "Al día", count: cuentas.alDia },
          { value: "", label: "Todo", count: cuentas.total },
        ]}
      />

      <FilterBar
        searchPlaceholder="Buscar por placa, marca o modelo"
        filters={[{
          type: "select", name: "tipo", label: "Mantenimiento", allLabel: "Todos",
          options: Object.entries(MAINTENANCE_KIND_LABEL).map(([value, label]) => ({ value, label })),
        }]}
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-steel-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-100/70" aria-hidden /> Ya pasó
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm border border-brand bg-brand-soft" aria-hidden /> Toca pronto
        </span>
        <span>Manda lo que llegue antes: los kilómetros o el tiempo.</span>
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Unidad</Th>
            <Th>Mantenimiento</Th>
            <Th>Última vez</Th>
            <Th>Cada</Th>
            <Th>Toca</Th>
            <Th>Estado</Th>
            {canManage && <Th className="text-right">Acciones</Th>}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <EmptyRow
              colSpan={canManage ? 7 : 6}
              title="No hay nada con esos filtros"
              hint="Prueba con otra pestaña, o registra el primer mantenimiento desde la unidad."
            />
          )}
          {filas.map((r) => (
            <Tr key={`${r.vehicleId}-${r.kind}`} tone={TONO[r.estado]}>
              <Td>
                <Link href={`/documentos/vehiculos/${r.vehicleId}`} className="font-semibold hover:underline">
                  {r.plate}
                </Link>
                <p className="text-xs text-steel-500">
                  {[r.brand, r.model].filter(Boolean).join(" ") || "—"}
                </p>
                {r.odometerKm !== null && (
                  <p className="flex items-center gap-1 text-xs text-steel-400">
                    <Gauge className="h-3 w-3" aria-hidden /> {km(r.odometerKm)}
                    {r.odometerAt && ` · ${formatDate(r.odometerAt)}`}
                  </p>
                )}
              </Td>
              <Td className="font-medium">{MAINTENANCE_KIND_LABEL[r.kind]}</Td>
              <Td className="whitespace-nowrap">
                {r.ultimaFecha ? (
                  <>
                    <span className="tabular">{formatDate(r.ultimaFecha)}</span>
                    <p className="text-xs text-steel-500">{r.ultimoKm !== null ? km(r.ultimoKm) : "sin kilometraje"}</p>
                  </>
                ) : (
                  <span className="text-sm text-steel-400">Nunca</span>
                )}
              </Td>
              <Td className="whitespace-nowrap text-sm text-steel-600">
                {[r.everyKm && km(r.everyKm), r.everyDays && `${r.everyDays} día(s)`]
                  .filter(Boolean).join(" o ") || "—"}
                {r.reglaPropia && <p className="text-xs text-steel-400">propia de la unidad</p>}
              </Td>
              <Td className="whitespace-nowrap">
                {r.proximaFecha && <span className="tabular">{formatDate(r.proximaFecha)}</span>}
                {r.proximoKm !== null && (
                  <p className="text-xs text-steel-500">{km(r.proximoKm)}</p>
                )}
                <Falta dias={r.diasRestantes} kms={r.kmRestantes} />
              </Td>
              <Td>
                {r.estado === "VENCIDO" && <Badge tone="red">Vencido</Badge>}
                {r.estado === "POR_VENCER" && <Badge tone="yellow">Toca pronto</Badge>}
                {r.estado === "AL_DIA" && <Badge tone="green">Al día</Badge>}
                {r.estado === "SIN_REGISTRO" && <Badge tone="neutral">Nunca se hizo</Badge>}
              </Td>
              {canManage && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <MaintenanceModal
                      unidad={{ id: r.vehicleId, plate: r.plate, odometerKm: r.odometerKm, odometerAt: r.odometerAt }}
                      kind={r.kind}
                      compact
                    />
                    <MaintenancePlanModal
                      unidad={{ id: r.vehicleId, plate: r.plate, odometerKm: r.odometerKm, odometerAt: r.odometerAt }}
                      kind={r.kind}
                      everyKm={r.everyKm}
                      everyDays={r.everyDays}
                      propia={r.reglaPropia}
                    />
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </TableShell>

      {cuentas.sinRegistro > 0 && estado !== "SIN_REGISTRO" && (
        <p className="mt-3 text-sm text-steel-500">
          <Wrench className="mr-1 inline h-4 w-4" aria-hidden />
          {cuentas.sinRegistro} mantenimiento(s) nunca se registraron, así que el sistema no puede
          calcular cuándo tocan.{" "}
          <Link href="/mantenimiento?estado=SIN_REGISTRO" className="underline">Verlos</Link>
        </p>
      )}
    </>
  );
}
