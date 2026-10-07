/**
 * Prueba del control de devolución de EPP al cese.
 *
 * Lo que importa aquí es que el pendiente sea siempre una resta —entregas vigentes menos
 * devoluciones— y no un estado guardado que pueda quedar desfasado. Se comprueba contra la
 * base real, porque la mitad del cálculo vive en SQL.
 *
 *   npx tsx --conditions=react-server tests/devoluciones.test.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, eppDeliveries, eppReturns, inventoryMovements, products, users,
} from "../src/db/schema";
import {
  employeeHoldings, listPendingReturns, listReturns, pendingReturnItems, pendingReturnsCount,
} from "../src/server/queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const DNI = "99000001";
const SELLO = `PRUEBA-DEV-${Date.now()}`;

/**
 * Deja stock suficiente antes de entregar. Sin esto la prueba se agota a sí misma: cada
 * corrida saca unidades y solo devuelve algunas, y a la tercera el stock daría negativo.
 */
async function reponer(productId: string, employeeId: string, cantidad: number) {
  const [admin] = await db.select().from(users).limit(1);
  const [p] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
  await db.insert(inventoryMovements).values({
    productId, type: "ENTRADA", quantity: cantidad,
    stockBefore: p.stock, stockAfter: p.stock + cantidad,
    reason: `${SELLO} reposición`, userId: admin.id, employeeId,
  });
  await db.update(products).set({ stock: p.stock + cantidad }).where(eq(products.id, productId));
}

/** Inserta una entrega con su movimiento de salida, como lo hace la pantalla. */
async function entregar(employeeId: string, productId: string, cantidad: number, fecha: string) {
  const [p] = await db.select({ stock: products.stock, size: products.size }).from(products).where(eq(products.id, productId));
  const [admin] = await db.select().from(users).limit(1);
  const [mov] = await db.insert(inventoryMovements).values({
    productId, type: "SALIDA", quantity: cantidad,
    stockBefore: p.stock, stockAfter: p.stock - cantidad,
    reason: SELLO, userId: admin.id, employeeId,
  }).returning();
  await db.update(products).set({ stock: p.stock - cantidad }).where(eq(products.id, productId));
  const [entrega] = await db.insert(eppDeliveries).values({
    employeeId, productId, movementId: mov.id, quantity: cantidad, size: p.size,
    deliveryDate: fecha, reason: SELLO, userId: admin.id,
  }).returning();
  return entrega;
}

/** Inserta una devolución; solo la reutilizable lleva movimiento de entrada. */
async function devolver(employeeId: string, productId: string, cantidad: number, condition: "REUTILIZABLE" | "DESCARTADO" | "NO_DEVUELTO") {
  const [admin] = await db.select().from(users).limit(1);
  let movementId: string | null = null;
  if (condition === "REUTILIZABLE") {
    const [p] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
    const [mov] = await db.insert(inventoryMovements).values({
      productId, type: "ENTRADA", quantity: cantidad,
      stockBefore: p.stock, stockAfter: p.stock + cantidad,
      reason: SELLO, userId: admin.id, employeeId,
    }).returning();
    await db.update(products).set({ stock: p.stock + cantidad }).where(eq(products.id, productId));
    movementId = mov.id;
  }
  return db.insert(eppReturns).values({
    employeeId, productId, quantity: cantidad, returnDate: "2026-10-01",
    condition, movementId, reason: SELLO, userId: admin.id,
    notes: condition === "NO_DEVUELTO" ? "Se perdió en obra" : null,
  }).returning();
}

async function rechaza(nombre: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(nombre, false, "no falló");
  } catch {
    check(nombre, true);
  }
}

async function main() {
  // Limpieza de corridas anteriores: primero lo que depende del trabajador.
  const viejos = await db.select({ id: employees.id }).from(employees).where(eq(employees.dni, DNI));
  for (const v of viejos) {
    await db.delete(eppReturns).where(eq(eppReturns.employeeId, v.id));
    await db.delete(eppDeliveries).where(eq(eppDeliveries.employeeId, v.id));
    await db.delete(inventoryMovements).where(eq(inventoryMovements.employeeId, v.id));
    await db.delete(employees).where(eq(employees.id, v.id));
  }

  const [casco, botas] = await db.select().from(products).where(sql`${products.active}`).limit(2);
  if (!casco || !botas) { console.log("FALTAN PRODUCTOS: corre npm run db:seed:demo"); process.exit(1); }

  const [trabajador] = await db.insert(employees).values({
    dni: DNI, firstName: "Prueba", lastName: "Devolución", position: "Operario",
    area: "Almacén", hireDate: "2026-01-02", isDemo: true,
  }).returning();

  await reponer(casco.id, trabajador.id, 20);
  await reponer(botas.id, trabajador.id, 20);

  // ---------- Lo entregado es lo que está a su cargo ----------
  await entregar(trabajador.id, casco.id, 3, "2026-02-10");
  await entregar(trabajador.id, botas.id, 1, "2026-02-10");

  let h = await employeeHoldings(trabajador.id);
  const delCasco = () => h.find((x) => x.productId === casco.id)!;
  check("dos tipos de EPP a su cargo", h.length === 2, h.map((x) => x.productName));
  check("el casco suma 3 entregados y 3 pendientes", delCasco().entregado === 3 && delCasco().pendiente === 3, delCasco());
  check("sin devoluciones, devuelto es 0", delCasco().devuelto === 0);

  // ---------- Una entrega anulada no está a su cargo ----------
  const anulada = await entregar(trabajador.id, casco.id, 5, "2026-03-01");
  await db.update(eppDeliveries)
    .set({ voidedAt: new Date(), voidReason: "Prueba", voidMovementId: null })
    .where(eq(eppDeliveries.id, anulada.id))
    .catch(() => null);
  // La restricción exige que la anulación lleve su movimiento: se anula como lo hace la
  // pantalla, con la entrada vinculada.
  const [admin] = await db.select().from(users).limit(1);
  const [p] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, casco.id));
  const [vuelta] = await db.insert(inventoryMovements).values({
    productId: casco.id, type: "ENTRADA", quantity: 5, stockBefore: p.stock, stockAfter: p.stock + 5,
    reason: `${SELLO} anulación`, userId: admin.id, employeeId: trabajador.id,
  }).returning();
  await db.update(eppDeliveries)
    .set({ voidedAt: new Date(), voidedBy: admin.id, voidReason: "Prueba", voidMovementId: vuelta.id })
    .where(eq(eppDeliveries.id, anulada.id));

  h = await employeeHoldings(trabajador.id);
  check("la entrega anulada no suma al pendiente", delCasco().pendiente === 3, delCasco());

  // ---------- Devolver descuenta ----------
  await devolver(trabajador.id, casco.id, 1, "REUTILIZABLE");
  h = await employeeHoldings(trabajador.id);
  check("tras devolver 1, quedan 2 pendientes", delCasco().pendiente === 2, delCasco());
  check("la devolución reutilizable se cuenta aparte", delCasco().reutilizable === 1 && delCasco().descartado === 0, delCasco());

  await devolver(trabajador.id, casco.id, 1, "DESCARTADO");
  h = await employeeHoldings(trabajador.id);
  check("lo descartado también descuenta", delCasco().pendiente === 1, delCasco());

  // Lo que no devolvió deja de ser pendiente: ya se dio cuenta de la pérdida.
  await devolver(trabajador.id, casco.id, 1, "NO_DEVUELTO");
  h = await employeeHoldings(trabajador.id);
  check("lo no devuelto cierra el pendiente del casco", delCasco().pendiente === 0, delCasco());
  check("queda registrado como no devuelto", delCasco().noDevuelto === 1, delCasco());

  // ---------- Mientras no cese, no se le reclama ----------
  let pendientes = await listPendingReturns();
  check("un trabajador activo no aparece en devoluciones pendientes",
    !pendientes.some((x) => x.employeeId === trabajador.id), pendientes.map((x) => x.employeeName));

  pendientes = await listPendingReturns({ includeActive: true });
  const fila = pendientes.find((x) => x.employeeId === trabajador.id);
  check("con «ver también activos» sí aparece", !!fila);
  check("solo figura el EPP que todavía tiene", fila?.unidades === 1 && fila?.tipos === 1, fila);
  check("el detalle nombra el EPP pendiente", !!fila?.detalle.includes(botas.name), fila?.detalle);

  // ---------- Al cesar, se le reclama ----------
  const antes = await pendingReturnsCount();
  await db.update(employees)
    .set({ terminatedAt: "2026-09-20", terminationReason: "Prueba", active: false })
    .where(eq(employees.id, trabajador.id));

  pendientes = await listPendingReturns();
  const cesado = pendientes.find((x) => x.employeeId === trabajador.id);
  check("el cesado con EPP aparece en la lista", !!cesado, pendientes.length);
  check("trae la fecha de cese y los días transcurridos", cesado?.terminatedAt === "2026-09-20" && (cesado?.dias ?? 0) > 0, cesado);

  const despues = await pendingReturnsCount();
  check("el contador del aviso sube en un trabajador", despues.trabajadores === antes.trabajadores + 1, { antes, despues });
  check("el contador suma la unidad que falta", despues.unidades === antes.unidades + 1, { antes, despues });

  const items = await pendingReturnItems();
  const suyos = items.get(trabajador.id) ?? [];
  check("el desglose para el modal ofrece solo lo pendiente", suyos.length === 1 && suyos[0].pendiente === 1, suyos);

  // ---------- Saldar lo último lo saca de la lista ----------
  await devolver(trabajador.id, botas.id, 1, "REUTILIZABLE");
  pendientes = await listPendingReturns();
  check("saldado, el cesado desaparece de la lista",
    !pendientes.some((x) => x.employeeId === trabajador.id), pendientes.map((x) => x.employeeName));
  const final = await pendingReturnsCount();
  check("y el contador vuelve a su valor", final.trabajadores === antes.trabajadores && final.unidades === antes.unidades, { antes, final });

  // Tres del casco (reutilizable, descartado, no devuelto) y una de las botas.
  const historial = await listReturns({ employeeId: trabajador.id });
  check("el historial guarda las cuatro devoluciones", historial.total === 4, historial.total);
  check("el filtro por condición funciona",
    (await listReturns({ employeeId: trabajador.id, condition: "NO_DEVUELTO" })).total === 1);

  // ---------- La base no deja estados imposibles ----------
  await rechaza("rechaza una devolución reutilizable sin movimiento de entrada", () =>
    db.insert(eppReturns).values({
      employeeId: trabajador.id, productId: casco.id, quantity: 1, returnDate: "2026-10-01",
      condition: "REUTILIZABLE", movementId: null, reason: SELLO, userId: admin.id,
    }));

  await rechaza("rechaza una devolución descartada que mueva stock", () =>
    db.insert(eppReturns).values({
      employeeId: trabajador.id, productId: casco.id, quantity: 1, returnDate: "2026-10-01",
      condition: "DESCARTADO", movementId: vuelta.id, reason: SELLO, userId: admin.id,
    }));

  await rechaza("rechaza una devolución de cantidad 0", () =>
    db.insert(eppReturns).values({
      employeeId: trabajador.id, productId: casco.id, quantity: 0, returnDate: "2026-10-01",
      condition: "NO_DEVUELTO", movementId: null, reason: SELLO, userId: admin.id,
    }));

  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
