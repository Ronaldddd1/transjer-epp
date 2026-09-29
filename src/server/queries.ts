import "server-only";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { auditLogs, categories, employees, eppDeliveries, inventoryMovements, products, users, type MovementType } from "@/db/schema";
import { first, isYmd, limaDayEnd, limaDayStart, limaMonthStartYmd, type SearchParamsRecord, type StockStatus, todayLima } from "@/lib/utils";

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

// ---------- Filtros compartidos ----------
export type ReportFilters = {
  from?: string; to?: string; productId?: string; categoryId?: string;
  employeeId?: string; userId?: string; type?: MovementType; status?: StockStatus; q?: string;
  /** Entregas: VIGENTE (no anuladas) o ANULADA. Sin valor: todas. */
  deliveryState?: DeliveryState;
};
export type DeliveryState = "VIGENTE" | "ANULADA";
export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = { VIGENTE: "Vigentes", ANULADA: "Anuladas" };

export function readFilters(sp: SearchParamsRecord): ReportFilters {
  const type = first(sp.type);
  const status = first(sp.status);
  const from = first(sp.from);
  const to = first(sp.to);
  const estado = first(sp.estado);
  return {
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
    productId: first(sp.product) || undefined,
    categoryId: first(sp.category) || undefined,
    employeeId: first(sp.employee) || undefined,
    userId: first(sp.user) || undefined,
    type: type === "ENTRADA" || type === "SALIDA" || type === "AJUSTE" ? type : undefined,
    status: status === "DISPONIBLE" || status === "STOCK_BAJO" || status === "AGOTADO" ? status : undefined,
    q: first(sp.q)?.trim() || undefined,
    deliveryState: estado === "VIGENTE" || estado === "ANULADA" ? estado : undefined,
  };
}

const statusCondition = (status?: StockStatus): SQL | undefined => {
  if (status === "AGOTADO") return lte(products.stock, 0);
  if (status === "STOCK_BAJO") return and(sql`${products.stock} > 0`, sql`${products.stock} <= ${products.minimumStock}`);
  if (status === "DISPONIBLE") return sql`${products.stock} > ${products.minimumStock}`;
  return undefined;
};

// ---------- Catálogos para selects ----------
export async function getCategoryOptions(includeInactive = false) {
  return db.select({ id: categories.id, name: categories.name, active: categories.active })
    .from(categories)
    .where(includeInactive ? undefined : eq(categories.active, true))
    .orderBy(asc(categories.name));
}

export async function getProductOptions() {
  return db.select({ id: products.id, code: products.code, name: products.name, size: products.size, stock: products.stock, unit: products.unit })
    .from(products).where(eq(products.active, true)).orderBy(asc(products.name));
}

export async function getEmployeeOptions() {
  return db.select({ id: employees.id, dni: employees.dni, firstName: employees.firstName, lastName: employees.lastName, position: employees.position, area: employees.area })
    .from(employees).where(eq(employees.active, true)).orderBy(asc(employees.lastName));
}

export async function getUserOptions() {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name));
}

export async function getSizeOptions() {
  const rows = await db.selectDistinct({ size: products.size }).from(products)
    .where(and(eq(products.active, true), sql`${products.size} is not null`)).orderBy(asc(products.size));
  return rows.map((r) => r.size!).filter(Boolean);
}

// ---------- Inventario ----------
const SORTS = {
  code: products.code, name: products.name, stock: products.stock, updated: products.updatedAt, category: categories.name,
} as const;
export type ProductSort = keyof typeof SORTS;

export async function listProducts(opts: { q?: string; categoryId?: string; status?: StockStatus; size?: string; sort?: string; dir?: string; limit?: number; offset?: number }) {
  const where = and(
    eq(products.active, true),
    opts.q ? or(ilike(products.name, like(opts.q)), ilike(products.code, like(opts.q)), ilike(products.brand, like(opts.q))) : undefined,
    opts.categoryId ? eq(products.categoryId, opts.categoryId) : undefined,
    opts.size ? eq(products.size, opts.size) : undefined,
    statusCondition(opts.status),
  );
  const sortCol = SORTS[(opts.sort as ProductSort) ?? "code"] ?? products.code;
  const order = opts.dir === "desc" ? desc(sortCol) : asc(sortCol);

  const query = db.select({
    id: products.id, code: products.code, name: products.name, categoryId: products.categoryId, categoryName: categories.name,
    description: products.description, brand: products.brand, size: products.size, color: products.color, unit: products.unit,
    stock: products.stock, minimumStock: products.minimumStock, notes: products.notes, updatedAt: products.updatedAt, isDemo: products.isDemo,
  }).from(products).innerJoin(categories, eq(products.categoryId, categories.id)).where(where).orderBy(order, asc(products.code)).$dynamic();

  const [rows, [{ total }]] = await Promise.all([
    opts.limit ? query.limit(opts.limit).offset(opts.offset ?? 0) : query,
    db.select({ total: count() }).from(products).innerJoin(categories, eq(products.categoryId, categories.id)).where(where),
  ]);
  return { rows, total };
}
export type ProductRow = Awaited<ReturnType<typeof listProducts>>["rows"][number];

// ---------- Movimientos ----------
export async function listMovements(f: ReportFilters, limit?: number, offset = 0) {
  const where = and(
    f.from ? gte(inventoryMovements.createdAt, limaDayStart(f.from)) : undefined,
    f.to ? lte(inventoryMovements.createdAt, limaDayEnd(f.to)) : undefined,
    f.type ? eq(inventoryMovements.type, f.type) : undefined,
    f.productId ? eq(inventoryMovements.productId, f.productId) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.userId ? eq(inventoryMovements.userId, f.userId) : undefined,
    f.employeeId ? eq(inventoryMovements.employeeId, f.employeeId) : undefined,
    f.q ? or(ilike(products.name, like(f.q)), ilike(products.code, like(f.q)), ilike(inventoryMovements.reason, like(f.q))) : undefined,
  );
  const base = db.select({
    id: inventoryMovements.id, createdAt: inventoryMovements.createdAt, type: inventoryMovements.type,
    quantity: inventoryMovements.quantity, stockBefore: inventoryMovements.stockBefore, stockAfter: inventoryMovements.stockAfter,
    reason: inventoryMovements.reason, notes: inventoryMovements.notes,
    productCode: products.code, productName: products.name, categoryName: categories.name,
    userName: users.name,
    employeeName: sql<string | null>`case when ${employees.id} is null then null else ${employees.firstName} || ' ' || ${employees.lastName} end`,
  }).from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(users, eq(inventoryMovements.userId, users.id))
    .leftJoin(employees, eq(inventoryMovements.employeeId, employees.id))
    .where(where).orderBy(desc(inventoryMovements.createdAt)).$dynamic();

  const [rows, [{ total }]] = await Promise.all([
    limit ? base.limit(limit).offset(offset) : base,
    db.select({ total: count() }).from(inventoryMovements).innerJoin(products, eq(inventoryMovements.productId, products.id)).where(where),
  ]);
  return { rows, total };
}

// ---------- Entregas ----------
const voider = alias(users, "voider");
export async function listDeliveries(f: ReportFilters, limit?: number, offset = 0) {
  const where = and(
    f.from ? gte(eppDeliveries.deliveryDate, f.from) : undefined,
    f.to ? lte(eppDeliveries.deliveryDate, f.to) : undefined,
    f.productId ? eq(eppDeliveries.productId, f.productId) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.employeeId ? eq(eppDeliveries.employeeId, f.employeeId) : undefined,
    f.userId ? eq(eppDeliveries.userId, f.userId) : undefined,
    f.deliveryState === "VIGENTE" ? isNull(eppDeliveries.voidedAt) : f.deliveryState === "ANULADA" ? isNotNull(eppDeliveries.voidedAt) : undefined,
    f.q ? or(ilike(employees.firstName, like(f.q)), ilike(employees.lastName, like(f.q)), ilike(employees.dni, like(f.q)), ilike(products.name, like(f.q))) : undefined,
  );
  const base = db.select({
    id: eppDeliveries.id, deliveryDate: eppDeliveries.deliveryDate, createdAt: eppDeliveries.createdAt,
    quantity: eppDeliveries.quantity, size: eppDeliveries.size, reason: eppDeliveries.reason, notes: eppDeliveries.notes,
    employeeId: employees.id, employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
    dni: employees.dni, position: employees.position, area: employees.area,
    productCode: products.code, productName: products.name, categoryName: categories.name, userName: users.name,
    voidedAt: eppDeliveries.voidedAt, voidReason: eppDeliveries.voidReason, voidedByName: voider.name,
  }).from(eppDeliveries)
    .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
    .innerJoin(products, eq(eppDeliveries.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(users, eq(eppDeliveries.userId, users.id))
    .leftJoin(voider, eq(eppDeliveries.voidedBy, voider.id))
    .where(where).orderBy(desc(eppDeliveries.deliveryDate), desc(eppDeliveries.createdAt)).$dynamic();

  const [rows, [{ total }]] = await Promise.all([
    limit ? base.limit(limit).offset(offset) : base,
    db.select({ total: count() }).from(eppDeliveries)
      .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
      .innerJoin(products, eq(eppDeliveries.productId, products.id)).where(where),
  ]);
  return { rows, total };
}

// ---------- Trabajadores ----------
export async function listEmployees(opts: { q?: string; area?: string; state?: string; limit: number; offset: number }) {
  const where = and(
    opts.q ? or(ilike(employees.firstName, like(opts.q)), ilike(employees.lastName, like(opts.q)), ilike(employees.dni, like(opts.q)), ilike(employees.position, like(opts.q))) : undefined,
    opts.area ? eq(employees.area, opts.area) : undefined,
    opts.state === "inactivos" ? eq(employees.active, false) : opts.state === "todos" ? undefined : eq(employees.active, true),
  );
  const deliveredCount = db.$with("dc").as(
    db.select({ employeeId: eppDeliveries.employeeId, n: sql<number>`sum(${eppDeliveries.quantity})::int`.as("n") }).from(eppDeliveries).where(isNull(eppDeliveries.voidedAt)).groupBy(eppDeliveries.employeeId),
  );
  const [rows, [{ total }]] = await Promise.all([
    db.with(deliveredCount).select({
      id: employees.id, dni: employees.dni, firstName: employees.firstName, lastName: employees.lastName,
      position: employees.position, area: employees.area, phone: employees.phone, hireDate: employees.hireDate,
      notes: employees.notes, active: employees.active, isDemo: employees.isDemo,
      delivered: sql<number>`coalesce(${deliveredCount.n}, 0)`,
    }).from(employees).leftJoin(deliveredCount, eq(deliveredCount.employeeId, employees.id))
      .where(where).orderBy(asc(employees.lastName), asc(employees.firstName)).limit(opts.limit).offset(opts.offset),
    db.select({ total: count() }).from(employees).where(where),
  ]);
  return { rows, total };
}
export type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>["rows"][number];

export async function getAreaOptions() {
  const rows = await db.selectDistinct({ area: employees.area }).from(employees).orderBy(asc(employees.area));
  return rows.map((r) => r.area);
}

export async function getEmployee(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [emp] = await db.select().from(employees).where(eq(employees.id, id));
  return emp ?? null;
}

// ---------- Categorías ----------
export async function listCategories() {
  return db.select({
    id: categories.id, name: categories.name, description: categories.description, active: categories.active, isDemo: categories.isDemo,
    createdAt: categories.createdAt,
    // La columna de la tabla externa se escribe calificada a mano: dentro de la subconsulta,
    // un `"id"` suelto lo resolvería Postgres contra products, no contra categories.
    productCount: sql<number>`(select count(*)::int from ${products} p where p.category_id = ${sql.raw('"categories"."id"')} and p.active)`,
  }).from(categories).orderBy(asc(categories.name));
}

// ---------- Usuarios ----------
export async function listUsers() {
  return db.select({ id: users.id, name: users.name, username: users.username, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt })
    .from(users).orderBy(asc(users.name));
}

// ---------- Auditoría ----------
export async function listAudit(opts: { module?: string; userId?: string; from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const where = and(
    opts.module ? eq(auditLogs.module, opts.module) : undefined,
    opts.userId ? eq(auditLogs.userId, opts.userId) : undefined,
    opts.from ? gte(auditLogs.createdAt, limaDayStart(opts.from)) : undefined,
    opts.to ? lte(auditLogs.createdAt, limaDayEnd(opts.to)) : undefined,
    opts.q ? ilike(auditLogs.description, like(opts.q)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(opts.limit).offset(opts.offset),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);
  return { rows, total };
}

// ---------- Dashboard ----------
export async function getDashboard(period: { from: string; to: string }) {
  const monthStart = limaDayStart(limaMonthStartYmd());
  const [
    [totals], [monthly], [delivered], lowStock, recentMovements, recentDeliveries, chart,
  ] = await Promise.all([
    db.select({
      products: count(),
      stock: sql<number>`coalesce(sum(${products.stock}), 0)::int`,
      low: sql<number>`count(*) filter (where ${products.stock} <= ${products.minimumStock})::int`,
      out: sql<number>`count(*) filter (where ${products.stock} <= 0)::int`,
    }).from(products).where(eq(products.active, true)),
    db.select({
      entries: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.type} = 'ENTRADA'), 0)::int`,
      exits: sql<number>`coalesce(sum(${inventoryMovements.quantity}) filter (where ${inventoryMovements.type} = 'SALIDA'), 0)::int`,
      entryCount: sql<number>`count(*) filter (where ${inventoryMovements.type} = 'ENTRADA')::int`,
      exitCount: sql<number>`count(*) filter (where ${inventoryMovements.type} = 'SALIDA')::int`,
      adjustCount: sql<number>`count(*) filter (where ${inventoryMovements.type} = 'AJUSTE')::int`,
    }).from(inventoryMovements).where(gte(inventoryMovements.createdAt, monthStart)),
    db.select({
      units: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      deliveries: count(),
      people: sql<number>`count(distinct ${eppDeliveries.employeeId})::int`,
    }).from(eppDeliveries).where(and(isNull(eppDeliveries.voidedAt), gte(eppDeliveries.deliveryDate, period.from), lte(eppDeliveries.deliveryDate, period.to))),
    db.select({
      id: products.id, code: products.code, name: products.name, size: products.size, stock: products.stock, minimumStock: products.minimumStock, unit: products.unit,
    }).from(products).where(and(eq(products.active, true), sql`${products.stock} <= ${products.minimumStock}`))
      .orderBy(asc(products.stock), asc(products.name)).limit(8),
    listMovements({}, 6).then((r) => r.rows),
    listDeliveries({ deliveryState: "VIGENTE" }, 6).then((r) => r.rows),
    db.execute<{ day: string; entradas: number; salidas: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day,
        coalesce(sum(m.quantity) filter (where m.type = 'ENTRADA'), 0)::int as entradas,
        coalesce(sum(m.quantity) filter (where m.type = 'SALIDA'), 0)::int as salidas
      from generate_series((${todayLima()}::date - 29), ${todayLima()}::date, interval '1 day') as d(day)
      left join ${inventoryMovements} m on (m.created_at at time zone 'America/Lima')::date = d.day
      group by d.day order by d.day`),
  ]);
  return { totals, monthly, delivered, lowStock, recentMovements, recentDeliveries, chart: Array.from(chart) };
}
