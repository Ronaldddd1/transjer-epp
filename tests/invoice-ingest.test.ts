/**
 * Prueba del registro automático de facturas recibidas por correo.
 * Usa correos de ejemplo en vez de Microsoft Graph, pero recorre todo lo demás de verdad:
 * lectura del XML, alta del proveedor, alta de la factura, adjuntos y bandeja de revisión.
 *
 *   npx tsx --conditions=react-server tests/invoice-ingest.test.ts
 */
import "dotenv/config";
import { zipSync, strToU8 } from "fflate";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { appSettings, invoiceAttachments, invoiceEmails, supplierInvoices, suppliers } from "../src/db/schema";
import type { MailboxConfig, GraphAttachment, GraphMessage } from "../src/server/graph";
import { ingestMessage, syncMailbox, type MailReader } from "../src/server/invoice-ingest";

let fails = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("OK  ", name);
  else { fails++; console.log("FALLA", name, JSON.stringify(extra ?? "")); }
}

const CONFIG: MailboxConfig = {
  tenantId: "t", clientId: "c", clientSecret: "s",
  mailbox: "facturas@transjer.com", webhookSecret: "secreto",
};

function factura(opts: { ruc?: string; razon?: string; serie?: string; numero?: string; total?: string; moneda?: string }) {
  const { ruc = "20548392117", razon = "TRANSPORTES ABC S.A.C.", serie = "F001", numero = "9001", total = "1180.00", moneda = "PEN" } = opts;
  const sub = (Number(total) / 1.18).toFixed(2);
  const igv = (Number(total) - Number(sub)).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${serie}-${numero}</cbc:ID>
  <cbc:IssueDate>2026-09-20</cbc:IssueDate>
  <cbc:DueDate>2026-10-20</cbc:DueDate>
  <cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${moneda}</cbc:DocumentCurrencyCode>
  <cac:DespatchDocumentReference><cbc:ID>T001-555</cbc:ID><cbc:DocumentTypeCode>31</cbc:DocumentTypeCode></cac:DespatchDocumentReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">${ruc}</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>${razon}</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20601030405</cbc:ID></cac:PartyIdentification>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="${moneda}">${igv}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${moneda}">${sub}</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="${moneda}">${total}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cac:Item><cbc:Description>SERVICIO DE TRANSPORTE DE CARGA</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;
}

type Buzon = Record<string, { message: GraphMessage; attachments: GraphAttachment[] }>;
const buzon: Buzon = {};

function correo(id: string, subject: string, from: string, files: { name: string; type: string; data: Buffer }[], receivedDateTime = "2026-09-22T14:00:00Z") {
  buzon[id] = {
    message: {
      id, subject, receivedDateTime, hasAttachments: files.length > 0,
      internetMessageId: `<${id}@proveedor.pe>`,
      from: { emailAddress: { name: "Facturación Proveedor", address: from } },
    },
    attachments: files.map((f, i) => ({ id: `a${i}`, name: f.name, contentType: f.type, size: f.data.byteLength, data: f.data })),
  };
}

const reader: MailReader = {
  async getMessage(_c, id) {
    const m = buzon[id];
    if (!m) throw new Error("El mensaje no existe en el buzón.");
    return m.message;
  },
  async getAttachments(_c, id) { return buzon[id]?.attachments ?? []; },
  async listMessagesSince(_c, since) {
    return Object.values(buzon).map((b) => b.message)
      .filter((m) => Date.parse(m.receivedDateTime) >= since.getTime())
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
  },
};

async function main() {
  // Punto de partida limpio, tocando SOLO lo que crea esta prueba.
  const MIOS = sql`${supplierInvoices.series} in ('F009','F077')`;
  const CORREOS = sql`${invoiceEmails.messageId} in ('m1','m2','m3','m4','m5','m6','m7')`;
  await db.delete(invoiceAttachments).where(sql`
    ${invoiceAttachments.invoiceId} in (select id from ${supplierInvoices} where series in ('F009','F077'))
    or ${invoiceAttachments.emailId} in (select id from ${invoiceEmails} where message_id in ('m1','m2','m3','m4','m5','m6','m7'))`);
  await db.delete(invoiceEmails).where(CORREOS);
  await db.delete(supplierInvoices).where(MIOS);
  await db.delete(suppliers).where(sql`${suppliers.ruc} in ('20777777771','20888888882')`);
  // El buzón recuerda hasta qué fecha revisó. Sin borrarlo, la segunda corrida de esta
  // prueba se saltaría los correos de ejemplo y el recuento no cuadraría.
  await db.delete(appSettings).where(sql`${appSettings.key} = 'mailbox.sync'`);

  const XML = Buffer.from(factura({ ruc: "20777777771", razon: "TRANSPORTES DEL SUR S.A.C.", serie: "F009", numero: "9001" }));
  const PDF = Buffer.from("%PDF-1.4\nfactura de ejemplo\n%%EOF");

  // 1. Correo completo (PDF + XML): debe crear proveedor y factura
  correo("m1", "Factura F009-9001 – Transportes del Sur – 20/09/2026", "facturacion@sur.pe", [
    { name: "F009-9001.pdf", type: "application/pdf", data: PDF },
    { name: "20777777771-01-F009-9001.xml", type: "text/xml", data: XML },
  ]);
  const r1 = await ingestMessage(CONFIG, "m1", reader);
  check("correo con XML crea la factura", r1.result === "creada", r1);

  const [inv] = await db.select().from(supplierInvoices)
    .where(sql`${supplierInvoices.series} = 'F009' and ${supplierInvoices.number} = '9001'`);
  check("la factura queda pendiente de pago", inv?.status === "PENDIENTE", inv?.status);
  check("importe leído del XML", inv?.total === "1180.00", inv?.total);
  check("vencimiento leído del XML", inv?.dueDate === "2026-10-20", inv?.dueDate);
  check("guía de remisión leída del XML", inv?.grtNumber === "T001-555", inv?.grtNumber);
  check("origen marcado como correo", inv?.source === "CORREO", inv?.source);
  check("fecha de recepción guardada", !!inv?.receivedAt);

  const [prov] = await db.select().from(suppliers).where(eq(suppliers.ruc, "20777777771"));
  check("proveedor nuevo creado desde el XML", prov?.businessName === "TRANSPORTES DEL SUR S.A.C.", prov?.businessName);

  const adjuntos = await db.select().from(invoiceAttachments).where(eq(invoiceAttachments.invoiceId, inv.id));
  check("los 2 archivos quedan adjuntos a la factura", adjuntos.length === 2, adjuntos.length);
  check("el PDF se guardó completo", adjuntos.some((a) => a.kind === "FACTURA_PDF" && a.sizeBytes === PDF.byteLength));
  check("el XML se guardó completo", adjuntos.some((a) => a.kind === "FACTURA_XML" && a.sizeBytes === XML.byteLength));

  const [correo1] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.messageId, "m1"));
  check("el correo queda como procesado", correo1?.status === "PROCESADO", correo1?.status);
  check("el correo apunta a la factura", correo1?.invoiceId === inv.id);
  check("se guarda el remitente", correo1?.fromAddress === "facturacion@sur.pe", correo1?.fromAddress);

  // 2. El mismo aviso otra vez no duplica nada
  const r2 = await ingestMessage(CONFIG, "m1", reader);
  check("el mismo correo no se procesa dos veces", r2.result === "ya_registrado", r2);
  const [{ n: total1 }] = await db.select({ n: sql<number>`count(*)::int` }).from(supplierInvoices)
    .where(sql`${supplierInvoices.series} = 'F009'`);
  check("sigue habiendo una sola factura", total1 === 1, total1);

  // 3. Otro correo con la MISMA factura: se detecta el duplicado y no se registra de nuevo
  correo("m2", "Reenvío Factura F009-9001", "facturacion@sur.pe", [
    { name: "20777777771-01-F009-9001.xml", type: "text/xml", data: XML },
  ]);
  const r3 = await ingestMessage(CONFIG, "m2", reader);
  check("factura repetida se descarta", r3.result === "duplicado", r3);
  const [correo2] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.messageId, "m2"));
  check("el correo repetido queda como descartado", correo2?.status === "DESCARTADO", correo2?.status);
  check("el correo repetido apunta a la factura original", correo2?.invoiceId === inv.id);
  const [{ n: total2 }] = await db.select({ n: sql<number>`count(*)::int` }).from(supplierInvoices)
    .where(sql`${supplierInvoices.series} = 'F009'`);
  check("no se creó una segunda factura", total2 === 1, total2);

  // 4. Correo sin XML: queda por revisar, con sus archivos guardados
  correo("m3", "Factura del mes", "cobranzas@otro.pe", [{ name: "factura.pdf", type: "application/pdf", data: PDF }]);
  const r4 = await ingestMessage(CONFIG, "m3", reader);
  check("correo sin XML queda por revisar", r4.result === "revisar", r4);
  const [correo3] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.messageId, "m3"));
  check("estado REVISAR", correo3?.status === "REVISAR", correo3?.status);
  const adj3 = await db.select().from(invoiceAttachments).where(eq(invoiceAttachments.emailId, correo3.id));
  check("el PDF no se pierde: queda en la bandeja", adj3.length === 1, adj3.length);

  // 5. XML dañado: también queda por revisar, con el motivo
  correo("m4", "Factura con XML dañado", "x@y.pe", [{ name: "roto.xml", type: "text/xml", data: Buffer.from("<Invoice>sin cerrar") }]);
  const r5 = await ingestMessage(CONFIG, "m4", reader);
  check("XML ilegible queda por revisar", r5.result === "revisar", r5);
  const [correo4] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.messageId, "m4"));
  check("se explica el motivo", !!correo4?.detail && correo4.detail.length > 10, correo4?.detail);

  // 6. Constancia de SUNAT (CDR) dentro de un ZIP: no es la factura
  const cdr = Buffer.from(zipSync({
    "R-20777777771-01-F009-9001.xml": strToU8('<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"><ID>R</ID></ApplicationResponse>'),
  }));
  correo("m5", "Constancia SUNAT", "sunat@sur.pe", [{ name: "R-F009-9001.zip", type: "application/zip", data: cdr }]);
  const r6 = await ingestMessage(CONFIG, "m5", reader);
  check("la constancia de SUNAT no crea factura", r6.result === "revisar", r6);

  // 7. Correo sin adjuntos
  correo("m6", "Consulta sobre pagos", "proveedor@sur.pe", []);
  const r7 = await ingestMessage(CONFIG, "m6", reader);
  check("correo sin adjuntos queda por revisar", r7.result === "revisar", r7);

  // 8. Revisión completa del buzón: procesa lo nuevo y no repite lo anterior
  correo("m7", "Factura F077-15", "facturacion@norte.pe", [
    { name: "f.xml", type: "text/xml", data: Buffer.from(factura({ ruc: "20888888882", razon: "CARGA NORTE E.I.R.L.", serie: "F077", numero: "15", total: "2360.00", moneda: "USD" })) },
  ], "2026-09-23T09:00:00Z");
  const resumen = await syncMailbox(CONFIG, { sinceDays: 3650, reader });
  check("la revisión recorre todo el buzón", resumen.revisados === 7, resumen);
  check("solo registra la factura nueva", resumen.creadas === 1, resumen);
  const [inv2] = await db.select().from(supplierInvoices).where(sql`${supplierInvoices.series} = 'F077'`);
  check("factura en dólares registrada", inv2?.currency === "USD" && inv2?.total === "2360.00", inv2);

  // 9. Una segunda revisión no vuelve a crear nada
  const resumen2 = await syncMailbox(CONFIG, { sinceDays: 3650, reader });
  check("la segunda revisión no duplica facturas", resumen2.creadas === 0, resumen2);

  console.log(fails === 0 ? "\nCORREO: todas las verificaciones superadas" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
