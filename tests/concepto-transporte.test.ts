/**
 * Lectura del concepto de una factura de transporte.
 *
 * El transportista mete todo el viaje en una línea de texto libre, y de ahí salen la
 * fecha, la ruta, el cliente, la placa y las dos guías. Lo que se prueba aquí es que
 * cada dato se encuentre por su cuenta: si el transportista escribe distinto y falta
 * uno, los otros cinco tienen que salir igual. Inventar un dato sería peor que dejarlo
 * vacío, porque nadie lo revisaría después.
 *
 *   npx tsx --conditions=react-server tests/concepto-transporte.test.ts
 */
import { leerConceptoTransporte, pareceTransporte } from "../src/server/concepto-transporte";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// El concepto real, tal cual vino en el XML.
const REAL = "POR EL SERVICIO DE TRANSPORTE DE CARGA LIMA- LOCAL CON FECHA 13/10/2026 "
  + "S/G/R/T/E VT01-007988 S/G/R/E/T EG03 - 00000349 CLIENTE TIENDAS PERUANAS SA CON PLACA BBR-905.";

function main() {
  const v = leerConceptoTransporte(REAL);
  check("lee la fecha del servicio", v.serviceDate === "2026-10-13", v.serviceDate);
  check("lee la placa, con su guion", v.plate === "BBR-905", v.plate);
  check("lee el cliente sin arrastrar lo que sigue", v.clientName === "TIENDAS PERUANAS SA", v.clientName);
  check("lee el origen", v.originCity === "LIMA", v.originCity);
  check("lee el destino", v.destinationCity === "LOCAL", v.destinationCity);
  check("lee la guía del transportista", v.grtNumber === "VT01-007988", v.grtNumber);
  check("lee la guía del remitente, pegada", v.dispatchNote === "EG03-00000349", v.dispatchNote);

  // Las dos guías se diferencian solo en el orden de dos letras. Confundirlas pondría la
  // guía del cliente donde va la del transportista, que es la que pide SUNAT.
  check("no confunde una guía con la otra", v.grtNumber !== v.dispatchNote);

  // ---------- Escrito de otras maneras ----------
  const otro = leerConceptoTransporte(
    "Servicio de transporte de carga de Lima a Arequipa con fecha 02/01/2027, placa: C5Q932, "
    + "cliente Alicorp S.A.A., G.R.T. T001-45",
  );
  check("en minúsculas y con tildes también lee", otro.serviceDate === "2027-01-02", otro.serviceDate);
  check("la placa sin guion se normaliza", otro.plate === "C5Q-932", otro.plate);
  check("con 'de X a Y' saca la ruta", otro.originCity === "LIMA" && otro.destinationCity === "AREQUIPA", otro);
  check("el cliente no se queda con la guía", otro.clientName === "ALICORP S.A.A.", otro.clientName);
  check("acepta la guía escrita como G.R.T.", otro.grtNumber === "T001-45", otro.grtNumber);

  // ---------- Lo que falta, falta: no se inventa ----------
  const pocos = leerConceptoTransporte("POR EL SERVICIO DE TRANSPORTE DE CARGA CON PLACA BJA-838");
  check("sin fecha, la fecha queda vacía", pocos.serviceDate === null, pocos.serviceDate);
  check("sin cliente, el cliente queda vacío", pocos.clientName === null, pocos.clientName);
  check("sin ruta, no inventa un destino", pocos.destinationCity === null, pocos);
  check("pero la placa que sí está se lee", pocos.plate === "BJA-838", pocos.plate);

  const nada = leerConceptoTransporte("Servicio de alquiler de local comercial mes de octubre");
  check("un concepto que no es un viaje no da nada",
    Object.values(nada).every((x) => x === null), nada);

  check("un concepto vacío no rompe nada",
    Object.values(leerConceptoTransporte(null)).every((x) => x === null));

  // Una fecha imposible no se guarda como si fuera buena.
  const malaFecha = leerConceptoTransporte("TRANSPORTE DE CARGA LIMA - PIURA CON FECHA 31/02/2026 PLACA ABC-123");
  check("una fecha que no existe se descarta", malaFecha.serviceDate === null, malaFecha.serviceDate);
  check("y el resto del concepto se lee igual", malaFecha.plate === "ABC-123", malaFecha.plate);

  // ---------- Reconocer que es transporte ----------
  check("reconoce un viaje por el texto", pareceTransporte(REAL));
  check("y uno escrito distinto también", pareceTransporte("Flete Lima - Piura, placa ABC-123"));
  check("un alquiler no es transporte", !pareceTransporte("Alquiler de local comercial"));
  check("sin concepto, no se propone nada", !pareceTransporte(null));

  console.log(fails === 0 ? "\nCONCEPTO DE TRANSPORTE: todo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
