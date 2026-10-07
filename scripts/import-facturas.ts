/**
 * Importa el control de facturas que se llevaba en Excel.
 *
 *   npm run import:facturas                      → datos/facturas-historico.csv
 *   npm run import:facturas -- otro-archivo.csv
 *   npm run import:facturas -- --simular         → no escribe nada, solo informa
 *
 * La hoja de cálculo no traía el RUC de los proveedores, así que se crean solo con su
 * nombre y el RUC queda pendiente: se completa solo cuando llegue una factura electrónica
 * suya con el XML. Los nombres que estaban escritos de varias formas ya vienen unificados
 * en el CSV.
 *
 * Se puede correr las veces que haga falta: una factura ya importada se reconoce por
 * proveedor + serie + número y se salta, así que una segunda corrida solo trae lo nuevo.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import { detractionFor, normalizeSupplierName } from "../src/lib/utils";

const { users, suppliers, supplierInvoices, auditLogs } = schema;

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Falta la variable de entorno DATABASE_URL");
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client, { schema });

const args = process.argv.slice(2);
const simular = args.includes("--simular");
const archivo = args.find((a) => !a.startsWith("--")) ?? "datos/facturas-historico.csv";

/** Lector de CSV que respeta las comillas: los destinos traen comas ("Trujillo, Piura"). */
function leerCsv(texto: string): Record<string, string>[] {
  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else entreComillas = false;
      } else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === ",") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }

  const [cabecera, ...resto] = filas.filter((f) => f.some((c) => c.trim()));
  return resto.map((f) => Object.fromEntries(cabecera.map((c, i) => [c.trim(), (f[i] ?? "").trim()])));
}

const importe = (v: string) => (v && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : null);
/** Recorta un texto al largo que admite la columna, para que una celda larga no frene todo. */
const recortar = (v: string, largo: number) => (v ? v.slice(0, largo) : null);
const fecha = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

type Resumen = {
  creadas: number; repetidas: number; omitidas: number;
  proveedoresNuevos: number;
  diferenciasDetraccion: { factura: string; excel: number; calculado: number }[];
  avisos: string[];
};

async function main() {
  const filas = leerCsv(readFileSync(archivo, "utf8"));
  console.log(`Leyendo ${archivo}: ${filas.length} filas.\n`);

  const [admin] = await db.select().from(users).where(eq(users.role, "ADMIN")).limit(1);
  if (!admin) throw new Error("No hay ningún usuario administrador para dejar registrada la importación.");

  const r: Resumen = { creadas: 0, repetidas: 0, omitidas: 0, proveedoresNuevos: 0, diferenciasDetraccion: [], avisos: [] };

  // Proveedores: se reutiliza el que ya exista con el mismo nombre, mirando también a los
  // que ya tienen RUC, para no partir en dos a un proveedor que ya entró por el buzón.
  const existentes = await db.select().from(suppliers);
  const porNombre = new Map(existentes.map((s) => [normalizeSupplierName(s.businessName), s]));

  for (const f of filas) {
    const etiqueta = `${f.serie}-${f.numero}`;
    const total = importe(f.total);
    if (!total || Number(total) <= 0) {
      r.omitidas++;
      r.avisos.push(`${etiqueta} (${f.proveedor}): sin importe en la hoja, no se importó.`);
      continue;
    }
    const emision = fecha(f.fecha_emision);
    if (!emision) {
      r.omitidas++;
      r.avisos.push(`${etiqueta} (${f.proveedor}): sin fecha de emisión, no se importó.`);
      continue;
    }

    // --- Proveedor ---
    const clave = normalizeSupplierName(f.proveedor);
    let proveedor = porNombre.get(clave);
    if (!proveedor) {
      if (simular) {
        r.proveedoresNuevos++;
        proveedor = { id: "simulado", businessName: f.proveedor } as typeof existentes[number];
      } else {
        [proveedor] = await db.insert(suppliers).values({
          businessName: f.proveedor.slice(0, 200),
          notes: "Importado del control en Excel. Falta el RUC.",
        }).returning();
        r.proveedoresNuevos++;
      }
      porNombre.set(clave, proveedor);
    }

    // --- ¿Ya estaba? ---
    if (!simular) {
      const [repetida] = await db.select({ id: supplierInvoices.id }).from(supplierInvoices).where(and(
        eq(supplierInvoices.supplierId, proveedor.id),
        eq(supplierInvoices.series, f.serie),
        eq(supplierInvoices.number, f.numero),
      )).limit(1);
      if (repetida) { r.repetidas++; continue; }
    }

    // --- Detracción ---
    // Para las que ya se depositaron se conserva el importe de la hoja, porque es el dinero
    // que de verdad entró al Banco de la Nación y la constancia dice esa cifra. Para las
    // pendientes se usa el cálculo correcto. Las diferencias se informan al final.
    const calculo = detractionFor(total, 4, "PEN");
    const delExcel = Number(f.detraccion_excel || 0);
    const yaDepositada = f.estado_detraccion === "PAGADA";
    const montoDetraccion = yaDepositada && delExcel > 0 ? delExcel : calculo.amount;
    if (yaDepositada && delExcel > 0 && Math.abs(delExcel - calculo.amount) >= 0.5) {
      r.diferenciasDetraccion.push({ factura: `${f.proveedor} ${etiqueta}`, excel: delExcel, calculado: calculo.amount });
    }

    const anulada = f.estado === "ANULADA";
    let estadoDetraccion: schema.DetractionStatus =
      !calculo.applies ? "NO_APLICA"
      : f.estado_detraccion === "PAGADA" ? "PAGADA"
      : f.estado_detraccion === "PENDIENTE" ? "PENDIENTE"
      : f.estado_detraccion === "NO_APLICA" ? "NO_APLICA"
      : f.estado_detraccion === "ANULADA" ? "PENDIENTE"
      : "OBSERVADA";
    if (anulada && estadoDetraccion !== "NO_APLICA") estadoDetraccion = "OBSERVADA";

    // La hoja no anotaba la fecha del pago ni la del depósito, solo el estado. Se usa la de
    // emisión para que el registro sea coherente, y queda dicho en las observaciones.
    const sinFechaReal = "Importado del control en Excel: la hoja no anotaba la fecha exacta, se usó la de emisión.";
    const pagada = f.estado === "PAGADA";

    const valores = {
      supplierId: proveedor.id,
      docType: "FACTURA" as const,
      series: f.serie,
      number: f.numero,
      issueDate: emision,
      serviceDate: fecha(f.fecha_servicio),
      currency: "PEN",
      subtotal: importe(f.base),
      igv: importe(f.igv),
      total,
      description: recortar([f.origen, f.destino].filter(Boolean).join(" - "), 250),
      contactName: recortar(f.contacto, 120),
      plate: recortar(f.placa, 24),
      clientName: recortar(f.cliente, 120),
      originCity: recortar(f.origen, 80),
      destinationCity: recortar(f.destino, 120),
      volumeM3: importe(f.m3),
      weightTn: importe(f.tn),
      advances: importe(f.adelantos),
      detractionRate: "4.00",
      detractionAmount: montoDetraccion.toFixed(2),
      detractionStatus: estadoDetraccion,
      detractionPaidAt: estadoDetraccion === "PAGADA" ? emision : null,
      detractionReceipt: recortar(f.constancia, 40),
      detractionOperation: recortar(f.operacion, 40),
      detractionNotes: [
        f.detraccion_nota && `La hoja decía: ${f.detraccion_nota}.`,
        estadoDetraccion === "PAGADA" && sinFechaReal,
      ].filter(Boolean).join(" ") || null,
      status: (anulada ? "ANULADA" : pagada ? "PAGADA" : "PENDIENTE") as "ANULADA" | "PAGADA" | "PENDIENTE",
      paidAt: pagada ? emision : null,
      paymentNotes: pagada ? sinFechaReal : null,
      statusReason: anulada ? "Anulada en el control en Excel." : null,
      paidBy: pagada ? admin.id : null,
      createdBy: admin.id,
      receivedAt: new Date(`${emision}T12:00:00Z`),
      payDueDate: emision,
      source: "MANUAL" as const,
      notes: "Importado del control en Excel.",
    };

    if (simular) { r.creadas++; continue; }
    try {
      await db.insert(supplierInvoices).values(valores);
      r.creadas++;
    } catch (e) {
      // Una fila con un dato imposible no debe frenar las otras ciento cincuenta.
      r.omitidas++;
      r.avisos.push(`${etiqueta} (${f.proveedor}): ${e instanceof Error ? e.message.split("\n")[0] : "no se pudo guardar"}.`);
    }
  }

  if (!simular) {
    await db.insert(auditLogs).values({
      userId: admin.id, userName: admin.name, action: "IMPORTAR", module: "FACTURAS",
      description: `Se importaron ${r.creadas} facturas del control en Excel, con ${r.proveedoresNuevos} proveedor(es) nuevo(s) sin RUC.`,
    });
  }

  console.log(simular ? "— SIMULACIÓN, no se escribió nada —\n" : "");
  console.log(`Facturas importadas:       ${r.creadas}`);
  console.log(`Ya estaban registradas:    ${r.repetidas}`);
  console.log(`No se pudieron importar:   ${r.omitidas}`);
  console.log(`Proveedores creados:       ${r.proveedoresNuevos} (todos sin RUC)`);

  if (r.avisos.length) {
    console.log("\nFilas que quedaron fuera:");
    for (const a of r.avisos) console.log("  ·", a);
  }

  if (r.diferenciasDetraccion.length) {
    const suma = r.diferenciasDetraccion.reduce((s, d) => s + (d.excel - d.calculado), 0);
    console.log(`\nDetracciones ya depositadas cuyo importe no coincide con el 4 % redondeado: ${r.diferenciasDetraccion.length}`);
    console.log("Se conservó el importe de la hoja, porque es el que figura en la constancia del banco.");
    console.log(`Diferencia acumulada: ${suma > 0 ? "+" : ""}${suma.toFixed(2)} soles respecto de lo que correspondía.`);
    for (const d of r.diferenciasDetraccion.slice(0, 10)) {
      console.log(`  · ${d.factura}: se depositó ${d.excel.toFixed(2)} y correspondían ${d.calculado.toFixed(2)}`);
    }
    if (r.diferenciasDetraccion.length > 10) console.log(`  · …y ${r.diferenciasDetraccion.length - 10} más.`);
  }

  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
