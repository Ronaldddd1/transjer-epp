"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { suppliers, supplierInvoices, type DetractionStatus } from "@/db/schema";
import { BusinessError, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { computePayDueDate, detractionFor, normalizeSupplierName } from "@/lib/utils";
import {
  estadoDePago, estadoDeDetraccion, readInvoiceSheet, type SheetInvoice,
} from "@/server/invoice-sheet";

/**
 * Carga del control de facturas en Excel desde la pantalla.
 *
 * Son dos pasos a propósito: primero se analiza y se muestra qué va a pasar con cada fila,
 * y solo después se escribe. Importar ciento y pico de facturas a ciegas, sobre la base de
 * producción, no es algo que deba ocurrir de un clic.
 *
 * El archivo se vuelve a enviar al confirmar y se lee otra vez. Es un archivo pequeño, y
 * así lo que se guarda sale siempre de la hoja, nunca de datos que hayan ido y vuelto por
 * el navegador.
 */

const MAX_BYTES = 5 * 1024 * 1024;

export type FilaAnalizada = {
  fila: number;
  proveedor: string;
  comprobante: string;
  fecha: string | null;
  total: number | null;
  estado: "PENDIENTE" | "PAGADA" | "ANULADA";
  detraccion: number;
  proveedorNuevo: boolean;
};

export type AnalisisHoja =
  | {
      ok: true;
      hoja: string;
      leidas: number;
      nuevas: FilaAnalizada[];
      repetidas: number;
      problemas: { fila: number; detalle: string }[];
      proveedoresNuevos: string[];
      columnasIgnoradas: string[];
      importe: number;
      /** Detracciones ya depositadas cuyo importe no coincide con el 4 % de la regla. */
      diferenciasDetraccion: { comprobante: string; hoja: number; regla: number }[];
    }
  | { ok: false; message: string };

async function leerArchivo(formData: FormData): Promise<Buffer> {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    throw new BusinessError("Elige el archivo de Excel con el control de facturas.");
  }
  if (!/\.(xlsx|xlsm)$/i.test(archivo.name)) {
    throw new BusinessError(`${archivo.name} no es un Excel. Se espera un archivo .xlsx.`);
  }
  if (archivo.size > MAX_BYTES) {
    throw new BusinessError(`${archivo.name} pesa demasiado. El máximo es ${MAX_BYTES / 1024 / 1024} MB.`);
  }
  return Buffer.from(await archivo.arrayBuffer());
}

/** Lo que falta para poder guardar una fila. Null si está completa. */
function queLeFalta(f: SheetInvoice): string | null {
  if (!f.total || f.total <= 0) return "no tiene importe total.";
  if (!f.fechaEmision) return "no tiene fecha de emisión, o no se entiende.";
  return null;
}

/**
 * El importe de la detracción.
 *
 * Para las que ya se depositaron manda lo que dice la hoja: ese es el dinero que de verdad
 * entró al Banco de la Nación y lo que figura en la constancia. Para el resto se usa la
 * regla. Las diferencias se informan, no se corrigen por detrás.
 */
function montoDetraccion(f: SheetInvoice) {
  const regla = detractionFor(f.total ?? 0, 4, "PEN");
  const deposito = estadoDeDetraccion(f.estadoDetraccion).estado === "PAGADA" ? (f.detraccionExcel ?? 0) : 0;
  const usar = deposito > 0 ? deposito : regla.amount;
  const difiere = deposito > 0 && Math.abs(deposito - regla.amount) >= 0.5;
  return { usar, regla: regla.amount, aplica: regla.applies, difiere };
}

export async function analizarFacturasDeExcel(formData: FormData): Promise<AnalisisHoja> {
  try {
    await requireActionUser("invoices.manage");
    const hoja = await readInvoiceSheet(await leerArchivo(formData));

    const existentes = await db.select({
      id: suppliers.id, businessName: suppliers.businessName,
    }).from(suppliers);
    const porNombre = new Map(existentes.map((s) => [normalizeSupplierName(s.businessName), s.id]));

    const registradas = await db.select({
      supplierId: supplierInvoices.supplierId, series: supplierInvoices.series, number: supplierInvoices.number,
    }).from(supplierInvoices);
    const yaEstan = new Set(registradas.map((i) => `${i.supplierId}|${i.series}|${i.number}`));

    const nuevas: FilaAnalizada[] = [];
    const problemas = [...hoja.avisos];
    // Se agrupan por nombre normalizado, igual que al importar: "Roda Expess sac" y
    // "RODA EXPRESS SAC" son el mismo proveedor y se crea uno solo. Contar las formas de
    // escribirlo daba un número mayor que el de proveedores que de verdad se crean.
    const proveedoresNuevos = new Map<string, string>();
    const diferenciasDetraccion: { comprobante: string; hoja: number; regla: number }[] = [];
    let repetidas = 0;

    for (const f of hoja.filas) {
      const comprobante = `${f.serie}-${f.numero}`;
      const falta = queLeFalta(f);
      if (falta) {
        problemas.push({ fila: f.fila, detalle: `${f.proveedor} ${comprobante}: ${falta}` });
        continue;
      }

      const clave = normalizeSupplierName(f.proveedor);
      const proveedorId = porNombre.get(clave);
      if (!proveedorId && !proveedoresNuevos.has(clave)) proveedoresNuevos.set(clave, f.proveedor);

      if (proveedorId && yaEstan.has(`${proveedorId}|${f.serie}|${f.numero}`)) {
        repetidas++;
        continue;
      }

      const d = montoDetraccion(f);
      if (d.difiere) diferenciasDetraccion.push({ comprobante: `${f.proveedor} ${comprobante}`, hoja: d.usar, regla: d.regla });

      nuevas.push({
        fila: f.fila,
        proveedor: f.proveedor,
        comprobante,
        fecha: f.fechaEmision,
        total: f.total,
        estado: estadoDePago(f.estadoPago),
        detraccion: d.usar,
        proveedorNuevo: !proveedorId,
      });
    }

    return {
      ok: true,
      hoja: hoja.hoja,
      leidas: hoja.filas.length,
      nuevas,
      repetidas,
      problemas,
      proveedoresNuevos: [...proveedoresNuevos.values()],
      columnasIgnoradas: hoja.columnasIgnoradas,
      importe: nuevas.reduce((s, n) => s + (n.total ?? 0), 0),
      diferenciasDetraccion,
    };
  } catch (e) {
    const r = toActionError(e);
    return { ok: false, message: r.ok ? "No se pudo leer el archivo." : r.message };
  }
}

export async function importarFacturasDeExcel(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const hoja = await readInvoiceSheet(await leerArchivo(formData));

    const resumen = await db.transaction(async (tx) => {
      const existentes = await tx.select().from(suppliers);
      const porNombre = new Map(existentes.map((s) => [normalizeSupplierName(s.businessName), s]));

      let creadas = 0, repetidas = 0, omitidas = 0, proveedoresNuevos = 0;

      for (const f of hoja.filas) {
        if (queLeFalta(f)) { omitidas++; continue; }
        const emision = f.fechaEmision!;
        const total = f.total!;

        // --- Proveedor ---
        const clave = normalizeSupplierName(f.proveedor);
        let proveedor = porNombre.get(clave);
        if (!proveedor) {
          // El RUC no está en la hoja. Se deja vacío y se completa solo cuando llegue una
          // factura electrónica de ese proveedor con su XML.
          [proveedor] = await tx.insert(suppliers).values({
            businessName: f.proveedor.slice(0, 200),
            notes: "Creado al importar el control en Excel. Falta el RUC.",
          }).returning();
          porNombre.set(clave, proveedor);
          proveedoresNuevos++;
        }

        // --- ¿Ya estaba? ---
        const [repetida] = await tx.select({ id: supplierInvoices.id }).from(supplierInvoices).where(and(
          eq(supplierInvoices.supplierId, proveedor.id),
          eq(supplierInvoices.series, f.serie),
          eq(supplierInvoices.number, f.numero),
        )).limit(1);
        if (repetida) { repetidas++; continue; }

        const pago = estadoDePago(f.estadoPago);
        const det = estadoDeDetraccion(f.estadoDetraccion);
        const d = montoDetraccion(f);

        let estadoDetraccion: DetractionStatus = !d.aplica ? "NO_APLICA" : det.estado;
        // Una factura anulada no deja una detracción en marcha: queda observada para que
        // alguien decida qué pasó con el depósito.
        if (pago === "ANULADA" && estadoDetraccion !== "NO_APLICA") estadoDetraccion = "OBSERVADA";

        const plazo = {
          paymentTerm: proveedor.defaultPaymentTerm,
          termDays: proveedor.defaultTermDays,
          receptionYmd: emision,
          guideReceivedAt: null,
        };

        // La hoja anota el estado pero no la fecha exacta del pago ni la del depósito. Se usa
        // la de emisión y queda dicho en las observaciones, para que nadie la tome por real.
        const sinFechaReal = "Importado del control en Excel: la hoja no anotaba la fecha exacta, se usó la de emisión.";

        await tx.insert(supplierInvoices).values({
          supplierId: proveedor.id,
          docType: "FACTURA",
          series: f.serie,
          number: f.numero,
          issueDate: emision,
          serviceDate: f.fechaServicio,
          currency: "PEN",
          subtotal: f.base?.toFixed(2) ?? null,
          igv: f.igv?.toFixed(2) ?? null,
          total: total.toFixed(2),
          description: [f.origen, f.destino].filter(Boolean).join(" - ").slice(0, 250) || null,
          contactName: f.contacto?.slice(0, 120) ?? null,
          plate: f.placa?.slice(0, 24) ?? null,
          clientName: f.cliente?.slice(0, 120) ?? null,
          originCity: f.origen?.slice(0, 80) ?? null,
          destinationCity: f.destino?.slice(0, 120) ?? null,
          volumeM3: f.m3?.toFixed(2) ?? null,
          weightTn: f.tn?.toFixed(2) ?? null,
          advances: f.adelantos?.toFixed(2) ?? null,
          paymentTerm: plazo.paymentTerm,
          termDays: plazo.termDays,
          receivedAt: new Date(`${emision}T12:00:00Z`),
          payDueDate: computePayDueDate(plazo),
          detractionRate: "4.00",
          detractionAmount: d.usar.toFixed(2),
          detractionStatus: estadoDetraccion,
          detractionPaidAt: estadoDetraccion === "PAGADA" ? emision : null,
          detractionReceipt: f.constancia?.slice(0, 40) ?? null,
          detractionOperation: f.operacion?.slice(0, 40) ?? null,
          detractionNotes: [
            det.nota && `La hoja decía: ${det.nota}.`,
            estadoDetraccion === "PAGADA" && sinFechaReal,
          ].filter(Boolean).join(" ") || null,
          status: pago,
          paidAt: pago === "PAGADA" ? emision : null,
          paidBy: pago === "PAGADA" ? user.id : null,
          paymentNotes: pago === "PAGADA" ? sinFechaReal : null,
          statusReason: pago === "ANULADA" ? "Anulada en el control en Excel." : null,
          source: "MANUAL",
          createdBy: user.id,
          notes: "Importado del control en Excel.",
        });
        creadas++;
      }

      if (creadas === 0 && repetidas > 0) {
        // No es un error: significa que la hoja ya estaba cargada entera.
        return { creadas, repetidas, omitidas, proveedoresNuevos };
      }

      await logAudit({
        user, action: "IMPORTAR", module: "FACTURAS",
        description: `${user.name} importó ${creadas} factura(s) desde el Excel "${hoja.hoja}"`
          + `${proveedoresNuevos ? `, creando ${proveedoresNuevos} proveedor(es) sin RUC` : ""}`
          + `${repetidas ? `. Se saltaron ${repetidas} que ya estaban registradas` : ""}.`,
        newData: { creadas, repetidas, omitidas, proveedoresNuevos },
      }, tx);

      return { creadas, repetidas, omitidas, proveedoresNuevos };
    });

    revalidatePath("/", "layout");

    if (resumen.creadas === 0) {
      return {
        ok: true,
        message: resumen.repetidas > 0
          ? `No había nada nuevo: las ${resumen.repetidas} facturas de la hoja ya estaban registradas.`
          : "La hoja no tenía ninguna factura que se pudiera importar.",
      };
    }
    return {
      ok: true,
      message: `Se importaron ${resumen.creadas} factura(s).`
        + (resumen.proveedoresNuevos ? ` Se crearon ${resumen.proveedoresNuevos} proveedor(es), sin RUC.` : "")
        + (resumen.repetidas ? ` ${resumen.repetidas} ya estaban registradas.` : "")
        + (resumen.omitidas ? ` ${resumen.omitidas} quedaron fuera por datos incompletos.` : ""),
    };
  } catch (e) {
    return toActionError(e);
  }
}
