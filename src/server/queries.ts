import "server-only";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  auditLogs, categories, employees, eppDeliveries, eppReturns, inventoryMovements, products, users,
  type MovementType, type ReturnCondition,
} from "@/db/schema";
import { first, isYmd, limaDayEnd, limaDayStart, limaMonthStartYmd, type SearchParamsRecord, type StockStatus, todayLima } from "@/lib/utils";

const like = (v: string) => `%${v.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

// ---------- Filtros compartidos ----------
export type ReportFilters = {
  from?: string; to?: string; productId?: string; categoryId?: string;
  employeeId?: string; userId?: string; type?: MovementType; status?: StockStatus; q?: string;
  /** Entregas: VIGENTE (no anuladas) o ANULADA. Sin valor: todas. */
  deliveryState?: DeliveryState;
  /** Devoluciones: en qué estado volvió el EPP. Sin valor: todas. */
  condition?: ReturnCondition;
};
export type DeliveryState = "VIGENTE" | "ANULADA";
export const DELIVERY_STATE_LABEL: Record<DeliveryState, string> = { VIGENTE: "Vigentes", ANULADA: "Anuladas" };

export function readFilters(sp: SearchParamsRecord): ReportFilters {
  const type = first(sp.type);
  const status = first(sp.status);
  const from = first(sp.from);
  const to = first(sp.to);
  const estado = first(sp.estado);
  const condicion = first(sp.condicion);
  return {
    condition: condicion === "REUTILIZABLE" || condicion === "DESCARTADO" || condicion === "NO_DEVUELTO" ? condicion : undefined,
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

  /**
   * Lo que entró y lo que se entregó, por producto.
   *
   * Se calculan desde los movimientos, no desde una columna guardada: así la resta
   * siempre cuadra con el stock, incluso cuando hubo mermas, traslados o ajustes. Lo que
   * no es ninguna de las dos cosas sale como "otros" en la pantalla, para que el número
   * nunca parezca estar mal sin explicación.
   */
  const elProducto = sql.raw('"products"."id"');
  const ingresado = sql<number>`(select coalesce(sum(m.quantity), 0)::int from ${inventoryMovements} m
    where m.product_id = ${elProducto} and m.type = 'ENTRADA')`;
  const entregado = sql<number>`(select coalesce(sum(m.quantity), 0)::int from ${inventoryMovements} m
    where m.product_id = ${elProducto} and m.type = 'SALIDA' and m.employee_id is not null)`;

  const query = db.select({
    id: products.id, code: products.code, name: products.name, categoryId: products.categoryId, categoryName: categories.name,
    description: products.description, brand: products.brand, size: products.size, color: products.color, unit: products.unit,
    stock: products.stock, minimumStock: products.minimumStock, notes: products.notes, updatedAt: products.updatedAt, isDemo: products.isDemo,
    ingresado, entregado,
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

/**
 * Resumen de las entregas: lo mismo que muestra el listado, pero sumado.
 *
 * Responde de un vistazo qué EPP salió del almacén y a quién, sin tener que entrar
 * trabajador por trabajador. Usa exactamente los mismos filtros que el listado, así que
 * los totales siempre cuadran con las filas que se están viendo.
 *
 * Las entregas anuladas no suman: devolvieron su stock, así que contarlas abultaría
 * los totales con unidades que nunca salieron.
 */
export async function deliverySummary(f: ReportFilters) {
  const where = and(
    f.from ? gte(eppDeliveries.deliveryDate, f.from) : undefined,
    f.to ? lte(eppDeliveries.deliveryDate, f.to) : undefined,
    f.productId ? eq(eppDeliveries.productId, f.productId) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.employeeId ? eq(eppDeliveries.employeeId, f.employeeId) : undefined,
    f.q ? or(ilike(employees.firstName, like(f.q)), ilike(employees.lastName, like(f.q)), ilike(employees.dni, like(f.q)), ilike(products.name, like(f.q))) : undefined,
    isNull(eppDeliveries.voidedAt),
  );

  const [[totales], porProducto, porTrabajador, desglose] = await Promise.all([
    db.select({
      unidades: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      entregas: count(),
      trabajadores: sql<number>`count(distinct ${eppDeliveries.employeeId})::int`,
      tiposEpp: sql<number>`count(distinct ${eppDeliveries.productId})::int`,
    }).from(eppDeliveries)
      .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
      .innerJoin(products, eq(eppDeliveries.productId, products.id))
      .where(where),

    db.select({
      productId: products.id,
      productCode: products.code,
      productName: products.name,
      categoryName: categories.name,
      unit: products.unit,
      stock: products.stock,
      minimumStock: products.minimumStock,
      unidades: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      entregas: count(),
      trabajadores: sql<number>`count(distinct ${eppDeliveries.employeeId})::int`,
      ultima: sql<string>`max(${eppDeliveries.deliveryDate})::text`,
    }).from(eppDeliveries)
      .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
      .innerJoin(products, eq(eppDeliveries.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .groupBy(products.id, products.code, products.name, categories.name, products.unit, products.stock, products.minimumStock)
      .orderBy(desc(sql`sum(${eppDeliveries.quantity})`)),

    db.select({
      employeeId: employees.id,
      employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
      dni: employees.dni,
      position: employees.position,
      area: employees.area,
      unidades: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      entregas: count(),
      tiposEpp: sql<number>`count(distinct ${eppDeliveries.productId})::int`,
      ultima: sql<string>`max(${eppDeliveries.deliveryDate})::text`,
    }).from(eppDeliveries)
      .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
      .innerJoin(products, eq(eppDeliveries.productId, products.id))
      .where(where)
      .groupBy(employees.id, employees.firstName, employees.lastName, employees.dni, employees.position, employees.area)
      .orderBy(desc(sql`sum(${eppDeliveries.quantity})`)),

    // Qué EPP recibió cada trabajador, no solo cuántas unidades. Es la misma suma abierta
    // por producto: sirve para saber si al almacenero le falta entregarle algo o si ya
    // tiene de todo. Un producto es de una sola talla, así que agrupar por producto basta.
    db.select({
      employeeId: eppDeliveries.employeeId,
      productId: products.id,
      productName: products.name,
      size: products.size,
      unit: products.unit,
      unidades: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      ultima: sql<string>`max(${eppDeliveries.deliveryDate})::text`,
    }).from(eppDeliveries)
      .innerJoin(employees, eq(eppDeliveries.employeeId, employees.id))
      .innerJoin(products, eq(eppDeliveries.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(where)
      .groupBy(eppDeliveries.employeeId, products.id, products.name, products.size, products.unit)
      .orderBy(desc(sql`sum(${eppDeliveries.quantity})`), asc(products.name)),
  ]);

  const porEmpleado = new Map<string, EppBreakdown[]>();
  for (const d of desglose) {
    const lista = porEmpleado.get(d.employeeId);
    const item = { productId: d.productId, productName: d.productName, size: d.size, unit: d.unit, unidades: d.unidades, ultima: d.ultima };
    if (lista) lista.push(item);
    else porEmpleado.set(d.employeeId, [item]);
  }

  return {
    unidades: totales?.unidades ?? 0,
    entregas: totales?.entregas ?? 0,
    trabajadores: totales?.trabajadores ?? 0,
    tiposEpp: totales?.tiposEpp ?? 0,
    porProducto,
    porTrabajador: porTrabajador.map((e) => ({ ...e, epps: porEmpleado.get(e.employeeId) ?? [] })),
  };
}

export type EppBreakdown = {
  productId: string; productName: string; size: string | null; unit: string;
  unidades: number; ultima: string;
};

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
      terminatedAt: employees.terminatedAt, terminationReason: employees.terminationReason,
      // Hacen falta para que el botón de editar abra el formulario con lo que ya hay.
      address: employees.address,
      emergencyContactName: employees.emergencyContactName,
      emergencyContactPhone: employees.emergencyContactPhone,
      emergencyContactRelation: employees.emergencyContactRelation,
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

// ---------- EPP a cargo y devoluciones ----------

/**
 * Qué EPP tiene a su cargo un trabajador: entregas vigentes menos lo que ya devolvió.
 *
 * Las tres condiciones de devolución descuentan. Un EPP que el trabajador no entregó
 * (NO_DEVUELTO) también deja de estar pendiente: ya se dio cuenta de la pérdida y seguir
 * reclamándolo solo mantendría un aviso que nadie puede cerrar.
 *
 * Se resuelve en dos consultas agrupadas y se cruzan en memoria: son pocas filas por
 * trabajador, y así se evita una subconsulta correlacionada.
 */
export async function employeeHoldings(employeeId: string) {
  const [entregado, devuelto] = await Promise.all([
    db.select({
      productId: products.id,
      productCode: products.code,
      productName: products.name,
      categoryName: categories.name,
      size: products.size,
      unit: products.unit,
      entregado: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      ultima: sql<string>`max(${eppDeliveries.deliveryDate})::text`,
    }).from(eppDeliveries)
      .innerJoin(products, eq(eppDeliveries.productId, products.id))
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .where(and(eq(eppDeliveries.employeeId, employeeId), isNull(eppDeliveries.voidedAt)))
      .groupBy(products.id, products.code, products.name, categories.name, products.size, products.unit),

    db.select({
      productId: eppReturns.productId,
      devuelto: sql<number>`coalesce(sum(${eppReturns.quantity}), 0)::int`,
      reutilizable: sql<number>`coalesce(sum(${eppReturns.quantity}) filter (where ${eppReturns.condition} = 'REUTILIZABLE'), 0)::int`,
      descartado: sql<number>`coalesce(sum(${eppReturns.quantity}) filter (where ${eppReturns.condition} = 'DESCARTADO'), 0)::int`,
      noDevuelto: sql<number>`coalesce(sum(${eppReturns.quantity}) filter (where ${eppReturns.condition} = 'NO_DEVUELTO'), 0)::int`,
    }).from(eppReturns)
      .where(eq(eppReturns.employeeId, employeeId))
      .groupBy(eppReturns.productId),
  ]);

  const porProducto = new Map(devuelto.map((d) => [d.productId, d]));
  return entregado
    .map((e) => {
      const d = porProducto.get(e.productId);
      return {
        ...e,
        devuelto: d?.devuelto ?? 0,
        reutilizable: d?.reutilizable ?? 0,
        descartado: d?.descartado ?? 0,
        noDevuelto: d?.noDevuelto ?? 0,
        pendiente: Math.max(0, e.entregado - (d?.devuelto ?? 0)),
      };
    })
    .sort((a, b) => b.pendiente - a.pendiente || a.productName.localeCompare(b.productName, "es"));
}
export type Holding = Awaited<ReturnType<typeof employeeHoldings>>[number];

/**
 * El pendiente de EPP por trabajador, en SQL.
 *
 * Se escribe a mano porque son dos agregados cruzados, y así queda a la vista que el
 * pendiente es una resta y no un estado guardado: no hay forma de que un trabajador
 * aparezca debiendo algo que ya devolvió.
 */
const PENDIENTE_POR_TRABAJADOR = sql`
  with entregado as (
    select employee_id, product_id, sum(quantity)::int as q, max(delivery_date) as ultima
    from epp_deliveries where voided_at is null group by employee_id, product_id
  ), devuelto as (
    select employee_id, product_id, sum(quantity)::int as q
    from epp_returns group by employee_id, product_id
  ), pendiente as (
    select e.employee_id, e.product_id, e.ultima, (e.q - coalesce(d.q, 0)) as q
    from entregado e
    left join devuelto d on d.employee_id = e.employee_id and d.product_id = e.product_id
    where (e.q - coalesce(d.q, 0)) > 0
  )
`;

export type PendingReturn = {
  employeeId: string;
  employeeName: string;
  dni: string;
  position: string;
  area: string;
  active: boolean;
  terminatedAt: string | null;
  terminationReason: string | null;
  unidades: number;
  tipos: number;
  detalle: string;
  ultima: string | null;
  dias: number;
};

/**
 * Trabajadores cesados que todavía tienen EPP a su cargo.
 *
 * Es la lista de la pantalla de devoluciones y la que alimenta el aviso: mientras un
 * cesado tenga algo pendiente, el sistema lo recuerda.
 */
export async function listPendingReturns(opts: { q?: string; includeActive?: boolean } = {}) {
  const filtroCese = opts.includeActive ? sql`true` : sql`emp.terminated_at is not null`;
  const filtroTexto = opts.q
    ? sql`and (emp.first_name ilike ${like(opts.q)} or emp.last_name ilike ${like(opts.q)} or emp.dni ilike ${like(opts.q)})`
    : sql``;

  const rows = await db.execute<PendingReturn & { dias: string | number }>(sql`
    ${PENDIENTE_POR_TRABAJADOR}
    select
      emp.id as "employeeId",
      emp.first_name || ' ' || emp.last_name as "employeeName",
      emp.dni, emp.position, emp.area, emp.active,
      emp.terminated_at::text as "terminatedAt",
      emp.termination_reason as "terminationReason",
      sum(p.q)::int as unidades,
      count(*)::int as tipos,
      string_agg(pr.name || coalesce(' ' || pr.size, '') || ' ×' || p.q, ', ' order by pr.name, pr.size) as detalle,
      max(p.ultima)::text as ultima,
      coalesce((${todayLima()}::date - emp.terminated_at), 0)::int as dias
    from pendiente p
    join employees emp on emp.id = p.employee_id
    join products pr on pr.id = p.product_id
    where ${filtroCese} ${filtroTexto}
    group by emp.id, emp.first_name, emp.last_name, emp.dni, emp.position, emp.area,
             emp.active, emp.terminated_at, emp.termination_reason
    order by emp.terminated_at asc nulls last, emp.last_name asc
  `);

  return Array.from(rows).map((r) => ({ ...r, dias: Number(r.dias) }));
}

export type PendingItemRow = {
  employeeId: string; productId: string; productName: string; size: string | null; unit: string; pendiente: number;
};

/**
 * El pendiente abierto por EPP, para todos los trabajadores de una vez.
 *
 * Es lo que necesita el modal de devolución para ofrecer solo lo que esa persona tiene a
 * su cargo. Va en una sola consulta: pedirlo trabajador por trabajador funcionaba, pero
 * eran dos consultas por fila de la tabla.
 */
export async function pendingReturnItems(opts: { includeActive?: boolean } = {}) {
  const filtroCese = opts.includeActive ? sql`true` : sql`emp.terminated_at is not null`;
  const rows = await db.execute<PendingItemRow & { pendiente: string | number }>(sql`
    ${PENDIENTE_POR_TRABAJADOR}
    select
      p.employee_id as "employeeId",
      pr.id as "productId",
      pr.name as "productName",
      pr.size,
      pr.unit,
      p.q as pendiente
    from pendiente p
    join employees emp on emp.id = p.employee_id
    join products pr on pr.id = p.product_id
    where ${filtroCese}
    order by pr.name asc
  `);

  const porTrabajador = new Map<string, PendingItemRow[]>();
  for (const r of Array.from(rows)) {
    const item = { ...r, pendiente: Number(r.pendiente) };
    const lista = porTrabajador.get(r.employeeId);
    if (lista) lista.push(item);
    else porTrabajador.set(r.employeeId, [item]);
  }
  return porTrabajador;
}

/** Para el aviso del menú y del dashboard: cuántos cesados deben EPP. */
export async function pendingReturnsCount() {
  const rows = await db.execute<{ trabajadores: number; unidades: number }>(sql`
    ${PENDIENTE_POR_TRABAJADOR}
    select count(distinct p.employee_id)::int as trabajadores, coalesce(sum(p.q), 0)::int as unidades
    from pendiente p
    join employees emp on emp.id = p.employee_id
    where emp.terminated_at is not null
  `);
  const [r] = Array.from(rows);
  return { trabajadores: Number(r?.trabajadores ?? 0), unidades: Number(r?.unidades ?? 0) };
}

/** Historial de devoluciones, con los mismos filtros que el resto de las pantallas. */
export async function listReturns(f: ReportFilters, limit?: number, offset = 0) {
  const where = and(
    f.from ? gte(eppReturns.returnDate, f.from) : undefined,
    f.to ? lte(eppReturns.returnDate, f.to) : undefined,
    f.productId ? eq(eppReturns.productId, f.productId) : undefined,
    f.categoryId ? eq(products.categoryId, f.categoryId) : undefined,
    f.employeeId ? eq(eppReturns.employeeId, f.employeeId) : undefined,
    f.condition ? eq(eppReturns.condition, f.condition) : undefined,
    f.q ? or(ilike(employees.firstName, like(f.q)), ilike(employees.lastName, like(f.q)), ilike(employees.dni, like(f.q)), ilike(products.name, like(f.q))) : undefined,
  );
  const base = db.select({
    id: eppReturns.id, returnDate: eppReturns.returnDate, quantity: eppReturns.quantity,
    size: eppReturns.size, condition: eppReturns.condition, reason: eppReturns.reason, notes: eppReturns.notes,
    employeeId: employees.id, employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
    dni: employees.dni, position: employees.position, area: employees.area,
    terminatedAt: employees.terminatedAt,
    productCode: products.code, productName: products.name, categoryName: categories.name,
    userName: users.name, createdAt: eppReturns.createdAt,
  }).from(eppReturns)
    .innerJoin(employees, eq(eppReturns.employeeId, employees.id))
    .innerJoin(products, eq(eppReturns.productId, products.id))
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .innerJoin(users, eq(eppReturns.userId, users.id))
    .where(where).orderBy(desc(eppReturns.returnDate), desc(eppReturns.createdAt)).$dynamic();

  const [rows, [{ total }]] = await Promise.all([
    limit ? base.limit(limit).offset(offset) : base,
    db.select({ total: count() }).from(eppReturns)
      .innerJoin(employees, eq(eppReturns.employeeId, employees.id))
      .innerJoin(products, eq(eppReturns.productId, products.id)).where(where),
  ]);
  return { rows, total };
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
