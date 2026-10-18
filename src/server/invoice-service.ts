import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  invoiceAttachments, supplierInvoices, suppliers,
  type AttachmentKind, type InvoiceDocType, type PaymentTerm,
} from "@/db/schema";
import { BusinessError } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import {
  computePayDueDate, DEFAULT_TERM_DAYS, detractionFor, DETRACTION_RATE, invoiceNumber,
  normalizeSupplierName, type InvoiceServiceTypeKey,
} from "@/lib/utils";
import { putFile, removeFile, safeName } from "./storage";
import { detectAttachmentKind, parseSunatXml, XmlParseError, type ParsedInvoice } from "./sunat-xml";

/**
 * Lógica común de facturas, compartida por el registro manual y la lectura automática
 * del buzón de correo, para que ambos caminos apliquen las mismas reglas.
 */

export type InvoiceInput = {
  supplierId: string;
  docType: InvoiceDocType;
  series: string;
  number: string;
  issueDate: string;
  dueDate?: string | null;
  serviceDate?: string | null;
  currency: string;
  subtotal?: string | null;
  igv?: string | null;
  total: string;
  description?: string | null;
  grtNumber?: string | null;
  /** Guía del remitente, cuando el concepto del XML la trae. */
  dispatchNote?: string | null;
  /** Transporte o servicio: lo decide quien aprueba el comprobante. */
  serviceType?: InvoiceServiceTypeKey | null;
  notes?: string | null;
  source?: "MANUAL" | "CORREO";
  receivedAt?: Date | null;
  paymentTerm?: PaymentTerm;
  termDays?: number;
  guideReceivedAt?: string | null;
  /** Fecha límite ya calculada; null mientras una factura a crédito espera su guía. */
  payDueDate?: string | null;
  // Datos del servicio de transporte
  contactName?: string | null;
  plate?: string | null;
  clientName?: string | null;
  originCity?: string | null;
  destinationCity?: string | null;
  volumeM3?: string | null;
  weightTn?: string | null;
  advances?: string | null;
};

/** Evita registrar dos veces el mismo comprobante del mismo proveedor. */
export async function findDuplicate(
  tx: Tx | typeof db,
  input: Pick<InvoiceInput, "supplierId" | "docType" | "series" | "number">,
) {
  const [row] = await tx.select({ id: supplierInvoices.id, status: supplierInvoices.status })
    .from(supplierInvoices)
    .where(and(
      eq(supplierInvoices.supplierId, input.supplierId),
      eq(supplierInvoices.docType, input.docType),
      eq(supplierInvoices.series, input.series),
      eq(supplierInvoices.number, input.number),
    ))
    .limit(1);
  return row ?? null;
}

export async function assertNoDuplicate(tx: Tx | typeof db, input: Pick<InvoiceInput, "supplierId" | "docType" | "series" | "number">) {
  const dup = await findDuplicate(tx, input);
  if (dup) {
    throw new BusinessError(`El comprobante ${invoiceNumber(input.series, input.number)} ya está registrado para este proveedor.`);
  }
}

/**
 * Valores de detracción que corresponden a un importe, listos para guardar.
 *
 * La detracción es del servicio de TRANSPORTE de carga: una factura de servicio no se
 * detrae, así que queda en "No aplica" con monto cero, igual que una por debajo del
 * umbral o en dólares. Mientras no se sepa de qué clase es (las anteriores a este
 * cambio), se calcula como antes y se corrige al clasificarla.
 */
export function detractionFields(
  total: string | number,
  currency = "PEN",
  serviceType?: InvoiceServiceTypeKey | null,
) {
  if (serviceType === "SERVICIO") {
    return { detractionAmount: "0.00", detractionStatus: "NO_APLICA" as const };
  }
  const d = detractionFor(total, DETRACTION_RATE, currency);
  return {
    detractionAmount: d.amount.toFixed(2),
    detractionStatus: (d.applies ? "PENDIENTE" : "NO_APLICA") as "PENDIENTE" | "NO_APLICA",
  };
}

/** Busca el proveedor por RUC; si no existe, lo crea con los datos del comprobante. */
export async function findOrCreateSupplier(
  tx: Tx,
  data: { ruc: string; businessName: string },
  user: Pick<CurrentUser, "id" | "name"> | null,
) {
  const [existing] = await tx.select().from(suppliers).where(eq(suppliers.ruc, data.ruc)).limit(1);
  if (existing) return { supplier: existing, created: false };

  /**
   * Los proveedores que vienen del control en Excel entraron sin RUC, porque esa hoja no lo
   * anotaba. Cuando llega una factura electrónica suya, el XML sí trae el RUC: si el nombre
   * coincide, se completa en vez de crear un duplicado. La comparación ignora mayúsculas,
   * tildes y la forma societaria, porque en la hoja el mismo proveedor aparecía escrito de
   * varias maneras ("Corporacion dyj Rusal sac" y "CORPORACION DYJ RUSAL SAC").
   */
  const sinRuc = await tx.select().from(suppliers).where(isNull(suppliers.ruc));
  const parecido = sinRuc.find((s) => normalizeSupplierName(s.businessName) === normalizeSupplierName(data.businessName));
  if (parecido) {
    const [actualizado] = await tx.update(suppliers)
      .set({ ruc: data.ruc })
      .where(eq(suppliers.id, parecido.id)).returning();
    await logAudit({
      user, action: "EDITAR", module: "PROVEEDORES", recordId: parecido.id,
      description: `Se completó el RUC ${data.ruc} de ${parecido.businessName} a partir del XML de su comprobante.`,
      oldData: parecido, newData: actualizado,
    }, tx);
    return { supplier: actualizado, created: false };
  }

  const [created] = await tx.insert(suppliers).values({
    ruc: data.ruc,
    businessName: data.businessName.slice(0, 200),
  }).returning();
  await logAudit({
    user, action: "CREAR", module: "PROVEEDORES", recordId: created.id,
    description: `${user?.name ?? "El sistema"} registró al proveedor ${created.businessName} (RUC ${created.ruc}) a partir de un comprobante.`,
    newData: created,
  }, tx);
  return { supplier: created, created: true };
}

export async function insertInvoice(
  tx: Tx,
  input: InvoiceInput,
  user: Pick<CurrentUser, "id" | "name"> | null,
  extra: { isDemo?: boolean } = {},
) {
  await assertNoDuplicate(tx, input);
  const [invoice] = await tx.insert(supplierInvoices).values({
    supplierId: input.supplierId,
    docType: input.docType,
    series: input.series,
    number: input.number,
    issueDate: input.issueDate,
    dueDate: input.dueDate ?? null,
    serviceDate: input.serviceDate ?? null,
    currency: input.currency,
    subtotal: input.subtotal ?? null,
    igv: input.igv ?? null,
    total: input.total,
    description: input.description ?? null,
    grtNumber: input.grtNumber ?? null,
    dispatchNote: input.dispatchNote ?? null,
    serviceType: input.serviceType ?? null,
    notes: input.notes ?? null,
    source: input.source ?? "MANUAL",
    receivedAt: input.receivedAt ?? null,
    paymentTerm: input.paymentTerm ?? "CONTADO",
    termDays: input.termDays ?? DEFAULT_TERM_DAYS[input.paymentTerm ?? "CONTADO"],
    guideReceivedAt: input.guideReceivedAt ?? null,
    payDueDate: input.payDueDate ?? null,
    contactName: input.contactName ?? null,
    plate: input.plate ?? null,
    clientName: input.clientName ?? null,
    originCity: input.originCity ?? null,
    destinationCity: input.destinationCity ?? null,
    volumeM3: input.volumeM3 ?? null,
    weightTn: input.weightTn ?? null,
    advances: input.advances ?? null,
    // La detracción se calcula sola a partir del importe: 4 % del total con IGV, redondeado
    // al sol más próximo, y "no aplica" cuando la operación no supera los S/ 400.
    ...detractionFields(input.total, input.currency, input.serviceType),
    createdBy: user?.id ?? null,
    isDemo: extra.isDemo ?? false,
  }).returning();
  return invoice;
}

export type AttachmentInput = {
  invoiceId?: string | null;
  emailId?: string | null;
  filename: string;
  contentType: string;
  data: Buffer;
  kind?: AttachmentKind;
  uploadedBy?: string | null;
};

/** Guarda el archivo donde corresponda y deja el registro en la base. */
export async function saveAttachment(tx: Tx, input: AttachmentInput) {
  const kind = input.kind ?? detectAttachmentKind(input.filename, input.contentType);
  const key = `facturas/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName(input.filename)}`;
  const stored = await putFile({ key, data: input.data, contentType: input.contentType });

  const [row] = await tx.insert(invoiceAttachments).values({
    invoiceId: input.invoiceId ?? null,
    emailId: input.emailId ?? null,
    kind,
    filename: input.filename.slice(0, 250),
    contentType: input.contentType.slice(0, 120),
    sizeBytes: input.data.byteLength,
    storageDriver: stored.storageDriver,
    storageKey: stored.storageKey,
    content: stored.content,
    uploadedBy: input.uploadedBy ?? null,
  }).returning({ id: invoiceAttachments.id, kind: invoiceAttachments.kind, filename: invoiceAttachments.filename });
  return row;
}

export async function deleteAttachment(id: string) {
  const [row] = await db.select().from(invoiceAttachments).where(eq(invoiceAttachments.id, id)).limit(1);
  if (!row) throw new BusinessError("El archivo no existe.");
  await db.delete(invoiceAttachments).where(eq(invoiceAttachments.id, id));
  await removeFile(row);
  return row;
}

export type ReadFile = { filename: string; contentType: string; data: Buffer };

/** Busca el comprobante dentro de los archivos recibidos y devuelve sus datos ya leídos. */
export function parseFirstXml(files: ReadFile[]): { parsed: ParsedInvoice; file: ReadFile } | { error: string } {
  const candidates = files.filter((f) => /\.(xml|zip)$/i.test(f.filename) || f.contentType.includes("xml"));
  if (candidates.length === 0) {
    return { error: "No se encontró el XML del comprobante entre los archivos." };
  }
  const problems: string[] = [];
  for (const file of candidates) {
    try {
      return { parsed: parseSunatXml(file.data, file.filename), file };
    } catch (error) {
      problems.push(error instanceof XmlParseError ? `${file.filename}: ${error.message}` : `${file.filename}: no se pudo leer.`);
    }
  }
  return { error: problems.join(" ") };
}

export const TRANSJER_RUC = process.env.COMPANY_RUC?.trim() || null;

/** Avisa si el comprobante fue emitido a otra empresa (posible correo equivocado). */
export function customerWarning(parsed: ParsedInvoice): string | null {
  if (!TRANSJER_RUC || !parsed.customerRuc) return null;
  if (parsed.customerRuc === TRANSJER_RUC) return null;
  return `El comprobante fue emitido al RUC ${parsed.customerRuc}, que no es el de la empresa.`;
}
