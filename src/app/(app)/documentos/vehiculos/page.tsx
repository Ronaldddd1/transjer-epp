import { AlertTriangle, ArrowLeft, Car } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { VehicleFormModal } from "@/components/documents/document-actions";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { daysToExpiry, documentStatus, first, formatDate, type SearchParams } from "@/lib/utils";
import { listVehicles } from "@/server/document-queries";

export const metadata: Metadata = { title: "Vehículos" };

/** La flota, con el estado de los papeles de cada unidad. */
export default async function VehiclesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("documents.view");
  const sp = await searchParams;
  const canManage = can(user.role, "documents.manage");
  const rows = await listVehicles(first(sp.q)?.trim() || undefined);

  const conProblemas = rows.filter((v) => v.vencidos > 0).length;

  return (
    <>
      <Link href="/documentos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a documentos
      </Link>

      <PageHeader
        title="Vehículos"
        description="Las unidades de la flota. Cada una guarda su SOAT, tarjetas y revisión técnica."
        actions={canManage ? <VehicleFormModal /> : undefined}
      />

      {conProblemas > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
          <span><strong>{conProblemas} unidad(es)</strong> tienen algún documento vencido.</span>
        </div>
      )}

      <FilterBar searchPlaceholder="Buscar por placa o descripción" filters={[]} />

      <TableShell>
        <thead>
          <tr>
            <Th>Placa</Th>
            <Th className="hidden lg:table-cell">Descripción</Th>
            <Th className="text-center">Documentos</Th>
            <Th>Próximo vencimiento</Th>
            <Th>Estado</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={6}
              title="No hay vehículos registrados"
              hint={canManage ? "Regístralos con el botón de arriba, o cárgalos de una con el script de importación." : undefined}
            />
          )}
          {rows.map((v) => {
            const estado = documentStatus(v.proximoVencimiento);
            return (
              <Tr
                key={v.id}
                tone={v.vencidos > 0 ? "bg-red-100/70 hover:bg-red-100" : estado === "POR_VENCER" ? "bg-brand-soft hover:bg-[#FFEBA8]" : ""}
              >
                <Td>
                  <Link href={`/documentos/vehiculos/${v.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                    <Car className="h-4 w-4 shrink-0 text-steel-400" aria-hidden />
                    {v.plate}
                  </Link>
                </Td>
                <Td className="hidden text-steel-600 lg:table-cell">{v.description ?? "—"}</Td>
                <Td className="text-center tabular text-steel-600">{v.documentos}</Td>
                <Td>
                  {v.proximoVencimiento ? (
                    <>
                      <span className="whitespace-nowrap tabular">{formatDate(v.proximoVencimiento)}</span>
                      <p className="text-xs text-steel-500">en {daysToExpiry(v.proximoVencimiento)} día(s)</p>
                    </>
                  ) : (
                    <span className="text-sm text-steel-400">—</span>
                  )}
                </Td>
                <Td>
                  {!v.active
                    ? <Badge tone="neutral">De baja</Badge>
                    : v.vencidos > 0
                      ? <Badge tone="red">{v.vencidos} vencido(s)</Badge>
                      : v.documentos === 0
                        ? <Badge tone="yellow">Sin documentos</Badge>
                        : <Badge tone="green">Al día</Badge>}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <ButtonLink href={`/documentos/vehiculos/${v.id}`} variant="ghost" size="sm">Ver</ButtonLink>
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
    </>
  );
}
