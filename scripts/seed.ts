/**
 * Seed inicial.
 *   npm run db:seed        → categorías base + usuario administrador (desde variables ADMIN_*)
 *   npm run db:seed:demo   → además crea productos, trabajadores y movimientos de PRUEBA (is_demo = true)
 * Los datos de prueba se eliminan con: npm run db:clear-demo
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";

const { users, categories, products, employees, inventoryMovements, eppDeliveries, auditLogs, suppliers, supplierInvoices } = schema;

const BASE_CATEGORIES: [string, string][] = [
  ["Protección de cabeza", "Cascos y accesorios de protección craneal."],
  ["Protección de manos", "Guantes de seguridad para distintos riesgos."],
  ["Protección visual", "Lentes y caretas de seguridad."],
  ["Protección auditiva", "Tapones y orejeras."],
  ["Protección respiratoria", "Respiradores y mascarillas."],
  ["Protección de pies", "Calzado de seguridad."],
  ["Alta visibilidad", "Chalecos y prendas reflectivas."],
  ["Protección corporal", "Mamelucos, casacas y ropa de trabajo."],
  ["Otros", "EPP que no encaja en otra categoría."],
];

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Define DATABASE_URL en tu archivo .env");
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });
  const withDemo = process.argv.includes("--demo");

  // 1. Administrador
  const email = (process.env.ADMIN_EMAIL ?? "admin@transjer.pe").toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  let [admin] = await db.select().from(users).where(eq(users.email, email));
  if (!admin) {
    if (!password || password.length < 8) throw new Error("Define ADMIN_PASSWORD (mínimo 8 caracteres) para crear el administrador.");
    [admin] = await db.insert(users).values({
      name: process.env.ADMIN_NAME ?? "Administrador",
      username: email.split("@")[0].replace(/[^a-z0-9._-]/g, "") || "admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "ADMIN",
    }).returning();
    console.log(`✔ Administrador creado: ${admin.username} / ${admin.email}`);
  } else {
    console.log(`• El administrador ${admin.email} ya existe`);
  }

  // 2. Categorías base (no son de prueba: son parte de la configuración)
  for (const [name, description] of BASE_CATEGORIES) {
    await db.insert(categories).values({ name, description }).onConflictDoNothing({ target: categories.name });
  }
  console.log(`✔ ${BASE_CATEGORIES.length} categorías base verificadas`);

  if (!withDemo) {
    await client.end();
    return;
  }

  // 3. Datos de PRUEBA
  const existingDemo = await db.select({ id: products.id }).from(products).where(eq(products.isDemo, true)).limit(1);
  if (existingDemo.length) {
    console.log("• Los datos de prueba ya existen. Ejecuta npm run db:clear-demo para reiniciarlos.");
    await client.end();
    return;
  }

  const cats = Object.fromEntries((await db.select().from(categories)).map((c) => [c.name, c.id]));
  const demoProducts = [
    ["DEMO-001", "Casco de seguridad", "Protección de cabeza", "3M", "Única", "Amarillo", "Unidad", 25, 10],
    ["DEMO-002", "Guantes de seguridad", "Protección de manos", "Steelpro", "M", "Gris", "Par", 8, 10],
    ["DEMO-003", "Guantes de seguridad", "Protección de manos", "Steelpro", "L", "Gris", "Par", 30, 10],
    ["DEMO-004", "Chaleco reflectivo", "Alta visibilidad", "Genérico", "L", "Naranja", "Unidad", 0, 5],
    ["DEMO-005", "Chaleco reflectivo", "Alta visibilidad", "Genérico", "M", "Naranja", "Unidad", 14, 5],
    ["DEMO-006", "Lentes de seguridad", "Protección visual", "Libus", "Única", "Transparente", "Unidad", 40, 15],
    ["DEMO-007", "Botas de seguridad", "Protección de pies", "Segusa", "42", "Negro", "Par", 6, 4],
    ["DEMO-008", "Botas de seguridad", "Protección de pies", "Segusa", "40", "Negro", "Par", 3, 4],
    ["DEMO-009", "Protector auditivo", "Protección auditiva", "3M", "Única", "Naranja", "Par", 60, 20],
    ["DEMO-010", "Respirador media cara", "Protección respiratoria", "3M", "M", "Gris", "Unidad", 12, 5],
  ] as const;

  const createdProducts = await db.insert(products).values(demoProducts.map(([code, name, cat, brand, size, color, unit, , min]) => ({
    code, name, categoryId: cats[cat], brand, size, color, unit, minimumStock: min, stock: 0, isDemo: true,
    description: "Producto de prueba",
  }))).returning();

  const createdEmployees = await db.insert(employees).values([
    ["70000001", "Juan", "Pérez Quispe", "Conductor", "Flota"],
    ["70000002", "María", "Huamán Rojas", "Operario de almacén", "Almacén"],
    ["70000003", "Carlos", "Ramírez Soto", "Conductor", "Flota"],
    ["70000004", "Lucía", "Torres Vega", "Supervisor de operaciones", "Operaciones"],
    ["70000005", "Pedro", "Castillo Flores", "Ayudante de reparto", "Operaciones"],
  ].map(([dni, firstName, lastName, position, area]) => ({
    dni, firstName, lastName, position, area, phone: "999000000", hireDate: "2025-03-01", isDemo: true,
  }))).returning();

  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
  const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);

  // Entrada de compra inicial (el doble del stock final) y entregas que dejan el stock deseado
  for (const [i, p] of createdProducts.entries()) {
    const target = demoProducts[i][7];
    const purchased = target + 6;
    const delivered = purchased - target;
    const [entry] = await db.insert(inventoryMovements).values({
      productId: p.id, type: "ENTRADA", quantity: purchased, stockBefore: 0, stockAfter: purchased,
      reason: "Compra", notes: "Dato de prueba", userId: admin.id, createdAt: daysAgo(25 - i),
    }).returning();
    let stock = entry.stockAfter;
    for (let k = 0; k < delivered; k++) {
      const emp = createdEmployees[(i + k) % createdEmployees.length];
      const when = daysAgo(20 - ((i * 3 + k * 2) % 19));
      const [mov] = await db.insert(inventoryMovements).values({
        productId: p.id, type: "SALIDA", quantity: 1, stockBefore: stock, stockAfter: stock - 1,
        reason: "Entrega a personal: Entrega inicial", employeeId: emp.id, userId: admin.id, createdAt: when,
      }).returning();
      stock -= 1;
      await db.insert(eppDeliveries).values({
        employeeId: emp.id, productId: p.id, movementId: mov.id, quantity: 1, size: p.size,
        deliveryDate: ymd(when), reason: k % 3 === 0 ? "Renovación" : "Entrega inicial", userId: admin.id, createdAt: when,
      });
    }
    await db.update(products).set({ stock }).where(eq(products.id, p.id));
  }

  // Proveedores y facturas de prueba (Administración y Finanzas)
  const demoSuppliers: [string, string, string][] = [
    ["20548392117", "TRANSPORTES ABC S.A.C.", "facturacion@transportesabc.pe"],
    ["20601234567", "LOGISTICA DEL NORTE E.I.R.L.", "admin@lognorte.pe"],
    ["20487654321", "CARGA SEGURA PERU S.A.C.", "ventas@cargasegura.pe"],
  ];
  const createdSuppliers = await db.insert(suppliers).values(
    demoSuppliers.map(([ruc, businessName, email]) => ({ ruc, businessName, email, isDemo: true })),
  ).returning();

  // Mezcla de estados para ver el flujo completo: pendientes, vencidas, pagadas y observadas.
  const demoInvoices: [number, string, string, number, number, string, string | null][] = [
    // [proveedor, serie, número, díasDesdeLlegada, díasDePlazo, estado, motivo]
    // Se mezclan recién llegadas (pagan el viernes de esta semana) con atrasadas (reprogramadas).
    [0, "F001", "2589", 0, 30, "PENDIENTE", null],
    [0, "F001", "2604", 1, 30, "PENDIENTE", null],
    [1, "F002", "0871", 40, 15, "PENDIENTE", null],
    [2, "F005", "1130", 12, 30, "PENDIENTE", null],
    [1, "F002", "0844", 55, 30, "PAGADA", null],
    [2, "F005", "1098", 48, 30, "PAGADA", null],
    [0, "F001", "2501", 35, 30, "PAGADA", null],
    [2, "F005", "1142", 8, 30, "OBSERVADA", "Falta la Guía de Remisión Transportista del servicio."],
  ];
  const addDays = (base: Date, n: number) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const invoiceRows = demoInvoices.map(([si, series, number, emitHace, plazo, status, motivo], idx) => {
    const issue = daysAgo(emitHace);
    const subtotal = 850 + idx * 137.5;
    const igv = subtotal * 0.18;
    return {
      supplierId: createdSuppliers[si].id,
      docType: "FACTURA" as const,
      series, number,
      issueDate: ymd(issue),
      dueDate: ymd(addDays(issue, plazo)),
      serviceDate: ymd(daysAgo(emitHace + 2)),
      currency: idx === 3 ? "USD" : "PEN",
      subtotal: subtotal.toFixed(2),
      igv: igv.toFixed(2),
      total: (subtotal + igv).toFixed(2),
      description: "Servicio de transporte de carga",
      grtNumber: `T00${si + 1}-${(1000 + idx).toString()}`,
      status: status as "PENDIENTE" | "PAGADA" | "OBSERVADA",
      paidAt: status === "PAGADA" ? ymd(addDays(issue, plazo - 3)) : null,
      paymentReference: status === "PAGADA" ? `Transferencia ${90000 + idx}` : null,
      paidBy: status === "PAGADA" ? admin.id : null,
      statusReason: motivo,
      createdBy: admin.id,
      receivedAt: issue,
      isDemo: true,
    };
  });
  await db.insert(supplierInvoices).values(invoiceRows);

  await db.insert(auditLogs).values({
    userId: admin.id, userName: admin.name, action: "CREAR", module: "PRODUCTOS",
    description: `Se cargaron datos de prueba: ${createdProducts.length} productos y ${createdEmployees.length} trabajadores.`,
  });
  console.log(`✔ Datos de prueba: ${createdProducts.length} productos, ${createdEmployees.length} trabajadores, con entradas y entregas`);
  console.log(`✔ Datos de prueba: ${createdSuppliers.length} proveedores y ${invoiceRows.length} facturas`);
  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
