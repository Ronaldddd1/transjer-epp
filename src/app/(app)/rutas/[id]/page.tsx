import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eliminarPlan } from "@/actions/rutas";
import { PlanRuta } from "@/components/rutas/plan-ruta";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { lugares, obtenerPlan, vehiculosParaRutas } from "@/server/rutas";

export const metadata: Metadata = { title: "Ruta de reparto" };
export const dynamic = "force-dynamic";
// Calcular las rutas consulta las calles y busca la mejor combinación: puede tardar.
export const maxDuration = 60;

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("trips.view");
  const { id } = await params;
  const datos = await obtenerPlan(id);
  if (!datos) notFound();
  const [{ centro, cochera }, flota] = await Promise.all([lugares(), vehiculosParaRutas()]);
  const canManage = can(user, "trips.manage");
  const { plan, paradas, moviles } = datos;

  return (
    <>
      <Link href="/rutas" className="mb-2 inline-flex items-center gap-1 text-sm text-steel-600 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Rutas de reparto
      </Link>
      <PageHeader
        title={`Reparto del ${formatDate(plan.serviceDate)}`}
        description={plan.fileName ?? undefined}
        actions={canManage ? (
          <ConfirmButton
            action={eliminarPlan.bind(null, plan.id)}
            title="¿Eliminar esta programación?"
            message="Se borran sus paradas y rutas. Las direcciones ya ubicadas se siguen recordando."
            confirmLabel="Eliminar"
            triggerVariant="outline"
            triggerLabel="Eliminar"
            triggerTitle="Eliminar esta programación"
            size="md"
          />
        ) : undefined}
      />
      <PlanRuta
        plan={{ id: plan.id, serviceDate: plan.serviceDate, status: plan.status, totalKm: plan.totalKm, approximate: plan.approximate, serviceMinutes: plan.serviceMinutes }}
        paradas={paradas.map((p) => ({
          id: p.id, orders: p.orders, customer: p.customer, phone: p.phone, address: p.address, cleanAddress: p.cleanAddress,
          reference: p.reference, district: p.district, dispatchType: p.dispatchType, agency: p.agency, notes: p.notes,
          deadline: p.deadline, kg: p.kg, m3: p.m3, lat: p.lat, lng: p.lng, geoQuality: p.geoQuality,
          planVehicleId: p.planVehicleId, sequence: p.sequence,
        }))}
        moviles={moviles.map((m) => ({
          id: m.id, plate: m.plate, position: m.position, capacityKg: m.capacityKg, capacityM3: m.capacityM3, maxStops: m.maxStops,
          km: m.km, minutes: m.minutes, loadKg: m.loadKg, loadM3: m.loadM3, geometry: m.geometry,
        }))}
        centro={{ lat: centro.lat, lng: centro.lng, name: centro.name, address: centro.address, porDefecto: centro.porDefecto }}
        cochera={cochera ? { lat: cochera.lat, lng: cochera.lng, name: cochera.name, address: cochera.address } : null}
        flota={flota}
        canManage={canManage}
      />
    </>
  );
}
