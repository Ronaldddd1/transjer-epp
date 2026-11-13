import "server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, eppDeliveries, eppReturns, products, users } from "@/db/schema";
import type { DatosCargo, DatosDevolucion, Empresa, LineaEpp, Trabajador } from "./actas-epp-pdf";
import { employeeHoldings } from "./queries";

/**
 * Los datos de los papeles del EPP: el cargo de entrega y el acta de devolución.
 *
 * Una entrega o devolución se identifica por su lote (lo registrado de una sola vez). Las
 * de antes de los lotes se piden por fecha: todo lo de ese día.
 */

export type Seleccion = { lote?: string; fecha?: string };

const esUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);
const esYmd = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function leerSeleccion(url: URL): Seleccion | null {
  const lote = url.searchParams.get("lote") ?? undefined;
  const fecha = url.searchParams.get("fecha") ?? undefined;
  if (lote) return esUuid(lote) ? { lote } : null;
  if (fecha) return esYmd(fecha) ? { fecha } : null;
  return {};
}

export function empresa(): Empresa {
  return {
    nombre: process.env.COMPANY_NAME?.trim() || "Transjer Operador Logístico S.A.C.",
    ruc: process.env.COMPANY_RUC?.trim() || null,
  };
}

async function trabajador(id: string): Promise<Trabajador | null> {
  if (!esUuid(id)) return null;
  const [e] = await db.select().from(employees).where(eq(employees.id, id));
  if (!e) return null;
  return {
    nombre: `${e.firstName} ${e.lastName}`.toUpperCase(),
    dni: e.dni, cargo: e.position, area: e.area, ingreso: e.hireDate, cese: e.terminatedAt,
  };
}

const numero = (prefijo: string, id: string | null, ymd: string) =>
  `${prefijo}-${ymd.replaceAll("-", "")}-${(id ?? "0000").replace(/-/g, "").slice(0, 6).toUpperCase()}`;

const unicos = (v: (string | null)[]) => Array.from(new Set(v.filter(Boolean))).join(", ");

/**
 * El cargo de entrega. Con lote o fecha, lo entregado esa vez; sin nada, todo lo que el
 * trabajador tiene a su cargo hoy (sirve para hacer firmar a los que recibieron EPP antes
 * de que existiera el cargo).
 */
export async function datosCargo(employeeId: string, sel: Seleccion, hoy: string): Promise<DatosCargo | null> {
  const t = await trabajador(employeeId);
  if (!t) return null;

  if (!sel.lote && !sel.fecha) {
    const holdings = (await employeeHoldings(employeeId)).filter((h) => h.pendiente > 0);
    if (!holdings.length) return null;
    return {
      empresa: empresa(), trabajador: t, vigente: true,
      numero: numero("CE", employeeId, hoy), fecha: hoy,
      motivo: "EPP a su cargo a la fecha", responsable: "",
      lineas: holdings.map((h) => ({
        codigo: h.productCode, descripcion: h.productName, talla: h.size, cantidad: h.pendiente,
        precio: h.unitPrice == null ? null : Number(h.unitPrice),
      })),
    };
  }

  const filas = await db.select({
    id: eppDeliveries.id,
    batchId: eppDeliveries.batchId,
    fecha: eppDeliveries.deliveryDate,
    motivo: eppDeliveries.reason,
    notas: eppDeliveries.notes,
    cantidad: eppDeliveries.quantity,
    talla: eppDeliveries.size,
    precio: eppDeliveries.unitPrice,
    precioActual: products.unitPrice,
    codigo: products.code,
    descripcion: products.name,
    responsable: users.name,
  }).from(eppDeliveries)
    .innerJoin(products, eq(products.id, eppDeliveries.productId))
    .innerJoin(users, eq(users.id, eppDeliveries.userId))
    .where(and(
      eq(eppDeliveries.employeeId, employeeId),
      isNull(eppDeliveries.voidedAt),
      sel.lote ? eq(eppDeliveries.batchId, sel.lote) : eq(eppDeliveries.deliveryDate, sel.fecha!),
    ))
    .orderBy(asc(eppDeliveries.createdAt));
  if (!filas.length) return null;

  const primera = filas[0];
  return {
    empresa: empresa(), trabajador: t,
    numero: numero("CE", sel.lote ?? primera.id, primera.fecha),
    fecha: primera.fecha,
    motivo: unicos(filas.map((f) => f.motivo)),
    responsable: unicos(filas.map((f) => f.responsable)),
    notas: unicos(filas.map((f) => f.notas)) || null,
    lineas: filas.map((f) => ({
      codigo: f.codigo, descripcion: f.descripcion, talla: f.talla, cantidad: f.cantidad,
      // Las entregas de antes de los precios toman el precio de hoy.
      precio: f.precio != null ? Number(f.precio) : f.precioActual != null ? Number(f.precioActual) : null,
    })),
  };
}

/**
 * El acta de devolución: lo devuelto esa vez y lo que le quedaba a su cargo justo
 * después (si queda algo, la devolución es parcial).
 */
export async function datosDevolucion(employeeId: string, sel: Seleccion): Promise<DatosDevolucion | null> {
  const t = await trabajador(employeeId);
  if (!t || (!sel.lote && !sel.fecha)) return null;

  const filas = await db.select({
    id: eppReturns.id,
    productId: eppReturns.productId,
    fecha: eppReturns.returnDate,
    motivo: eppReturns.reason,
    notas: eppReturns.notes,
    cantidad: eppReturns.quantity,
    talla: eppReturns.size,
    estado: eppReturns.condition,
    precio: eppReturns.unitPrice,
    precioActual: products.unitPrice,
    codigo: products.code,
    descripcion: products.name,
    responsable: users.name,
    creado: eppReturns.createdAt,
  }).from(eppReturns)
    .innerJoin(products, eq(products.id, eppReturns.productId))
    .innerJoin(users, eq(users.id, eppReturns.userId))
    .where(and(
      eq(eppReturns.employeeId, employeeId),
      sel.lote ? eq(eppReturns.batchId, sel.lote) : eq(eppReturns.returnDate, sel.fecha!),
    ))
    .orderBy(asc(eppReturns.createdAt));
  if (!filas.length) return null;

  // Lo que quedaba a su cargo al terminar esta devolución: lo entregado hasta ese momento
  // menos lo devuelto hasta ese momento. Así el acta vieja sigue diciendo lo mismo aunque
  // después haya devuelto el resto.
  const corte = filas.reduce((m, f) => (f.creado > m ? f.creado : m), filas[0].creado);
  const [entregado, devuelto] = await Promise.all([
    db.select({
      productId: products.id, codigo: products.code, descripcion: products.name, talla: products.size,
      cantidad: sql<number>`sum(${eppDeliveries.quantity})::int`,
      precio: sql<string | null>`coalesce(max(${eppDeliveries.unitPrice}), ${products.unitPrice})::text`,
    }).from(eppDeliveries)
      .innerJoin(products, eq(products.id, eppDeliveries.productId))
      .where(and(eq(eppDeliveries.employeeId, employeeId), isNull(eppDeliveries.voidedAt), lte(eppDeliveries.createdAt, corte)))
      .groupBy(products.id, products.code, products.name, products.size, products.unitPrice),
    db.select({ productId: eppReturns.productId, cantidad: sql<number>`sum(${eppReturns.quantity})::int` })
      .from(eppReturns)
      .where(and(eq(eppReturns.employeeId, employeeId), lte(eppReturns.createdAt, corte)))
      .groupBy(eppReturns.productId),
  ]);
  const yaDevuelto = new Map(devuelto.map((d) => [d.productId, d.cantidad]));
  const pendiente: LineaEpp[] = entregado
    .map((e) => ({
      codigo: e.codigo, descripcion: e.descripcion, talla: e.talla,
      cantidad: e.cantidad - (yaDevuelto.get(e.productId) ?? 0),
      precio: e.precio == null ? null : Number(e.precio),
    }))
    .filter((l) => l.cantidad > 0)
    .sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));

  const primera = filas[0];
  return {
    empresa: empresa(), trabajador: t,
    numero: numero("DV", sel.lote ?? primera.id, primera.fecha),
    fecha: primera.fecha,
    motivo: unicos(filas.map((f) => f.motivo)),
    responsable: unicos(filas.map((f) => f.responsable)),
    notas: unicos(filas.map((f) => f.notas)) || null,
    lineas: filas.map((f) => ({
      codigo: f.codigo, descripcion: f.descripcion, talla: f.talla, cantidad: f.cantidad, estado: f.estado,
      precio: f.precio != null ? Number(f.precio) : f.precioActual != null ? Number(f.precioActual) : null,
    })),
    pendiente,
  };
}
