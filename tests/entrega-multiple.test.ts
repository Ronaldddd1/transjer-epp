/**
 * Entrega de varios EPP a un trabajador, de una sola vez.
 *
 * Lo que importa aquí es que entregar cuatro cosas juntas deje la base exactamente igual
 * que entregarlas una por una —mismo stock, mismo historial, mismo "a su cargo"— y que si
 * una sola falla no quede nada a medias: con el stock de dos EPP descontado y el de otros
 * dos no, nadie sabría en qué punto se cortó.
 *
 *   npx tsx --conditions=react-server tests/entrega-multiple.test.ts
 */
import "dotenv/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  categories, employees, eppDeliveries, inventoryMovements, products, users,
} from "../src/db/schema";
import { applyMovement } from "../src/server/inventory";
import type { CurrentUser } from "../src/lib/auth";
import { todayLima } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const PREFIJO = `ZE${SELLO}`;

/**
 * La misma regla que aplica la acción: las cantidades en cero se ignoran y todo lo demás
 * se registra dentro de UNA transacción.
 */
async function entregar(
  employeeId: string,
  user: CurrentUser,
  pedidos: { productId: string; quantity: number }[],
) {
  const conCantidad = pedidos.filter((p) => p.quantity > 0);
  if (conCantidad.length === 0) throw new Error("Escribe la cantidad de al menos un EPP.");

  return db.transaction(async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    let total = 0;
    for (const pedido of conCantidad) {
      const { movement, product } = await applyMovement(tx, {
        productId: pedido.productId,
        type: "SALIDA",
        quantity: pedido.quantity,
        reason: "Entrega a personal: Entrega inicial",
        employeeId: employee.id,
        user,
        auditDescription: `prueba`,
      });
      await tx.insert(eppDeliveries).values({
        employeeId: employee.id, productId: product.id, movementId: movement.id,
        quantity: pedido.quantity, size: product.size, deliveryDate: todayLima(),
        reason: "Entrega inicial", userId: user.id,
      });
      total += pedido.quantity;
    }
    return total;
  });
}

async function limpiar() {
  const ids = await db.select({ id: products.id }).from(products)
    .where(sql`${products.code} like ${PREFIJO + "%"}`);
  if (ids.length) {
    const lista = ids.map((p) => p.id);
    await db.delete(eppDeliveries).where(inArray(eppDeliveries.productId, lista));
    await db.delete(inventoryMovements).where(inArray(inventoryMovements.productId, lista));
    await db.delete(products).where(inArray(products.id, lista));
  }
  await db.delete(categories).where(eq(categories.name, `Prueba ${SELLO}`));
}

async function main() {
  await limpiar();

  const [usuario] = await db.select().from(users).limit(1);
  const quien = usuario as unknown as CurrentUser;
  const [trabajador] = await db.select().from(employees).where(eq(employees.active, true)).limit(1);
  if (!usuario || !trabajador) throw new Error("Hacen falta un usuario y un trabajador activos.");

  const [categoria] = await db.insert(categories).values({ name: `Prueba ${SELLO}` }).returning();

  // Cuatro EPP, como los que se entregan juntos de verdad. El stock entra por un
  // movimiento de ENTRADA, igual que en el alta real: así el inventario puede explicar
  // de dónde sale cada unidad.
  const stockInicial = [20, 15, 10, 4];
  const creados: (typeof products.$inferSelect)[] = [];
  for (let i = 0; i < 4; i++) {
    const [p] = await db.insert(products).values({
      code: `${PREFIJO}-${i}`, name: `EPP de prueba ${i}`, categoryId: categoria.id,
      unit: "Unidad", stock: 0, minimumStock: 1,
    }).returning();
    await db.transaction((tx) => applyMovement(tx, {
      productId: p.id, type: "ENTRADA", quantity: stockInicial[i], reason: "Compra", user: quien,
      auditDescription: "prueba",
    }));
    creados.push(p);
  }

  // ---------- Entregar cuatro cosas de una vez ----------
  const unidades = await entregar(trabajador.id, quien, [
    { productId: creados[0].id, quantity: 2 },
    { productId: creados[1].id, quantity: 1 },
    // El tercero va en cero: es como queda la lista al abrirla, y no debe registrarse.
    { productId: creados[2].id, quantity: 0 },
    { productId: creados[3].id, quantity: 3 },
  ]);
  check("se entregan solo los que tienen cantidad", unidades === 6, unidades);

  const stocks = await db.select({ code: products.code, stock: products.stock })
    .from(products).where(inArray(products.id, creados.map((p) => p.id)));
  const por = (i: number) => stocks.find((s) => s.code === `${PREFIJO}-${i}`)?.stock;
  check("el stock del primero bajó 2", por(0) === 18, por(0));
  check("el del segundo bajó 1", por(1) === 14, por(1));
  check("el que iba en cero no se tocó", por(2) === 10, por(2));
  check("el del cuarto bajó 3", por(3) === 1, por(3));

  const entregas = await db.select().from(eppDeliveries)
    .where(and(eq(eppDeliveries.employeeId, trabajador.id), inArray(eppDeliveries.productId, creados.map((p) => p.id))));
  check("queda una entrega por cada EPP, no una sola", entregas.length === 3, entregas.length);
  check("todas con la misma fecha", new Set(entregas.map((e) => e.deliveryDate)).size === 1);
  check("todas con el mismo motivo", new Set(entregas.map((e) => e.reason)).size === 1);
  check("cada una guarda su cantidad",
    entregas.map((e) => e.quantity).sort().join(",") === "1,2,3",
    entregas.map((e) => e.quantity));

  // Cada entrega tiene su movimiento de salida: así el historial del EPP cuadra con su
  // stock, igual que cuando se entregaba uno por uno.
  const movimientos = await db.select().from(inventoryMovements)
    .where(and(inArray(inventoryMovements.productId, creados.map((p) => p.id)), eq(inventoryMovements.type, "SALIDA")));
  check("cada entrega dejó su movimiento de salida", movimientos.length === 3, movimientos.length);
  check("y todos quedaron a nombre del trabajador",
    movimientos.every((m) => m.employeeId === trabajador.id));

  // ---------- Si una falla, no se registra ninguna ----------
  // Al cuarto le quedaba 1 y se le piden 5: la entrega entera tiene que caerse.
  const antes = await db.select({ stock: products.stock }).from(products).where(eq(products.id, creados[0].id));
  let error = "no falló";
  try {
    await entregar(trabajador.id, quien, [
      { productId: creados[0].id, quantity: 1 },
      { productId: creados[3].id, quantity: 5 },
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check("una cantidad mayor al stock corta la entrega", error.includes("suficiente stock"), error);

  const despues = await db.select({ stock: products.stock }).from(products).where(eq(products.id, creados[0].id));
  check("y no deja nada a medias: el primero conserva su stock",
    despues[0].stock === antes[0].stock, { antes: antes[0].stock, despues: despues[0].stock });

  const total = await db.select({ n: sql<number>`count(*)::int` }).from(eppDeliveries)
    .where(inArray(eppDeliveries.productId, creados.map((p) => p.id)));
  check("ni entregas de más", total[0].n === 3, total[0].n);

  // ---------- Todo en cero no es una entrega ----------
  let vacio = "no falló";
  try {
    await entregar(trabajador.id, quien, [{ productId: creados[0].id, quantity: 0 }]);
  } catch (e) {
    vacio = e instanceof Error ? e.message : String(e);
  }
  check("sin ninguna cantidad no se registra nada", vacio.includes("al menos un EPP"), vacio);

  // ---------- Ingresado y entregado, como los muestra el inventario ----------
  const [fila] = await db.select({
    ingresado: sql<number>`(select coalesce(sum(m.quantity),0)::int from inventory_movements m
      where m.product_id = ${creados[0].id} and m.type = 'ENTRADA')`,
    entregado: sql<number>`(select coalesce(sum(m.quantity),0)::int from inventory_movements m
      where m.product_id = ${creados[0].id} and m.type = 'SALIDA' and m.employee_id is not null)`,
    stock: products.stock,
  }).from(products).where(eq(products.id, creados[0].id));
  check("lo ingresado es todo lo que entró", fila.ingresado === 20, fila);
  check("lo entregado se cuenta aparte", fila.entregado === 2, fila);
  check("y la resta da exactamente el stock", fila.ingresado - fila.entregado === fila.stock, fila);

  // Una merma no es una entrega: no debe contarse como entregado, pero sí explica que la
  // resta deje de cuadrar. Es justo lo que la pantalla muestra como "otros".
  await db.transaction((tx) => applyMovement(tx, {
    productId: creados[0].id, type: "SALIDA", quantity: 3, reason: "Merma / deterioro", user: quien,
    auditDescription: "prueba",
  }));
  const [conMerma] = await db.select({
    ingresado: sql<number>`(select coalesce(sum(m.quantity),0)::int from inventory_movements m
      where m.product_id = ${creados[0].id} and m.type = 'ENTRADA')`,
    entregado: sql<number>`(select coalesce(sum(m.quantity),0)::int from inventory_movements m
      where m.product_id = ${creados[0].id} and m.type = 'SALIDA' and m.employee_id is not null)`,
    stock: products.stock,
  }).from(products).where(eq(products.id, creados[0].id));
  check("una merma no cuenta como entregada", conMerma.entregado === 2, conMerma);
  check("y aparece como diferencia, no como error",
    conMerma.stock - (conMerma.ingresado - conMerma.entregado) === -3, conMerma);

  await limpiar();
  console.log(fails === 0 ? "\nENTREGA MÚLTIPLE: todo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
