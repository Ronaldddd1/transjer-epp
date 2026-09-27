import { zipSync, strToU8 } from "fflate";
import { parseSunatXml, splitDocumentId, detectAttachmentKind, XmlParseError } from "../src/server/sunat-xml";

const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <ext:UBLExtensions xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtension><ext:ExtensionContent><ds:Signature Id="S"><ds:SignatureValue>abc</ds:SignatureValue></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>F001-2589</cbc:ID>
  <cbc:IssueDate>2026-08-03</cbc:IssueDate>
  <cbc:IssueTime>10:31:00</cbc:IssueTime>
  <cbc:DueDate>2026-09-02</cbc:DueDate>
  <cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha">PEN</cbc:DocumentCurrencyCode>
  <cac:DespatchDocumentReference><cbc:ID>T001-000123</cbc:ID><cbc:DocumentTypeCode>31</cbc:DocumentTypeCode></cac:DespatchDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6" schemeName="Documento de Identidad">20548392117</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>TRANSPORTES ABC</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[TRANSPORTES ABC S.A.C.]]></cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20601030405</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>TRANSJER OPERADOR LOGISTICO S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">180.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxableAmount currencyID="PEN">1000.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="PEN">180.00</cbc:TaxAmount></cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">1000.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine><cbc:ID>1</cbc:ID><cac:Item><cbc:Description>SERVICIO DE TRANSPORTE LIMA - TRUJILLO</cbc:Description></cac:Item></cac:InvoiceLine>
</Invoice>`;

let fails = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("OK  ", name);
  else { fails++; console.log("FALLA", name, extra ?? ""); }
}

// 1. Factura completa
const f = parseSunatXml(Buffer.from(FACTURA), "20548392117-01-F001-2589.xml");
check("tipo FACTURA", f.docType === "FACTURA", f.docType);
check("serie F001", f.series === "F001", f.series);
check("numero 2589", f.number === "2589", f.number);
check("fecha emision", f.issueDate === "2026-08-03", f.issueDate);
check("vencimiento", f.dueDate === "2026-09-02", f.dueDate);
check("moneda PEN", f.currency === "PEN");
check("total 1180.00", f.total === "1180.00", f.total);
check("subtotal 1000.00", f.subtotal === "1000.00", f.subtotal);
check("igv 180.00", f.igv === "180.00", f.igv);
check("RUC emisor", f.supplierRuc === "20548392117", f.supplierRuc);
check("razon social (CDATA)", f.supplierName === "TRANSPORTES ABC S.A.C.", f.supplierName);
check("RUC receptor", f.customerRuc === "20601030405", f.customerRuc);
check("descripcion", f.description === "SERVICIO DE TRANSPORTE LIMA - TRUJILLO", f.description);
check("guia GRT", f.grtNumber === "T001-000123", f.grtNumber);

// 2. Dentro de un ZIP, con la constancia de SUNAT al lado
const zip = Buffer.from(zipSync({
  "R-20548392117-01-F001-2589.xml": strToU8('<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"><ID>R</ID></ApplicationResponse>'),
  "20548392117-01-F001-2589.xml": strToU8(FACTURA),
}));
const z = parseSunatXml(zip, "20548392117-01-F001-2589.zip");
check("ZIP: ignora la constancia y lee el comprobante", z.number === "2589" && z.total === "1180.00", z);

// 3. Nota de crédito en dólares
const NC = FACTURA
  .replace("<Invoice ", "<CreditNote ").replace("</Invoice>", "</CreditNote>")
  .replace("Invoice-2", "CreditNote-2")
  .replace('<cbc:InvoiceTypeCode listID="0101" listAgencyName="PE:SUNAT">01</cbc:InvoiceTypeCode>', "")
  .replace("<cbc:ID>F001-2589</cbc:ID>", "<cbc:ID>FC01-45</cbc:ID>")
  .replace(/PEN/g, "USD")
  .replace("cac:InvoiceLine", "cac:CreditNoteLine").replace("cac:InvoiceLine", "cac:CreditNoteLine");
const nc = parseSunatXml(Buffer.from(NC), "nc.xml");
check("nota de credito", nc.docType === "NOTA_CREDITO", nc.docType);
check("moneda USD", nc.currency === "USD", nc.currency);
check("serie FC01 / numero 45", nc.series === "FC01" && nc.number === "45", nc);

// 4. Errores claros
const casos: [string, string][] = [
  ["constancia CDR", '<?xml version="1.0"?><ApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"><ID>R-1</ID></ApplicationResponse>'],
  ["no es XML", "esto no es xml"],
  ["sin RUC valido", FACTURA.replace("20548392117", "123")],
  ["sin total", FACTURA.replace('<cbc:PayableAmount currencyID="PEN">1180.00</cbc:PayableAmount>', "")],
];
for (const [nombre, xml] of casos) {
  try { parseSunatXml(Buffer.from(xml), "x.xml"); check(`rechaza ${nombre}`, false); }
  catch (e) { check(`rechaza ${nombre}`, e instanceof XmlParseError, e); }
}

// 5. Utilidades
check("splitDocumentId sin guion", JSON.stringify(splitDocumentId("F0012589")) === '{"series":"F001","number":"2589"}');
check("clasifica PDF", detectAttachmentKind("Factura F001-2589.pdf", "application/pdf") === "FACTURA_PDF");
check("clasifica XML", detectAttachmentKind("20548392117-01-F001-2589.xml", "text/xml") === "FACTURA_XML");
check("clasifica guia PDF", detectAttachmentKind("GRT T001-123.pdf", "application/pdf") === "GRT");
check("clasifica guia por 'guia'", detectAttachmentKind("guia de remision.pdf", "application/pdf") === "GRT");

console.log(fails === 0 ? "\nXML: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
