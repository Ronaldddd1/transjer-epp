/**
 * Qué archivos le faltan a un correo de comprobante, y el aviso de aceptación.
 *
 *   npx tsx tests/archivos-correo.test.ts
 */
import {
  archivosFaltantes, clasificarArchivo, FALTA_FACTURA, FALTA_GUIA, FALTA_XML, SIN_ADJUNTOS, XML_ILEGIBLE,
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
check("la guía del transportista (31)", clasificarArchivo({ filename: "20613781359-31-EG03-110(1).pdf" }) === "GUIA");
check("la guía del remitente (09)", clasificarArchivo({ filename: "20100055237-09-T001-5.pdf" }) === "GUIA");
check("una guía nombrada a mano", clasificarArchivo({ filename: "Guía de remisión 123.pdf" }) === "GUIA");
check("una nota de crédito (07)", clasificarArchivo({ filename: "20613781359-07-E001-71.pdf" }) === "NOTA_CREDITO");
check("un comprimido", clasificarArchivo({ filename: "comprobantes.zip" }) === "COMPRIMIDO");
check("una foto de la factura", clasificarArchivo({ filename: "IMG_2041.jpg" }) === "COMPROBANTE");
check("una hoja de cálculo no cuenta", clasificarArchivo({ filename: "detalle.xlsx" }) === "OTRO");

// --- Lo que falta ---
check("completo, nada", igual(archivosFaltantes(a("x-01-F001-1.xml", "x-01-F001-1.pdf", "x-31-T001-1.pdf"), { xmlLegible: true }), []));
check("sin archivos", igual(archivosFaltantes([], { xmlLegible: false }), [SIN_ADJUNTOS]));
check("solo el PDF: faltan XML y guía",
  igual(archivosFaltantes(a("factura.pdf"), { xmlLegible: false }), [FALTA_XML, FALTA_GUIA]));
check("el XML que no se pudo leer se dice distinto",
  igual(archivosFaltantes(a("malo.xml", "factura.pdf", "guia.pdf"), { xmlLegible: false }), [XML_ILEGIBLE]));
check("solo la guía: faltan XML y factura",
  igual(archivosFaltantes(a("guia remision.pdf"), { xmlLegible: false }), [FALTA_XML, FALTA_FACTURA]));
check("una nota de crédito no pide guía",
  igual(archivosFaltantes(a("x-07-E001-1.xml", "x-07-E001-1.pdf"), { xmlLegible: true, esNotaCredito: true }), []));
check("un comprimido puede traer todo: no se reclama PDF ni guía",
  igual(archivosFaltantes(a("todo.zip"), { xmlLegible: true }), []));

// --- El aviso de aceptación ---
const cuerpo = acceptanceEmailBody({ comprobante: "F001-12", proveedor: "RYK LOGISTICS SAC", total: "S/ 1,180.00", transporte: true });
check("saluda al proveedor", cuerpo.startsWith("Estimados señores de RYK LOGISTICS SAC:"));
check("dice qué comprobante y por cuánto", cuerpo.includes("aceptamos el comprobante F001-12, por S/ 1,180.00"));
check("un flete dice que el plazo corre desde la guía", cuerpo.includes("15 días después de que recibamos en físico las guías"));
check("un servicio no habla de guías",
  !acceptanceEmailBody({ comprobante: "F001-1", proveedor: null, total: "S/ 10.00", transporte: false }).includes("guías"));

console.log(fails ? `\n${fails} FALLAS` : "\nTodo en orden.");
process.exit(fails ? 1 : 0);
