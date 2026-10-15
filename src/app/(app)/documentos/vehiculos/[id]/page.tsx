import { ArrowLeft, Car } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DocumentFormModal, ToggleVehicleButton, VehicleFormModal,
} from "@/components/documents/document-actions";
import { DocumentTable, LeyendaVencimientos } from "@/components/documents/document-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { documentStatus, formatDate } from "@/lib/utils";
import { getVehicle, listDocumentsFor } from "@/server/document-queries";

export const metadata: Metadata = { title: "Vehículo" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La ficha de una unidad: sus datos y todos sus papeles. */
export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("documents.view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const vehiculo = await getVehicle(id);
  if (!vehiculo) notFound();

  const canManage = can(user.role, "documents.manage");
  const documentos = await listDocumentsFor({ vehicleId: id });

  const vencidos = documentos.filter((d) => documentStatus(d.expiresAt) === "VENCIDO");
  const porVencer = documentos.filter((d) => documentStatus(d.expiresAt) === "POR_VENCER");

  return (
    <>
      <Link href="/documentos/vehiculos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a vehículos
      </Link>

      <PageHeader
        title={vehiculo.plate}
        description={vehiculo.description ?? "Sin descripción"}
        actions={
          <>
            {canManage && (
              <DocumentFormModal
                vehicleId={vehiculo.id}
                etiqueta={`el vehículo ${vehiculo.plate}`}
              />
            )}
            {canManage && (
              <VehicleFormModal vehiculo={{
                id: vehiculo.id, plate: vehiculo.plate,
                description: vehiculo.description, notes: vehiculo.notes,
              }} />
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
        {vencidos.length === 0 && porVencer.length > 0 && <Badge tone="yellow">{porVencer.length} por vencer</Badge>}
        {vencidos.length === 0 && porVencer.length === 0 && documentos.length > 0 && <Badge tone="green">Al día</Badge>}
        <span className="text-sm text-steel-500">{documentos.length} documento(s)</span>
      </div>

      {vencidos.length > 0 && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Esta unidad tiene {vencidos.length} documento(s) vencido(s):{" "}
          {vencidos.map((d) => `${d.title ?? d.kind} (venció el ${formatDate(d.expiresAt)})`).join(", ")}.
        </p>
      )}

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
