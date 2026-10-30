/**
 * El filtro del monto: lo facturado contra lo pactado por el flete.
 *
 * Es el paso que va antes de aceptar o rechazar un comprobante, y el número que tiene que
 * dar bien es uno solo: la diferencia. De ella depende que una factura entre en la cola de
 * pagos o se frene, así que lo que se cuida aquí es que no invente diferencias donde no
 * las hay —el redondeo del IGV— ni las esconda cuando sí las hay.
 *
 *   npx tsx tests/filtro-monto.test.ts
 */
import "dotenv/config";
import { compararMonto, TOLERANCIA_MONTO, AMOUNT_CHECK_LABEL } from "../src/lib/utils";
import { verifyAmountSchema } from "../src/lib/validations";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

/** Lo que decide la acción del servidor con lo que devuelve la comparación. */
function estadoDelFiltro(facturado: string, pactado: string, aprobarDiferencia = false) {
  const { coincide } = compararMonto(facturado, pactado);
  return coincide || aprobarDiferencia ? "CONFORME" : "OBSERVADO";
}

function main() {
  // ---------- Lo que cuadra ----------
  const igual = compararMonto("2950.00", "2950.00");
  check("el mismo importe no tiene diferencia", igual.diferencia === 0 && igual.coincide, igual);

  const centavos = compararMonto("2950.37", "2950.00");
  check("los centavos del redondeo del IGV no frenan la factura",
    centavos.coincide && centavos.diferencia === 0.37, centavos);

  const justo = compararMonto("2951.00", "2950.00");
  check(`un sol de diferencia todavía pasa (la tolerancia es ${TOLERANCIA_MONTO})`,
    justo.coincide, justo);

  // ---------- Lo que no cuadra ----------
  const deMas = compararMonto("3100.00", "2950.00");
  check("cobrar de más se detecta, y se dice de cuánto",
    !deMas.coincide && deMas.cobraDeMas && deMas.diferencia === 150, deMas);

  const deMenos = compararMonto("2800.00", "2950.00");
  check("facturar de menos también se detecta",
    !deMenos.coincide && !deMenos.cobraDeMas && deMenos.diferencia === -150, deMenos);

  const apenas = compararMonto("2951.01", "2950.00");
  check("pasado el sol de tolerancia ya no cuadra", !apenas.coincide, apenas);

  // La resta se hace con dos decimales: en coma flotante, 1180.30 − 1180.20 da 0.0999…,
  // y sin redondear, una diferencia de diez céntimos se contaría como otra cosa.
  const flotante = compararMonto("1180.30", "1180.20");
  check("la resta no arrastra basura de coma flotante", flotante.diferencia === 0.1, flotante);

  // ---------- Qué hace el filtro con eso ----------
  check("si coincide, queda conforme y el comprobante se puede aceptar",
    estadoDelFiltro("2950.00", "2950.00") === "CONFORME");
  check("si no coincide, queda observado y frena la aceptación",
    estadoDelFiltro("3100.00", "2950.00") === "OBSERVADO");
  check("y queda conforme solo si alguien aprueba la diferencia a propósito",
    estadoDelFiltro("3100.00", "2950.00", true) === "CONFORME");

  check("los tres estados del filtro tienen nombre en palabras",
    Object.keys(AMOUNT_CHECK_LABEL).length === 3 && AMOUNT_CHECK_LABEL.OBSERVADO.length > 0);

  // ---------- Lo que llega del formulario ----------
  const vacio = verifyAmountSchema.safeParse({ agreedAmount: "" });
  check("sin monto pactado no se puede verificar nada", !vacio.success);

  const conComas = verifyAmountSchema.safeParse({ agreedAmount: "2,950.50" });
  check("el monto se entiende escrito con comas de miles",
    conComas.success && conComas.data.agreedAmount === "2950.50",
    conComas.success ? conComas.data.agreedAmount : conComas.error.issues[0]?.message);

  const letras = verifyAmountSchema.safeParse({ agreedAmount: "dos mil" });
  check("y no se acepta cualquier cosa como importe", !letras.success);

  const aprobando = verifyAmountSchema.safeParse({
    agreedAmount: "3100", aprobarDiferencia: "true", amountNote: "Recargo acordado por la espera",
  });
  check("aprobar la diferencia llega como una decisión, con su motivo",
    aprobando.success && aprobando.data.aprobarDiferencia === true
    && aprobando.data.amountNote === "Recargo acordado por la espera",
    aprobando.success ? aprobando.data : aprobando.error.issues[0]?.message);

  const sinMarcar = verifyAmountSchema.safeParse({ agreedAmount: "3100" });
  check("y si no se marca, no se aprueba sola",
    sinMarcar.success && sinMarcar.data.aprobarDiferencia === false,
    sinMarcar.success ? sinMarcar.data.aprobarDiferencia : "");

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
