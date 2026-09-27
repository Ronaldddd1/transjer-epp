import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { AttachmentKind, InvoiceDocType } from "@/db/schema";

/**
 * Lectura del XML de comprobantes electrónicos peruanos (UBL 2.1 de SUNAT).
 *
 * El XML es información estructurada y obligatoria, así que de ahí se obtienen el RUC del
 * proveedor, la serie y número, la fecha y los importes sin tener que interpretar el PDF.
 */

export type ParsedInvoice = {
  docType: InvoiceDocType;
  series: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: "PEN" | "USD";
  subtotal: string | null;
  igv: string | null;
  total: string;
  supplierRuc: string;
  supplierName: string;
  customerRuc: string | null;
  description: string | null;
  grtNumber: string | null;
};

/** Códigos de tipo de comprobante de SUNAT (catálogo 01). */
const DOC_TYPE_BY_CODE: Record<string, InvoiceDocType> = {
  "01": "FACTURA",
  "03": "BOLETA",
  "07": "NOTA_CREDITO",
  "08": "NOTA_DEBITO",
};

/** Códigos de guía de remisión: 09 = remitente, 31 = transportista. */
const DESPATCH_CODES = new Set(["09", "31"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

export class XmlParseError extends Error {}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Devuelve el texto de un nodo, que puede venir como string o como objeto con atributos. */
function text(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    const value = (node as Record<string, unknown>)["#text"];
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number") return String(value);
  }
  return null;
}

function amount(node: unknown): string | null {
  const raw = text(node);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

/** Separa "F001-2589" en serie y correlativo. */
export function splitDocumentId(id: string): { series: string; number: string } {
  const clean = id.trim().toUpperCase();
  const dash = clean.lastIndexOf("-");
  if (dash > 0) {
    return { series: clean.slice(0, dash).trim(), number: clean.slice(dash + 1).trim() };
  }
  // Sin guion: los 4 primeros caracteres suelen ser la serie.
  return { series: clean.slice(0, 4), number: clean.slice(4) || clean };
}

/** Si el archivo es un ZIP, devuelve el XML del comprobante que lleva dentro. */
export function extractXml(data: Buffer, filename = ""): Buffer {
  const isZip = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05);
  if (!isZip) return data;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new XmlParseError(`No se pudo abrir el archivo comprimido ${filename}.`);
  }
  const names = Object.keys(files).filter((n) => n.toLowerCase().endsWith(".xml"));
  if (names.length === 0) throw new XmlParseError(`El archivo comprimido ${filename} no contiene ningún XML.`);
  // Se descarta la constancia de recepción de SUNAT (empieza con "R-").
  const preferred = names.find((n) => !n.split("/").pop()!.toUpperCase().startsWith("R-")) ?? names[0];
  return Buffer.from(files[preferred]);
}

export function parseSunatXml(raw: Buffer, filename = ""): ParsedInvoice {
  const xml = extractXml(raw, filename).toString("utf8");

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new XmlParseError(`El archivo ${filename} no es un XML válido.`);
  }

  const rootName = Object.keys(doc).find((k) => ["Invoice", "CreditNote", "DebitNote"].includes(k));
  if (!rootName) {
    const found = Object.keys(doc).filter((k) => !k.startsWith("?")).join(", ");
    if (found.includes("ApplicationResponse")) {
      throw new XmlParseError("El XML es la constancia de SUNAT (CDR), no el comprobante.");
    }
    throw new XmlParseError("El XML no corresponde a una factura, boleta o nota electrónica.");
  }
  const root = doc[rootName] as Record<string, unknown>;

  const documentId = text(root.ID);
  if (!documentId) throw new XmlParseError("El XML no indica el número del comprobante.");
  const { series, number } = splitDocumentId(documentId);

  const issueDate = text(root.IssueDate);
  if (!issueDate || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    throw new XmlParseError("El XML no indica una fecha de emisión válida.");
  }

  const typeCode = text(root.InvoiceTypeCode) ?? text(root.CreditNoteTypeCode) ?? text(root.DebitNoteTypeCode);
  const docType: InvoiceDocType =
    DOC_TYPE_BY_CODE[typeCode ?? ""] ??
    (rootName === "CreditNote" ? "NOTA_CREDITO" : rootName === "DebitNote" ? "NOTA_DEBITO" : "FACTURA");

  const currencyRaw = (text(root.DocumentCurrencyCode) ?? "PEN").toUpperCase();
  const currency: "PEN" | "USD" = currencyRaw === "USD" ? "USD" : "PEN";

  // Emisor
  const supplierParty = (root.AccountingSupplierParty as Record<string, unknown>)?.Party as Record<string, unknown> | undefined;
  const supplierRuc = text(
    (asArray(supplierParty?.PartyIdentification)[0] as Record<string, unknown>)?.ID,
  );
  const supplierName =
    text((asArray(supplierParty?.PartyLegalEntity)[0] as Record<string, unknown>)?.RegistrationName) ??
    text((asArray(supplierParty?.PartyName)[0] as Record<string, unknown>)?.Name);

  if (!supplierRuc || !/^\d{11}$/.test(supplierRuc)) {
    throw new XmlParseError("El XML no indica un RUC de emisor válido.");
  }

  // Receptor (debería ser Transjer)
  const customerParty = (root.AccountingCustomerParty as Record<string, unknown>)?.Party as Record<string, unknown> | undefined;
  const customerRuc = text((asArray(customerParty?.PartyIdentification)[0] as Record<string, unknown>)?.ID);

  // Importes
  const totals = root.LegalMonetaryTotal as Record<string, unknown> | undefined;
  const total = amount(totals?.PayableAmount);
  if (!total || Number(total) <= 0) throw new XmlParseError("El XML no indica el importe total del comprobante.");
  const subtotal = amount(totals?.LineExtensionAmount);
  const igv = asArray(root.TaxTotal).map((t) => amount((t as Record<string, unknown>)?.TaxAmount)).find((v) => v !== null) ?? null;

  // Vencimiento: puede estar en cbc:DueDate o en las condiciones de pago.
  const dueDate =
    text(root.DueDate) ??
    asArray(root.PaymentTerms).map((p) => text((p as Record<string, unknown>)?.PaymentDueDate)).find(Boolean) ??
    null;

  // Guía de remisión referenciada en el comprobante.
  const grtNumber =
    asArray(root.DespatchDocumentReference)
      .map((d) => {
        const ref = d as Record<string, unknown>;
        const code = text(ref.DocumentTypeCode);
        const id = text(ref.ID);
        return id && (!code || DESPATCH_CODES.has(code)) ? id : null;
      })
      .find(Boolean) ?? null;

  const firstLine = asArray(root.InvoiceLine ?? root.CreditNoteLine ?? root.DebitNoteLine)[0] as Record<string, unknown> | undefined;
  const description = text((firstLine?.Item as Record<string, unknown>)?.Description);

  return {
    docType,
    series: series.slice(0, 8),
    number: number.slice(0, 12),
    issueDate,
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
    currency,
    subtotal,
    igv,
    total,
    supplierRuc,
    supplierName: (supplierName ?? `RUC ${supplierRuc}`).slice(0, 200),
    customerRuc,
    description: description ? description.slice(0, 250) : null,
    grtNumber: grtNumber ? grtNumber.slice(0, 40) : null,
  };
}

const GUIDE_HINTS = /\b(grt|guia|guía|gr[-_]?t|remision|remisión)\b/i;

/** Clasifica un adjunto por su nombre y tipo para mostrarlo con la etiqueta correcta. */
export function detectAttachmentKind(filename: string, contentType: string): AttachmentKind {
  const name = filename.toLowerCase();
  const isGuide = GUIDE_HINTS.test(name);
  if (name.endsWith(".xml") || contentType.includes("xml")) return isGuide ? "GRT" : "FACTURA_XML";
  if (name.endsWith(".zip")) return isGuide ? "GRT" : "FACTURA_XML";
  if (name.endsWith(".pdf") || contentType.includes("pdf")) return isGuide ? "GRT" : "FACTURA_PDF";
  return "OTRO";
}
