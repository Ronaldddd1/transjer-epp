import "server-only";
import { and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { employees, maintenancePlans, maintenanceRecords, users, vehicles } from "@/db/schema";
import {
  estadoMantenimiento, first, MAINTENANCE_DEFAULTS, MAINTENANCE_KINDS,
  type MaintenanceKind, type MaintenanceStatus, type SearchParamsRecord,
} from "@/lib/utils";

/**
 * El mantenimiento de la flota.
 *
 * La pregunta que responde es "¿qué le toca a cada unidad y cuándo?", y se contesta
 * cruzando tres cosas: la regla de esa unidad (o la de por defecto), lo último que se le
 * hizo, y el kilometraje actual. Nada de eso se guarda calculado: si se guardara la
 * "próxima fecha", cambiar la periodicidad obligaría a reescribir el historial.
 */

/** Lo último que se le hizo a cada unidad, por tipo de mantenimiento. */
async function ultimosServicios(vehicleId?: string) {
  const filas = await db.select({
    vehicleId: maintenanceRecords.vehicleId,
    kind: maintenanceRecords.kind,
    servicedAt: sql<string>`max(${maintenanceRecords.servicedAt})::text`,
    odometerKm: sql<number | null>`(array_agg(${maintenanceRecords.odometerKm}
      order by ${maintenanceRecords.servicedAt} desc, ${maintenanceRecords.createdAt} desc))[1]`,
    veces: sql<number>`count(*)::int`,
  })
    .from(maintenanceRecords)
    .where(vehicleId ? eq(maintenanceRecords.vehicleId, vehicleId) : undefined)
    .groupBy(maintenanceRecords.vehicleId, maintenanceRecords.kind);

  const mapa = new Map<string, { servicedAt: string; odometerKm: number | null; veces: number }>();
  for (const f of filas) mapa.set(`${f.vehicleId}|${f.kind}`, f);
  return mapa;
}

/** Las reglas propias de cada unidad. Lo que no esté aquí usa la periodicidad por defecto. */
async function planes(vehicleId?: string) {
  const filas = await db.select().from(maintenancePlans)
    .where(vehicleId ? eq(maintenancePlans.vehicleId, vehicleId) : undefined);
  const mapa = new Map<string, typeof filas[number]>();
  for (const f of filas) mapa.set(`${f.vehicleId}|${f.kind}`, f);
  return mapa;
}

export type MaintenanceFilters = {
  q?: string;
  /** VENCIDO | POR_VENCER | AL_DIA | SIN_REGISTRO */
  estado?: string;
  kind?: string;
  soloActivos?: boolean;
};

export function readMaintenanceFilters(sp: SearchParamsRecord): MaintenanceFilters {
  return {
    q: first(sp.q)?.trim() || undefined,
    estado: first(sp.estado) || undefined,
    kind: first(sp.tipo) || undefined,
  };
}

export type MaintenanceRow = {
  vehicleId: string;
  plate: string;
  brand: string | null;
  model: string | null;
  active: boolean;
  odometerKm: number | null;
  odometerAt: string | null;
  driverName: string | null;
  kind: MaintenanceKind;
  everyKm: number | null;
  everyDays: number | null;
  /** Si la periodicidad es la de por defecto o una puesta a mano para esta unidad. */
  reglaPropia: boolean;
  ultimaFecha: string | null;
  ultimoKm: number | null;
  veces: number;
  estado: MaintenanceStatus;
  proximaFecha: string | null;
  proximoKm: number | null;
  diasRestantes: number | null;
  kmRestantes: number | null;
};

/**
 * Una fila por unidad y tipo de mantenimiento, con su situación ya calculada.
 *
 * Se arma en memoria a propósito: son dieciocho unidades por siete tipos, ciento y pico de
 * filas. Hacerlo en SQL con la regla, el último servicio y el odómetro cruzados daría una
 * consulta que nadie podría volver a tocar dentro de un año.
 */
export async function listMaintenance(f: MaintenanceFilters = {}): Promise<MaintenanceRow[]> {
  const condiciones: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    condiciones.push(or(
      ilike(vehicles.plate, like), ilike(vehicles.brand, like), ilike(vehicles.model, like),
    )!);
  }
  if (f.soloActivos !== false) condiciones.push(eq(vehicles.active, true));

  const unidades = await db.select({
    id: vehicles.id,
    plate: vehicles.plate,
    brand: vehicles.brand,
    model: vehicles.model,
    active: vehicles.active,
    odometerKm: vehicles.odometerKm,
    odometerAt: vehicles.odometerAt,
    driverName: sql<string | null>`nullif(concat_ws(' ', ${employees.firstName}, ${employees.lastName}), '')`,
  })
    .from(vehicles)
    .leftJoin(employees, eq(vehicles.driverId, employees.id))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(asc(vehicles.plate));

  const [ultimos, reglas] = await Promise.all([ultimosServicios(), planes()]);
  const tipos = (f.kind ? [f.kind] : MAINTENANCE_KINDS) as MaintenanceKind[];

  const filas: MaintenanceRow[] = [];
  for (const v of unidades) {
    for (const kind of tipos) {
      const clave = `${v.id}|${kind}`;
      const plan = reglas.get(clave);
      if (plan && !plan.active) continue;   // esta unidad no hace este mantenimiento

      const everyKm = plan?.everyKm ?? MAINTENANCE_DEFAULTS[kind].everyKm;
      const everyDays = plan?.everyDays ?? MAINTENANCE_DEFAULTS[kind].everyDays;
      const ultimo = ultimos.get(clave);

      const calculo = estadoMantenimiento({
        ultimaFecha: ultimo?.servicedAt ?? null,
        ultimoKm: ultimo?.odometerKm ?? null,
        everyKm, everyDays,
        kmActual: v.odometerKm,
      });

      filas.push({
        vehicleId: v.id, plate: v.plate, brand: v.brand, model: v.model, active: v.active,
        odometerKm: v.odometerKm, odometerAt: v.odometerAt, driverName: v.driverName,
        kind, everyKm, everyDays, reglaPropia: !!plan,
        ultimaFecha: ultimo?.servicedAt ?? null,
        ultimoKm: ultimo?.odometerKm ?? null,
        veces: ultimo?.veces ?? 0,
        ...calculo,
      });
    }
  }

  // Primero lo que ya se pasó, y dentro de eso lo que lleva más tiempo pasado.
  const orden: Record<MaintenanceStatus, number> = { VENCIDO: 0, POR_VENCER: 1, SIN_REGISTRO: 2, AL_DIA: 3 };
  filas.sort((a, b) =>
    orden[a.estado] - orden[b.estado]
    || (a.diasRestantes ?? 9999) - (b.diasRestantes ?? 9999)
    || a.plate.localeCompare(b.plate));

  return f.estado ? filas.filter((r) => r.estado === f.estado) : filas;
}

/** Cuántos hay en cada situación, para las pestañas. */
export async function maintenanceCounts(f: MaintenanceFilters = {}) {
  const filas = await listMaintenance({ ...f, estado: undefined });
  return {
    total: filas.length,
    vencido: filas.filter((r) => r.estado === "VENCIDO").length,
    porVencer: filas.filter((r) => r.estado === "POR_VENCER").length,
    alDia: filas.filter((r) => r.estado === "AL_DIA").length,
    sinRegistro: filas.filter((r) => r.estado === "SIN_REGISTRO").length,
  };
}

/** El historial de una unidad: todo lo que se le hizo, lo último arriba. */
export async function listMaintenanceFor(vehicleId: string, limit = 100) {
  return db.select({
    id: maintenanceRecords.id,
    kind: maintenanceRecords.kind,
    servicedAt: maintenanceRecords.servicedAt,
    odometerKm: maintenanceRecords.odometerKm,
    cost: maintenanceRecords.cost,
    currency: maintenanceRecords.currency,
    workshop: maintenanceRecords.workshop,
    notes: maintenanceRecords.notes,
    createdByName: users.name,
    createdAt: maintenanceRecords.createdAt,
  })
    .from(maintenanceRecords)
    .leftJoin(users, eq(maintenanceRecords.createdBy, users.id))
    .where(eq(maintenanceRecords.vehicleId, vehicleId))
    .orderBy(desc(maintenanceRecords.servicedAt), desc(maintenanceRecords.createdAt))
    .limit(limit);
}

/** Lo que le toca a una unidad, para su ficha. */
export async function maintenanceForVehicle(vehicleId: string) {
  const filas = await listMaintenance({ soloActivos: false });
  return filas.filter((r) => r.vehicleId === vehicleId);
}

export async function getMaintenanceRecord(id: string) {
  const [fila] = await db.select().from(maintenanceRecords)
    .where(eq(maintenanceRecords.id, id)).limit(1);
  return fila ?? null;
}
