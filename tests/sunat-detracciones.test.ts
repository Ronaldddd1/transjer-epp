/**
 * El archivo de Depósitos Masivos de detracciones, posición por posición, contra el
 * instructivo de SUNAT.
 *
 *   npx tsx tests/sunat-detracciones.test.ts
 */
import {
  armarArchivo, lineaDeDeposito, MAXIMO_POR_LOTE, montoSunat, nombreDeArchivo, numeroSunat, periodoSunat,
  problemasDeDeposito, serieSunat, siguienteLote, textoSunat, type DepositoDetraccion,
} from "../src/lib/sunat-detracciones";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};
const lanza = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

const deposito = (cambios: Partial<DepositoDetraccion> = {}): DepositoDetraccion => ({
  etiqueta: "F001-2589",
  rucProveedor: "20548392117",
  cuentaProveedor: "00012345678",
  monto: 25,
  emision: "2026-10-14",
  tipoDocumento: "FACTURA",
  serie: "F001",
  numero: "2589",
  ...cambios,
});

// --- Montos ---
check("25 soles son 15 caracteres con los céntimos en cero", montoSunat(25) === "000000000002500", montoSunat(25));
check("cero también se escribe", montoSunat(0) === "000000000000000");
check("con céntimos no se acepta: SUNAT pide soles enteros", lanza(() => montoSunat(24.2)));

// --- Campos sueltos ---
check("la serie electrónica queda igual", serieSunat("f001") === "F001");
check("la serie física se completa con ceros", serieSunat("1") === "0001");
check("una serie de 3 letras no sirve", serieSunat("F01") === null);
check("el número va en 8 dígitos", numeroSunat("2589") === "00002589");
check("con ceros delante, igual", numeroSunat("0002589") === "00002589");
check("si tiene más de 8, los últimos 8", numeroSunat("1234567890") === "34567890");
check("un número con letras no sirve", numeroSunat("25A9") === null);
check("el periodo sale de la emisión", periodoSunat("2026-10-14") === "202610");
check("antes de setiembre de 2004 no hay periodo", periodoSunat("2004-08-31") === null);
check("las tildes y la Ñ se quitan: el archivo se mide en bytes", textoSunat("Transportes Peña & Asociados S.A.C.") === "TRANSPORTES PENA & ASOCIADOS S.A.C.");

// --- Una línea de detalle ---
const linea = lineaDeDeposito(deposito());
check("la línea de detalle mide 107", linea.length === 107, linea.length);
check("1: tipo de documento 6 (RUC)", linea.slice(0, 1) === "6");
check("2-12: RUC del proveedor", linea.slice(1, 12) === "20548392117");
check("13-47: el nombre va en blanco cuando hay RUC", linea.slice(12, 47) === " ".repeat(35));
check("48-56: proforma en ceros", linea.slice(47, 56) === "000000000");
check("57-59: 027, transporte de carga", linea.slice(56, 59) === "027");
check("60-70: cuenta del Banco de la Nación", linea.slice(59, 70) === "00012345678");
check("71-85: el monto", linea.slice(70, 85) === "000000000002500");
check("86-87: operación 01", linea.slice(85, 87) === "01");
check("88-93: periodo", linea.slice(87, 93) === "202610");
check("94-95: factura es 01", linea.slice(93, 95) === "01");
check("96-99: serie", linea.slice(95, 99) === "F001");
check("100-107: número", linea.slice(99, 107) === "00002589");
check("una boleta es 03", lineaDeDeposito(deposito({ tipoDocumento: "BOLETA", serie: "B001" })).slice(93, 95) === "03");

// --- Lo que no deja armar el archivo ---
check("sin cuenta del Banco de la Nación, se dice", problemasDeDeposito(deposito({ cuentaProveedor: null })).some((p) => p.includes("cuenta")));
check("sin RUC, se dice", problemasDeDeposito(deposito({ rucProveedor: null })).some((p) => p.includes("RUC")));
check("una nota de crédito no va", problemasDeDeposito(deposito({ tipoDocumento: "NOTA_CREDITO" })).length === 1);
check("una que está bien no tiene problemas", problemasDeDeposito(deposito()).length === 0);
check("con problemas, la línea no se arma", lanza(() => lineaDeDeposito(deposito({ cuentaProveedor: "123" }))));

// --- El archivo completo ---
const archivo = armarArchivo({
  rucPagador: "20100000001",
  razonSocialPagador: "Transportes Jer S.A.C.",
  lote: "260001",
  depositos: [deposito(), deposito({ numero: "2590", monto: 118, rucProveedor: "20600000002", cuentaProveedor: "00087654321" })],
});
const lineas = archivo.contenido.split("\r\n");
check("el nombre es D + RUC + lote", archivo.nombre === "D20100000001260001.txt" && nombreDeArchivo("20100000001", "260001") === archivo.nombre);
check("una cabecera y una línea por detracción, con salto de Windows", lineas.length === 3 && !archivo.contenido.endsWith("\r\n"));
const cab = lineas[0];
check("la cabecera mide 68", cab.length === 68, cab.length);
check("1: asterisco del adquiriente", cab[0] === "*");
check("2-12: RUC de la empresa", cab.slice(1, 12) === "20100000001");
check("13-47: razón social en mayúsculas, rellena con espacios", cab.slice(12, 47) === "TRANSPORTES JER S.A.C.".padEnd(35, " "));
check("48-53: lote", cab.slice(47, 53) === "260001");
check("54-68: el total del lote", cab.slice(53, 68) === "000000000014300" && archivo.total === 143);
check("todo el archivo es ASCII", /^[\x20-\x7e\r\n]*$/.test(archivo.contenido));
check("una razón social larga se corta en 35",
  armarArchivo({ rucPagador: "20100000001", razonSocialPagador: "X".repeat(60), lote: "260001", depositos: [deposito()] })
    .contenido.split("\r\n")[0].length === 68);
check("sin detracciones no hay archivo", lanza(() => armarArchivo({ rucPagador: "20100000001", razonSocialPagador: "A", lote: "260001", depositos: [] })));
check("un lote mal escrito no pasa", lanza(() => armarArchivo({ rucPagador: "20100000001", razonSocialPagador: "A", lote: "26001", depositos: [deposito()] })));
check(`el tope por archivo respeta los 200 000 bytes (${MAXIMO_POR_LOTE})`, 68 + MAXIMO_POR_LOTE * 109 <= 200_000 && 68 + (MAXIMO_POR_LOTE + 1) * 109 > 200_000);

// --- Número de lote ---
check("el primero del año es 0001", siguienteLote("2026-11-09", []) === "260001");
check("sigue al mayor del año", siguienteLote("2026-11-09", ["260001", "260007", "250099"]) === "260008");
check("el año nuevo vuelve a empezar", siguienteLote("2027-01-02", ["260045"]) === "270001");

console.log(fails ? `\n${fails} FALLAS` : "\nTodo en orden.");
process.exit(fails ? 1 : 0);
