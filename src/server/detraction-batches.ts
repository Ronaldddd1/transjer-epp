import "server-only";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { detractionBatches, supplierInvoices, suppliers, users } from "@/db/schema";
import { todayLima, invoiceNumber } from "@/lib/utils";
import { armarArchivo, siguienteLote, type DepositoDetraccion } from "@/lib/sunat-detracciones";
import { TRANSJER_RUC } from "@/server/invoice-service";

export type LoteResumen = Awaited<ReturnType<typeof listarLotes>>[number];

/**
 * Los lotes que se muestran en Detracciones: todos los que esperan pago, y los últimos
 * pagados o anulados para tener a mano su archivo y su constancia.
 */
export async function listarLotes() {
  const columnas = {
    id: detractionBatches.id,
    lot: detractionBatches.lot,
    payerRuc: detractionBatches.payerRuc,
    total: detractionBatches.total,
    invoiceCount: detractionBatches.invoiceCount,
    status: detractionBatches.status,
    paidAt: detractionBatches.paidAt,
    operation: detractionBatches.operation,
    proofId: detractionBatches.proofId,
    createdAt: detractionBatches.createdAt,
    createdByName: users.name,
  };
  const [abiertos, cerrados] = await Promise.all([
    db.select(columnas).from(detractionBatches)
      .leftJoin(users, eq(users.id, detractionBatches.createdBy))
      .where(eq(detractionBatches.status, "GENERADO"))
      .orderBy(asc(detractionBatches.createdAt)),
    db.select(columnas).from(detractionBatches)
      .leftJoin(users, eq(users.id, detractionBatches.createdBy))
      .where(ne(detractionBatches.status, "GENERADO"))
      .orderBy(desc(detractionBatches.updatedAt))
      .limit(6),
  ]);
  return [...abiertos, ...cerrados];
}

/** Las facturas de un lote, con lo que hace falta para el archivo y para el pago. */
export async function facturasDeLote(loteId: string) {
  return db.select({
    id: supplierInvoices.id,
    series: supplierInvoices.series,
    number: supplierInvoices.number,
    docType: supplierInvoices.docType,
    issueDate: supplierInvoices.issueDate,
    detractionAmount: supplierInvoices.detractionAmount,
    detractionStatus: supplierInvoices.detractionStatus,
    detractionReceipt: supplierInvoices.detractionReceipt,
    supplierName: suppliers.businessName,
    supplierRuc: suppliers.ruc,
    supplierAccount: suppliers.detractionAccount,
  }).from(supplierInvoices)
    .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
    .where(eq(supplierInvoices.detractionBatchId, loteId))
    .orderBy(asc(suppliers.businessName), asc(supplierInvoices.issueDate), asc(supplierInvoices.number));
}

export async function obtenerLote(loteId: string) {
  const [lote] = await db.select().from(detractionBatches).where(eq(detractionBatches.id, loteId)).limit(1);
  return lote ?? null;
}

export function depositoDe(f: {
  series: string; number: string; docType: string; issueDate: string; detractionAmount: string | null;
  supplierRuc: string | null; supplierAccount: string | null;
}): DepositoDetraccion {
  return {
    etiqueta: invoiceNumber(f.series, f.number),
    rucProveedor: f.supplierRuc,
    cuentaProveedor: f.supplierAccount,
    monto: Number(f.detractionAmount ?? 0),
    emision: f.issueDate,
    tipoDocumento: f.docType,
    serie: f.series,
    numero: f.number,
  };
}

/** El archivo TXT de un lote, armado con los datos de hoy de sus proveedores. */
export async function archivoDeLote(loteId: string) {
  const lote = await obtenerLote(loteId);
  if (!lote) return null;
  const facturas = await facturasDeLote(loteId);
  return armarArchivo({
    rucPagador: lote.payerRuc,
    razonSocialPagador: lote.payerName,
    lote: lote.lot,
    depositos: facturas.map(depositoDe),
  });
}

/**
 * Lo que se propone al generar un lote nuevo: el RUC y la razón social de la empresa (los
 * del último lote, o los de la configuración), y el siguiente número de lote del año.
 */
export async function datosParaNuevoLote() {
  const [ultimo] = await db.select({ payerRuc: detractionBatches.payerRuc, payerName: detractionBatches.payerName })
    .from(detractionBatches).orderBy(desc(detractionBatches.createdAt)).limit(1);
  const rucPagador = ultimo?.payerRuc ?? TRANSJER_RUC ?? "";
  const usados = rucPagador
    ? await db.select({ lot: detractionBatches.lot }).from(detractionBatches).where(eq(detractionBatches.payerRuc, rucPagador))
    : [];
  return {
    rucPagador,
    razonSocialPagador: ultimo?.payerName ?? process.env.COMPANY_NAME?.trim() ?? "",
    lote: siguienteLote(todayLima(), usados.map((u) => u.lot)),
  };
}

/** Facturas que se pueden poner en un lote: detracción pendiente, en soles y no anulada. */
export function condicionesParaLote(ids: string[]) {
  return and(
    inArray(supplierInvoices.id, ids),
    eq(supplierInvoices.detractionStatus, "PENDIENTE"),
    ne(supplierInvoices.status, "ANULADA"),
    or(eq(supplierInvoices.docType, "FACTURA"), eq(supplierInvoices.docType, "BOLETA"), eq(supplierInvoices.docType, "NOTA_DEBITO")),
  );
}
