/**
 * Prueba de los cronogramas de préstamos.
 *
 * Los casos vienen de cronogramas reales de Transjer: Interbank Capital de Trabajo,
 * Crédito Pyme y BCP Crédito Negocios. Se comprueban dos cosas distintas:
 *
 *   El generador  debe reproducir los intereses del banco al céntimo cuando el banco
 *                 liquida por días reales sobre 360, que es lo normal en Perú.
 *
 *   El importador debe reconocer las columnas de cada banco, que las ordenan distinto,
 *                 y sobre todo no confundir la columna del saldo con la de la cuota.
 */
import { applyMapping, buildSchedule, detectSchedule, monthlyDueDates, parseScheduleDate } from "../src/lib/amortization";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};
/** Cerca, en céntimos: los redondeos del banco y los nuestros no tienen por qué coincidir. */
const cerca = (a: number, b: number, tolerancia = 0.05) => Math.abs(a - b) <= tolerancia;

// ---------- Fechas ----------
check("fecha con barras", parseScheduleDate("08/06/2026") === "2026-06-08");
check("fecha con año de dos dígitos", parseScheduleDate("6/11/25") === "2025-11-06");
check("fecha compacta del BCP (ddmmaa)", parseScheduleDate("160225") === "2025-02-16");
check("fecha ISO se mantiene", parseScheduleDate("2026-06-08") === "2026-06-08");
check("texto que no es fecha", parseScheduleDate("CUOTA") === null);

const meses = monthlyDueDates("2026-01-31", 3);
check("mantiene el día del mes", monthlyDueDates("2026-06-08", 3).join(",") === "2026-06-08,2026-07-08,2026-08-08");
check("el 31 cae al último día de febrero", meses[1] === "2026-02-28", meses);
check("cruza el año", monthlyDueDates("2026-12-06", 2).join(",") === "2026-12-06,2027-01-06");

// ---------- Generador: Interbank Capital de Trabajo ----------
// S/ 250,012.50 · TEA 17 % · 24 cuotas · desembolso 24/04/2026 · primera cuota 08/06/2026
const ibk = buildSchedule({
  principal: 250012.50, annualRate: 17, installments: 24,
  firstDueDate: "2026-06-08", disbursedAt: "2026-04-24",
});
check("Interbank: 24 cuotas", ibk.length === 24);
check("Interbank: el primer período dura 45 días", ibk[0].days === 45, ibk[0].days);
check("Interbank: interés de la cuota 1 = 4,955.08", cerca(ibk[0].interest, 4955.08), ibk[0].interest);
check("Interbank: interés de la cuota 12 = 1,924.79", cerca(ibk[11].interest, 1924.79, 0.10), ibk[11].interest);
check("Interbank: cuota ≈ 12,325.06", cerca(ibk[0].total, 12325.06, 1), ibk[0].total);
check("Interbank: el saldo llega a cero", ibk[23].balanceAfter === 0, ibk[23].balanceAfter);
check("Interbank: el saldo nunca es negativo", ibk.every((r) => r.balanceAfter >= 0));
check("Interbank: el saldo baja en cada cuota", ibk.slice(1).every((r, i) => r.balanceAfter < ibk[i].balanceAfter));
// El interés NO baja todos los meses: un mes de 31 días cobra más que el de 30 anterior
// aunque el saldo sea menor, y así lo imprime el banco (en el cronograma real de Interbank
// la cuota 6 cobra más interés que la 5). Lo que sí se cumple es la tendencia de punta a punta.
check("Interbank: el interés baja de la primera a la última", ibk[23].interest < ibk[0].interest);
check("Interbank: el capital sube de la primera a la última", ibk[23].principal > ibk[0].principal);
check("Interbank: hay algún mes en que el interés sube, como en el papel del banco",
  ibk.slice(1).some((r, i) => r.interest > ibk[i].interest));

// ---------- Generador: Crédito Pyme ----------
// S/ 180,000 · TEA 17 % · 24 cuotas · inicio 06/11/2025 · primera cuota 06/12/2025
const pyme = buildSchedule({
  principal: 180000, annualRate: 17, installments: 24,
  firstDueDate: "2025-12-06", disbursedAt: "2025-11-06",
});
check("Pyme: interés de la cuota 1 = 2,370.53", cerca(pyme[0].interest, 2370.53), pyme[0].interest);
check("Pyme: interés de la cuota 2 = 2,362.38", cerca(pyme[1].interest, 2362.38), pyme[1].interest);
check("Pyme: cuota ≈ 8,813.55", cerca(pyme[0].total, 8813.55, 1), pyme[0].total);
check("Pyme: intereses totales ≈ 31,524.98",
  cerca(pyme.reduce((s, r) => s + r.interest, 0), 31524.98, 20), pyme.reduce((s, r) => s + r.interest, 0));
check("Pyme: la suma del capital devuelve el préstamo",
  cerca(pyme.reduce((s, r) => s + r.principal, 0), 180000, 0.05));

// ---------- Generador: desgravamen a tasa simple, como el BCP ----------
const conSeguro = buildSchedule({
  principal: 250000, annualRate: 16, installments: 24,
  firstDueDate: "2025-02-16", disbursedAt: "2025-01-16", insuranceRate: 1.08,
});
check("BCP: desgravamen de la cuota 1 = 232.50", cerca(conSeguro[0].insurance, 232.50), conSeguro[0].insurance);
check("BCP: la cuota incluye el seguro",
  cerca(conSeguro[0].total, conSeguro[0].principal + conSeguro[0].interest + conSeguro[0].insurance));

// ---------- Generador: datos imposibles ----------
const rechaza = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
check("rechaza capital cero", rechaza(() => buildSchedule({ principal: 0, annualRate: 17, installments: 12, firstDueDate: "2026-01-01", disbursedAt: "2025-12-01" })));
check("rechaza cero cuotas", rechaza(() => buildSchedule({ principal: 1000, annualRate: 17, installments: 0, firstDueDate: "2026-01-01", disbursedAt: "2025-12-01" })));
check("rechaza primera cuota antes del desembolso", rechaza(() => buildSchedule({ principal: 1000, annualRate: 17, installments: 12, firstDueDate: "2025-11-01", disbursedAt: "2025-12-01" })));
check("acepta tasa cero", buildSchedule({ principal: 1200, annualRate: 0, installments: 12, firstDueDate: "2026-01-01", disbursedAt: "2025-12-01" })[0].interest === 0);

// ---------- Importador ----------
function importar(nombre: string, texto: string) {
  const d = detectSchedule(texto);
  if ("error" in d) { fails++; console.log("FALLA", nombre, d.error); return null; }
  const { rows, errors } = applyMapping(d, d.guess);
  check(`${nombre}: sin avisos de descuadre`, errors.length === 0, errors);
  return rows;
}

// BCP: fecha · SALDO · amortización · interés · desgravamen · seguro · comisión · CUOTA
// El saldo va ANTES del desglose: es la trampa clásica de este formato.
const bcp = importar("BCP", `
160225 250,000.00 8,699.63 3,339.62 232.50 0.00 0.00 12,271.75
160325 241,300.38 9,266.24 2,802.82 202.69 0.00 0.00 12,271.75
160425 232,034.14 9,072.00 2,983.95 215.79 0.00 0.00 12,271.75
160525 222,962.14 9,296.29 2,774.79 200.67 0.00 0.00 12,271.75
160625 213,665.86 9,325.30 2,747.74 198.71 0.00 0.00 12,271.75
`);
check("BCP: lee las 5 filas", bcp?.length === 5, bcp?.length);
check("BCP: la cuota es 12,271.75, no el saldo", bcp?.[0].total === 12271.75, bcp?.[0].total);
check("BCP: el capital es 8,699.63", bcp?.[0].principal === 8699.63, bcp?.[0].principal);
check("BCP: la fecha compacta se entiende", bcp?.[0].dueDate === "2025-02-16");
// El BCP imprime el saldo que se DEBE al empezar el período (la fila 1 trae el préstamo
// entero). Al guardarlo hay que pasarlo a "lo que queda después de pagar": 250,000 − 8,699.63.
check("BCP: convierte el saldo de antes a después de la cuota",
  bcp?.[0].balanceAfter === 241300.37, bcp?.[0].balanceAfter);
check("BCP: el saldo de la segunda fila también se corre",
  bcp?.[1].balanceAfter === 232034.14, bcp?.[1].balanceAfter);

// Interbank Capital de Trabajo: nro · fecha · días · SALDO · capital · interés · seguros · CUOTA
const ibkImport = importar("Interbank", `
1 08/06/2026 45 250,012.50 7,369.98 4,955.08 0.00 0.00 0.00 12,325.06
2 08/07/2026 30 242,642.52 9,129.55 3,195.51 0.00 0.00 0.00 12,325.06
3 08/08/2026 31 233,512.97 9,146.58 3,178.48 0.00 0.00 0.00 12,325.06
4 08/09/2026 31 224,366.39 9,271.08 3,053.98 0.00 0.00 0.00 12,325.06
`);
check("Interbank: la cuota es 12,325.06", ibkImport?.[0].total === 12325.06, ibkImport?.[0].total);
check("Interbank: no confunde los días con un importe", ibkImport?.[0].principal === 7369.98, ibkImport?.[0].principal);
// Interbank Banca Pequeña Empresa también imprime el saldo adeudado al inicio del período.
check("Interbank: convierte el saldo al de después de la cuota",
  ibkImport?.[0].balanceAfter === 242642.52, ibkImport?.[0].balanceAfter);

// Préstamo Fácil de Interbank: fecha · nro · capital · interés · seguro · … · CUOTA · SALDO
// Aquí el saldo va al FINAL, después de la cuota: el formato opuesto al del BCP.
const facil = importar("Préstamo Fácil", `
22/01/2030 39 5,735.01 492.31 46.34 0.00 0.00 0.00 6,273.66 54,796.71
22/02/2030 40 5,786.66 439.34 47.66 0.00 0.00 0.00 6,273.66 49,010.05
22/03/2030 41 5,881.02 358.85 33.79 0.00 0.00 0.00 6,273.66 43,129.03
22/04/2030 42 5,891.76 349.04 32.86 0.00 0.00 0.00 6,273.66 37,237.27
`);
check("Préstamo Fácil: la cuota es 6,273.66, no el saldo final", facil?.[0].total === 6273.66, facil?.[0].total);
check("Préstamo Fácil: la fecha va primero", facil?.[0].dueDate === "2030-01-22");
// El Préstamo Fácil ya imprime el saldo que QUEDA tras pagar: se guarda sin tocarlo.
check("Préstamo Fácil: el saldo posterior se guarda tal cual",
  facil?.[0].balanceAfter === 54796.71, facil?.[0].balanceAfter);

// Crédito Pyme: cuo · fecha · capital · interés · comisión · seguros · CUOTA (sin saldo)
const pymeImport = importar("Pyme", `
1 6/12/25 6443.02 2370.53 0.00 0.00 8813.55
2 6/01/26 6451.17 2362.38 0.00 0.00 8813.55
3 6/02/26 6538.98 2274.57 0.00 0.00 8813.55
`);
check("Pyme: la cuota es 8,813.55", pymeImport?.[0].total === 8813.55, pymeImport?.[0].total);
check("Pyme: importes sin separador de miles", pymeImport?.[0].principal === 6443.02);
check("Pyme: sin columna de saldo, no se inventa", pymeImport?.[0].balanceAfter === null, pymeImport?.[0].balanceAfter);

// Encabezados, totales y líneas sueltas se ignoran sin romper nada.
const conRuido = detectSchedule(`
CRONOGRAMA DE PAGOS
Nro  Vencimiento  Capital  Interes  Cuota
1 6/12/25 6443.02 2370.53 8813.55
2 6/01/26 6451.17 2362.38 8813.55
TOTALES: 180000.00 31524.98 211524.98
`);
check("ignora encabezados y totales", !("error" in conRuido) && conRuido.cells.length === 2,
  "error" in conRuido ? conRuido.error : conRuido.cells.length);

// Texto sin ninguna fecha: se avisa en vez de inventar filas.
const vacio = detectSchedule("esto no es un cronograma");
check("texto sin fechas devuelve error", "error" in vacio);

// Un descuadre entre el desglose y la cuota debe avisarse, no pasarse por alto.
const malAsignado = detectSchedule(`
1 6/12/25 6443.02 2370.53 8813.55
2 6/01/26 6451.17 2362.38 8813.55
`);
if (!("error" in malAsignado)) {
  const forzado = applyMapping(malAsignado, { ...malAsignado.guess, insurance: malAsignado.guess.total });
  check("avisa cuando el desglose no cuadra con la cuota", forzado.errors.length > 0, forzado.errors.slice(0, 1));
}

console.log(fails === 0 ? "\nAMORTIZACIÓN: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
