/**
 * El filtro del monto se compara sin IGV.
 *
 * Lo que se acuerda con el proveedor es el valor del flete; el IGV lo pone la ley y no se
 * negocia. Comparar contra el total obligaba a sumarle el 18 % de cabeza al precio
 * acordado, que es justo el cálculo que el filtro vino a quitar —y donde se cometía el
 * error, porque 2,500 pactados contra 2,950 facturados parecen una diferencia de 450
 * cuando en realidad cuadran.
 *
 *   npx tsx tests/monto-sin-igv.test.ts
 */
import "dotenv/config";
import { compararMonto, TOLERANCIA_MONTO, valorSinIgv } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

function main() {
  // ---------- El valor de venta sale del XML ----------
  check("usa el valor de venta que trae el comprobante",
    valorSinIgv("2500.00", "2950.00") === "2500.00", valorSinIgv("2500.00", "2950.00"));

  // Un flete de 2,500 + IGV se factura 2,950: pactado y facturado cuadran.
  check("2,500 pactados cuadran con una factura de 2,950",
    compararMonto(valorSinIgv("2500.00", "2950.00"), "2500.00").coincide);

  check("y contra el total NO cuadrarían, que era el problema",
    !compararMonto("2950.00", "2500.00").coincide);

  // ---------- Cuando el XML no trae el valor de venta ----------
  const deducido = valorSinIgv(null, "2950.00");
  check("si no viene, se deduce del total quitándole el IGV",
    deducido === "2500.00", deducido);
  check("y el deducido también cuadra con lo pactado",
    compararMonto(deducido, "2500.00").coincide, deducido);

  check("un comprobante sin IGV (exonerado) se compara contra su propio importe",
    valorSinIgv("1800.00", "1800.00") === "1800.00");

  // ---------- Lo que no cuadra sigue sin cuadrar ----------
  const caro = compararMonto(valorSinIgv("2700.00", "3186.00"), "2500.00");
  check("si el proveedor factura 200 de más, se ve",
    !caro.coincide && caro.cobraDeMas && caro.diferencia === 200, caro);

  const barato = compararMonto(valorSinIgv("2300.00", "2714.00"), "2500.00");
  check("y si factura de menos, también",
    !barato.coincide && !barato.cobraDeMas && barato.diferencia === -200, barato);

  // ---------- El redondeo no frena una factura ----------
  check("un sol de diferencia sigue siendo el mismo importe",
    compararMonto("2500.00", "2499.20").coincide && TOLERANCIA_MONTO === 1);
  check("pero dos soles ya no",
    !compararMonto("2500.00", "2498.00").coincide);

  // ---------- Casos sucios ----------
  check("sin datos no revienta: devuelve cero",
    valorSinIgv(null, null) === "0.00" && valorSinIgv("0", "0") === "0.00");
  check("un valor de venta en cero no se toma por bueno: se deduce del total",
    valorSinIgv("0.00", "1180.00") === "1000.00", valorSinIgv("0.00", "1180.00"));

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
