/**
 * Prueba del campo de fecha en formato peruano.
 *
 * El problema que resuelve: el input de fecha del navegador usa el orden del idioma del
 * sistema, así que en una computadora en inglés muestra mm/dd/aaaa y quien escribe 03/10/2026
 * pensando en el 3 de octubre registra el 10 de marzo. Aquí el orden es siempre día/mes/año.
 */
import { displayToIso, isoToDisplay } from "../src/components/ui/date-field";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// ---------- De ISO a lo que ve la persona ----------
check("muestra día/mes/año", isoToDisplay("2026-10-03") === "03/10/2026", isoToDisplay("2026-10-03"));
check("conserva los ceros", isoToDisplay("2026-01-05") === "05/01/2026");
check("sin fecha, campo vacío", isoToDisplay(null) === "" && isoToDisplay("") === "");
check("un valor roto no revienta", isoToDisplay("ayer") === "");

// ---------- De lo escrito a ISO ----------
check("3 de octubre, no 10 de marzo", displayToIso("03/10/2026") === "2026-10-03", displayToIso("03/10/2026"));
check("acepta un solo dígito", displayToIso("3/1/2026") === "2026-01-03", displayToIso("3/1/2026"));
check("acepta espacios alrededor", displayToIso("  03/10/2026  ") === "2026-10-03");
check("fin de año", displayToIso("31/12/2026") === "2026-12-31");

// ---------- Fechas que no existen ----------
check("31 de abril no existe", displayToIso("31/04/2026") === null, displayToIso("31/04/2026"));
check("29 de febrero de un año normal no existe", displayToIso("29/02/2026") === null, displayToIso("29/02/2026"));
check("29 de febrero de uno bisiesto sí existe", displayToIso("29/02/2028") === "2028-02-29", displayToIso("29/02/2028"));
check("mes 13 no existe", displayToIso("01/13/2026") === null);
check("día 0 no existe", displayToIso("00/10/2026") === null);
check("incompleta todavía no vale", displayToIso("03/10") === null && displayToIso("03/10/20") === null);
check("texto suelto no vale", displayToIso("hoy") === null);
check("vacío no vale", displayToIso("") === null);
check("año absurdo no vale", displayToIso("03/10/0001") === null);

// ---------- Ida y vuelta ----------
const fechas = ["2026-01-01", "2026-02-28", "2028-02-29", "2026-06-15", "2026-12-31"];
check("ida y vuelta sin pérdida", fechas.every((f) => displayToIso(isoToDisplay(f)) === f));

console.log(fails === 0 ? "\nFECHAS: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
