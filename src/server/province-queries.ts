import "server-only";
import { and, asc, count, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { provinceClients } from "@/db/schema";
import { first, type SearchParamsRecord } from "@/lib/utils";

/**
 * El directorio de clientes de provincia: consultas de lectura.
 *
 * La pantalla se usa de una sola manera: sale un viaje a provincia, se escribe el nombre
 * del destinatario y tiene que salir todo lo demás. Por eso la búsqueda no distingue
 * mayúsculas ni pide escribir el nombre completo, y por eso busca también por provincia y
 * por teléfono: a veces lo único que se tiene es el número desde el que llamaron.
 */

export type ProvinceFilters = {
  q?: string;
  province?: string;
  /** Por defecto se listan solo los vigentes; los dados de baja se ven aparte. */
  incluirInactivos?: boolean;
};

export function readProvinceFilters(sp: SearchParamsRecord): ProvinceFilters {
  return {
    q: first(sp.q)?.trim() || undefined,
    province: first(sp.provincia) || undefined,
    incluirInactivos: first(sp.inactivos) === "1" || undefined,
  };
}

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

function condiciones(f: ProvinceFilters): SQL | undefined {
  return and(
    f.incluirInactivos ? undefined : eq(provinceClients.active, true),
    f.province ? sql`upper(${provinceClients.province}) = upper(${f.province})` : undefined,
    f.q
      ? or(
        sql`upper(${provinceClients.clientName}) like upper(${like(f.q)})`,
        sql`upper(${provinceClients.province}) like upper(${like(f.q)})`,
        sql`upper(coalesce(${provinceClients.location}, '')) like upper(${like(f.q)})`,
        sql`coalesce(${provinceClients.clientPhone}, '') like ${like(f.q)}`,
        sql`upper(coalesce(${provinceClients.stevedoreName}, '')) like upper(${like(f.q)})`,
      )
      : undefined,
  );
}

const columnas = {
  id: provinceClients.id,
  province: provinceClients.province,
  clientName: provinceClients.clientName,
  location: provinceClients.location,
  clientPhone: provinceClients.clientPhone,
  stevedoreName: provinceClients.stevedoreName,
  stevedorePhone: provinceClients.stevedorePhone,
  costPerTon: provinceClients.costPerTon,
  notes: provinceClients.notes,
  active: provinceClients.active,
  updatedAt: provinceClients.updatedAt,
};

export async function listProvinceClients(f: ProvinceFilters, limit = 50, offset = 0) {
  const where = condiciones(f);
  const [rows, [total]] = await Promise.all([
    db.select(columnas).from(provinceClients).where(where)
      .orderBy(asc(provinceClients.province), asc(provinceClients.clientName))
      .limit(limit).offset(offset),
    db.select({ total: count() }).from(provinceClients).where(where),
  ]);
  return { rows, total: total?.total ?? 0 };
}

export async function getProvinceClient(id: string) {
  const [row] = await db.select(columnas).from(provinceClients).where(eq(provinceClients.id, id)).limit(1);
  return row ?? null;
}

/** Las provincias que ya tienen clientes registrados, para el filtro. */
export async function provinceOptions() {
  const rows = await db.selectDistinct({ province: provinceClients.province })
    .from(provinceClients)
    .where(eq(provinceClients.active, true))
    .orderBy(asc(provinceClients.province));
  return rows.map((r) => r.province).filter(Boolean);
}

/** Cuántos hay en total y cuántas provincias cubren, para la cabecera. */
export async function provinceCounts() {
  const [row] = await db.select({
    clientes: count(),
    provincias: sql<number>`count(distinct upper(${provinceClients.province}))::int`,
    conPrecio: sql<number>`count(*) filter (where ${provinceClients.costPerTon} is not null)::int`,
  }).from(provinceClients).where(eq(provinceClients.active, true));
  return row ?? { clientes: 0, provincias: 0, conPrecio: 0 };
}
