import "server-only";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { employees, users, vehicles, vehicleTrips } from "@/db/schema";
import { first, todayLima, type SearchParamsRecord } from "@/lib/utils";

/**
 * Consultas de las salidas de la flota: lo que salió un día, y el control de qué
 * documentos (FO, guías, órdenes) faltan liquidar.
 */

const isYmd = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export type TripFilters = {
  vista: "dia" | "control" | "terceros";
  dia: string;
  /** PENDIENTE | LIQUIDADO | "" (todas). En el control arranca en PENDIENTE. */
  estado: string;
  q?: string;
  desde?: string;
  hasta?: string;
};

export function readTripFilters(sp: SearchParamsRecord): TripFilters {
  const pedida = first(sp.vista);
  const vista = pedida === "control" ? "control" : pedida === "terceros" ? "terceros" : "dia";
  const dia = first(sp.dia);
  const estado = first(sp.estado);
  return {
    vista,
    dia: isYmd(dia) && dia! <= todayLima() ? dia! : todayLima(),
    // "Todas" llega como estado="" y es una elección: solo sin parámetro se toma PENDIENTE.
    estado: estado === undefined ? "PENDIENTE" : ["PENDIENTE", "LIQUIDADO"].includes(estado) ? estado : "",
    q: first(sp.q)?.trim() || undefined,
    desde: isYmd(first(sp.desde)) ? first(sp.desde) : undefined,
    hasta: isYmd(first(sp.hasta)) ? first(sp.hasta) : undefined,
  };
}

const chofer = alias(employees, "chofer");
const liquidador = alias(users, "liquidador");

const columnas = {
  id: vehicleTrips.id,
  day: sql<string>`${vehicleTrips.day}::text`,
  vehicleId: vehicleTrips.vehicleId,
  plate: vehicles.plate,
  driverId: vehicleTrips.driverId,
  driverName: sql<string | null>`nullif(concat_ws(' ', ${chofer.firstName}, ${chofer.lastName}), '')`,
  client: vehicleTrips.client,
  destination: vehicleTrips.destination,
  docType: vehicleTrips.docType,
  docNumber: vehicleTrips.docNumber,
  status: vehicleTrips.status,
  settledAt: sql<string | null>`${vehicleTrips.settledAt}::text`,
  settledByName: liquidador.name,
  notes: vehicleTrips.notes,
  /** Días desde la salida: lo que lleva esperando un documento pendiente. */
  dias: sql<number>`(((now() at time zone 'America/Lima')::date) - ${vehicleTrips.day})::int`,
};

function base() {
  return db.select(columnas).from(vehicleTrips)
    .innerJoin(vehicles, eq(vehicles.id, vehicleTrips.vehicleId))
    .leftJoin(chofer, eq(chofer.id, vehicleTrips.driverId))
    .leftJoin(liquidador, eq(liquidador.id, vehicleTrips.settledBy));
}

const busqueda = (q?: string) => {
  if (!q) return undefined;
  const t = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return or(
    ilike(vehicleTrips.client, t), ilike(vehicleTrips.docNumber, t), ilike(vehicles.plate, t),
    ilike(vehicleTrips.destination, t),
  );
};

/** Las salidas de un día, en el orden en que se registraron. */
export async function listTripsDay(dia: string, q?: string) {
  return base()
    .where(and(eq(vehicleTrips.day, dia), busqueda(q)))
    .orderBy(asc(vehicleTrips.createdAt));
}

export type TripRow = Awaited<ReturnType<typeof listTripsDay>>[number];

/**
 * El control de liquidación: las salidas con su documento y si ya se liquidó. Lo pendiente
 * va primero y, dentro de eso, lo más antiguo: es lo que más urge cobrar.
 */
export async function listTripsControl(f: TripFilters, limit = 500) {
  return base()
    .where(and(
      f.estado ? eq(vehicleTrips.status, f.estado) : undefined,
      f.desde ? gte(vehicleTrips.day, f.desde) : undefined,
      f.hasta ? lte(vehicleTrips.day, f.hasta) : undefined,
      busqueda(f.q),
    ))
    .orderBy(desc(sql`${vehicleTrips.status} = 'PENDIENTE'`), asc(vehicleTrips.day), asc(vehicleTrips.createdAt))
    .limit(limit);
}

/** Cuántos documentos faltan liquidar, en total y por cliente. */
export async function tripPendingSummary() {
  const filas = await db.select({
    client: sql<string>`min(${vehicleTrips.client})`,
    pendientes: sql<number>`count(*)::int`,
    masAntigua: sql<string>`min(${vehicleTrips.day})::text`,
  })
    .from(vehicleTrips)
    .where(eq(vehicleTrips.status, "PENDIENTE"))
    .groupBy(sql`lower(btrim(${vehicleTrips.client}))`)
    .orderBy(desc(sql`count(*)`));
  return { total: filas.reduce((n, f) => n + f.pendientes, 0), porCliente: filas };
}

/** Las unidades activas, con su conductor habitual para proponerlo al registrar. */
export async function tripVehicleOptions() {
  return db.select({ id: vehicles.id, plate: vehicles.plate, driverId: vehicles.driverId })
    .from(vehicles)
    .where(and(eq(vehicles.active, true), eq(vehicles.isDemo, false)))
    .orderBy(asc(vehicles.plate));
}

/** Trabajadores activos para elegir el conductor; los conductores van primero. */
export async function tripDriverOptions() {
  return db.select({
    id: employees.id,
    nombre: sql<string>`${employees.lastName} || ', ' || ${employees.firstName}`,
    position: employees.position,
  })
    .from(employees)
    .where(eq(employees.active, true))
    .orderBy(desc(sql`${employees.position} ilike '%conduct%' or ${employees.position} ilike '%chofer%'`), asc(employees.lastName));
}

/** Los clientes ya usados, para sugerirlos al escribir. Alicorp va siempre. */
export async function tripClientOptions() {
  const filas = await db.selectDistinct({ client: vehicleTrips.client }).from(vehicleTrips).orderBy(asc(vehicleTrips.client));
  const nombres = filas.map((f) => f.client);
  return nombres.some((n) => /alicorp/i.test(n)) ? nombres : ["Alicorp", ...nombres];
}
