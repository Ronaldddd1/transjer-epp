/**
 * Qué archivos le faltan a un correo de comprobante, y el aviso de aceptación.
 *
 *   npx tsx tests/archivos-correo.test.ts
 */
import {
  archivosFaltantes, clasificarArchivo, FALTA_FACTURA, FALTA_GUIA_TRANSPORTISTA, FALTA_XML, SIN_ADJUNTOS, XML_ILEGIBLE,
} from "../src/lib/archivos-correo";
import { acceptanceEmailBody } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const a = (...nombres: string[]) => nombres.map((filename) => ({ filename }));

// --- Clasificar por el nombre ---
check("el XML", clasificarArchivo({ filename: "20613781359-01-F001-12.xml" }) === "XML");
check("la factura con el nombre de SUNAT", clasificarArchivo({ filename: "20613781359-01-F001-12.pdf" }) === "COMPROBANTE");
check("la guía del transportista (31)", clasificarArchivo({ filename: "20613781359-31-EG03-110(1).pdf" }) === "GUIA_TRANSPORTISTA");
check("la guía del remitente (09)", clasificarArchivo({ filename: "20100055237-09-T001-5.pdf" }) === "GUIA_REMITENTE");
check("una guía nombrada a mano es la del remitente", clasificarArchivo({ filename: "Guía de remisión 123.pdf" }) === "GUIA_REMITENTE");
check("la del transportista nombrada a mano", clasificarArchivo({ filename: "Guia transportista EG03-110.pdf" }) === "GUIA_TRANSPORTISTA");
check("GRT es la del transportista", clasificarArchivo({ filename: "GRT 110.pdf" }) === "GUIA_TRANSPORTISTA");
check("una nota de crédito (07)", clasificarArchivo({ filename: "20613781359-07-E001-71.pdf" }) === "NOTA_CREDITO");
check("un comprimido", clasificarArchivo({ filename: "comprobantes.zip" }) === "COMPRIMIDO");
check("una foto de la factura", clasificarArchivo({ filename: "IMG_2041.jpg" }) === "COMPROBANTE");
check("una hoja de cálculo no cuenta", clasificarArchivo({ filename: "detalle.xlsx" }) === "OTRO");

// --- Lo que falta: factura, XML y la guía transportista del proveedor ---
check("completo, nada",
  igual(archivosFaltantes(a("x-01-F001-1.xml", "x-01-F001-1.pdf", "x-31-EG03-1.pdf"), { xmlLegible: true }), []));
check("sin guía, se dice que falta la guía transportista",
  igual(archivosFaltantes(a("x-01-F001-1.xml", "x-01-F001-1.pdf"), { xmlLegible: true }), [FALTA_GUIA_TRANSPORTISTA]));
check("ya no se pide aparte la guía de remisión",
  !archivosFaltantes(a("x-01-F001-1.xml", "x-01-F001-1.pdf", "x-31-EG03-1.pdf"), { xmlLegible: true }).some((m) => m.includes("remisión")));
check("una guía nombrada a mano sirve", igual(archivosFaltantes(a("f.xml", "factura.pdf", "guia.pdf"), { xmlLegible: true }), []));
check("sin archivos", igual(archivosFaltantes([], { xmlLegible: false }), [SIN_ADJUNTOS]));
check("solo el PDF: faltan XML y la guía",
  igual(archivosFaltantes(a("factura.pdf"), { xmlLegible: false }), [FALTA_XML, FALTA_GUIA_TRANSPORTISTA]));
check("el XML que no se pudo leer se dice distinto",
  igual(archivosFaltantes(a("malo.xml", "factura.pdf", "grt.pdf"), { xmlLegible: false }), [XML_ILEGIBLE]));
check("solo la guía: faltan XML y factura",
  igual(archivosFaltantes(a("guia remision.pdf"), { xmlLegible: false }), [FALTA_XML, FALTA_FACTURA]));
check("una nota de crédito no pide guía",
  igual(archivosFaltantes(a("x-07-E001-1.xml", "x-07-E001-1.pdf"), { xmlLegible: true, esNotaCredito: true }), []));
check("un comprimido puede traer todo: no se reclama PDF ni guía",
  igual(archivosFaltantes(a("todo.zip"), { xmlLegible: true }), []));

// --- El caso de E001-30: su guía EG03-75 vino; la VT01-8407 del concepto es de TransJer ---
const caso = a("10408642391-31-EG03-75.pdf", "FACTURAE001-3010408642391.XML", "FACTURAE001-3010408642391.pdf");
const guias30 = { delProveedor: ["EG03 - 75"], nuestras: ["VT01-8407"] };
check("con la guía del proveedor (la del XML), no falta nada",
  igual(archivosFaltantes(caso, { xmlLegible: true, guias: guias30 }), []), archivosFaltantes(caso, { xmlLegible: true, guias: guias30 }));
check("la guía de TransJer del concepto no se le pide",
  !archivosFaltantes(a("f.xml", "f.pdf", "EG03-75.pdf"), { xmlLegible: true, guias: guias30 }).length);
check("si solo viene la guía de TransJer, falta la del proveedor",
  igual(archivosFaltantes(a("f.xml", "f.pdf", "Guia VT01-8407.pdf"), { xmlLegible: true, guias: guias30 }), [FALTA_GUIA_TRANSPORTISTA]));
check("con ceros delante también cruza",
  igual(archivosFaltantes(a("f.xml", "f.pdf", "EG03-00000075.pdf"), { xmlLegible: true, guias: guias30 }), []));
check("el PDF de la guía no cuenta como la factura",
  archivosFaltantes(a("EG03-75.pdf"), { xmlLegible: true, guias: guias30 }).includes(FALTA_FACTURA));

// --- El aviso de aceptación ---
const cuerpo = acceptanceEmailBody({ comprobante: "F001-12", proveedor: "RYK LOGISTICS SAC", total: "S/ 1,180.00", transporte: true });
check("saluda al proveedor", cuerpo.startsWith("Estimados señores de RYK LOGISTICS SAC:"));
check("dice qué comprobante y por cuánto", cuerpo.includes("aceptamos el comprobante F001-12, por S/ 1,180.00"));
check("un flete dice que el plazo corre desde la guía", cuerpo.includes("15 días después de que recibamos en físico las guías"));
const conFormato = acceptanceEmailBody({
  comprobante: "F001-12", proveedor: null, total: "S/ 10.00", transporte: true, formatoConcepto: "FECHA: 1/1/2026 | PLACA: ABC-123",
});
check("a un flete se le pide el formato del concepto", conFormato.includes("escribir el concepto con este formato")
  && conFormato.includes("FECHA: 1/1/2026 | PLACA: ABC-123"));
check("un servicio no habla de guías",
  !acceptanceEmailBody({ comprobante: "F001-1", proveedor: null, total: "S/ 10.00", transporte: false }).includes("guías"));

console.log(fails ? `\n${fails} FALLAS` : "\nTodo en orden.");
process.exit(fails ? 1 : 0);
