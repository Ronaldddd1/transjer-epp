import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, routePlaces, routePlans, routePlanStops, routePlanVehicles, vehicles } from "@/db/schema";

/** Las consultas de las rutas de reparto. */

export type Lugar = { key: string; name: string; address: string | null; lat: number; lng: number; porDefecto?: boolean };

/**
 * El centro de recojo del cliente está en Lurín. Mientras nadie fije el punto exacto, se
 * usa el centro del distrito (y la pantalla avisa que conviene ubicarlo).
 */
export const CENTRO_POR_DEFECTO: Lugar = {
  key: "CD", name: "Centro de recojo (Lurín)", address: "Lurín, Lima", lat: -12.2746, lng: -76.8706, porDefecto: true,
};

export async function lugares(): Promise<{ centro: Lugar; cochera: Lugar | null }> {
  const filas = await db.select().from(routePlaces);
  const centro = filas.find((f) => f.key === "CD");
  const cochera = filas.find((f) => f.key === "COCHERA");
  return {
    centro: centro ? { key: "CD", name: centro.name, address: centro.address, lat: centro.lat, lng: centro.lng } : CENTRO_POR_DEFECTO,
    cochera: cochera ? { key: "COCHERA", name: cochera.name, address: cochera.address, lat: cochera.lat, lng: cochera.lng } : null,
  };
}

export async function listarPlanes(limit = 60) {
  return db.select({
    id: routePlans.id,
    serviceDate: routePlans.serviceDate,
    name: routePlans.name,
    fileName: routePlans.fileName,
    status: routePlans.status,
    totalKm: routePlans.totalKm,
    approximate: routePlans.approximate,
    createdAt: routePlans.createdAt,
    paradas: sql<number>`(select count(*)::int from route_plan_stops s where s.plan_id = ${routePlans.id})`,
    moviles: sql<number>`(select count(*)::int from route_plan_vehicles v where v.plan_id = ${routePlans.id} and v.km is not null)`,
    kg: sql<string>`(select coalesce(sum(s.kg), 0)::text from route_plan_stops s where s.plan_id = ${routePlans.id})`,
  }).from(routePlans).orderBy(desc(routePlans.serviceDate), desc(routePlans.createdAt)).limit(limit);
}

export async function obtenerPlan(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [plan] = await db.select().from(routePlans).where(eq(routePlans.id, id));
  if (!plan) return null;
  const [moviles, paradas] = await Promise.all([
    db.select().from(routePlanVehicles).where(eq(routePlanVehicles.planId, id)).orderBy(asc(routePlanVehicles.position)),
    db.select().from(routePlanStops).where(eq(routePlanStops.planId, id))
      .orderBy(asc(routePlanStops.district), asc(routePlanStops.customer)),
  ]);
  return { plan, moviles, paradas };
}

export type PlanCompleto = NonNullable<Awaited<ReturnType<typeof obtenerPlan>>>;

/** Las unidades activas de la flota, con su capacidad y conductor, para elegir las del día. */
export async function vehiculosParaRutas() {
  return db.select({
    id: vehicles.id,
    plate: vehicles.plate,
    description: vehicles.description,
    capacityTn: vehicles.capacityTn,
    capacityM3: vehicles.capacityM3,
    driver: sql<string | null>`case when ${employees.id} is null then null else ${employees.firstName} || ' ' || ${employees.lastName} end`,
  }).from(vehicles)
    .leftJoin(employees, eq(employees.id, vehicles.driverId))
    .where(eq(vehicles.active, true))
    .orderBy(asc(vehicles.plate));
}
