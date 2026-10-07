/**
 * Lectura del control de facturas en Excel, contra el archivo real de la encargada.
 *
 * La hoja no es una tabla limpia: tiene un título sobre la cabecera, ocho hojas (varias con
 * tablas dinámicas y notas), importes que son fórmulas y celdas donde el volumen viene
 * escrito "50m3". Cada una de esas cosas rompió el lector una vez; aquí quedan fijadas.
 *
 *   npx tsx --conditions=react-server tests/hoja-facturas.test.ts
 */
import { readFileSync } from "node:fs";
import {
  estadoDeDetraccion, estadoDePago, partirComprobante, readInvoiceSheet,
} from "../src/server/invoice-sheet";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

async function main() {
  // ---------- Serie y número ----------
  check("E001-356 se parte en serie y número", JSON.stringify(partirComprobante("E001-356")) === '{"serie":"E001","numero":"356"}');
  check("quita los ceros a la izquierda del número", partirComprobante("F001-00412")?.numero === "412");
  check("tolera espacios", partirComprobante(" e001 - 52 ")?.serie === "E001");
  check("acepta serie de cuatro caracteres", partirComprobante("E0001-52")?.serie === "E0001");
  check("rechaza lo que no es un comprobante", partirComprobante("sin número") === null);

  // ---------- Estados ----------
  check("«Pagado» es pagada", estadoDePago("Pagado") === "PAGADA");
  check("«Anulado» es anulada", estadoDePago("Anulado") === "ANULADA");
  check("vacío es pendiente", estadoDePago("") === "PENDIENTE");
  check("una nota de crédito deja la detracción observada", estadoDeDetraccion("NC E001-29").estado === "OBSERVADA");
  check("y conserva lo que decía la hoja", estadoDeDetraccion("NC E001-29").nota === "NC E001-29");
  check("«N/A» es no aplica", estadoDeDetraccion("N/A").estado === "NO_APLICA");

  // ---------- El archivo real ----------
  const hoja = await readInvoiceSheet(readFileSync("tests/datos/control-facturas.xlsx"));

  check("encuentra la hoja del control entre las ocho", hoja.hoja === "PROVEEDORES LOCAL-PROVINCIA", hoja.hoja);
  check("encuentra la cabecera, que no está en la primera fila", hoja.filaCabecera === 2, hoja.filaCabecera);
  check("lee las 158 facturas", hoja.filas.length === 158, hoja.filas.length);
  check("ninguna fila queda sin entender", hoja.avisos.length === 0, hoja.avisos);

  const primera = hoja.filas[0];
  check("la primera factura es la que corresponde", primera.serie === "E001" && primera.numero === "356", primera);
  check("la fecha no se corre un día por la zona horaria", primera.fechaEmision === "2026-01-11", primera.fechaEmision);
  // El IGV y el total son fórmulas en la hoja: leídos sin desenvolver daban cero.
  check("el IGV sale de la fórmula", primera.igv === 738, primera.igv);
  check("el total sale de la fórmula", primera.total === 4838, primera.total);
  check("la base se lee tal cual", primera.base === 4100, primera.base);
  // "50m3": el 3 de la unidad se colaba y daba 503.
  check("el volumen no se come la unidad", primera.m3 === 50, primera.m3);
  check("el peso tampoco", primera.tn === 7, primera.tn);
  check("la detracción de la hoja se conserva", primera.detraccionExcel === 194, primera.detraccionExcel);
  check("trae el dato del servicio", primera.placa === "D7S943" && primera.cliente === "Sonepar", primera);

  const conImporte = hoja.filas.filter((f) => f.total && f.total > 0);
  check("solo tres filas no tienen importe", conImporte.length === 155, hoja.filas.length - conImporte.length);
  check("todas tienen fecha de emisión", hoja.filas.every((f) => f.fechaEmision), hoja.filas.filter((f) => !f.fechaEmision).length);

  // Si esto cambia, es que alguien renombró una columna de la hoja y hay que mirarlo.
  check("solo quedan fuera las dos columnas calculadas",
    hoja.columnasIgnoradas.join("|") === "Total Pagar Proveedor|Saldo restante", hoja.columnasIgnoradas);

  // 594,181.09 es la suma de la columna «Flete Total Bruto» de la hoja, comprobada aparte
  // con otra herramienta. Si esto cambia, el lector dejó de leer bien algún importe.
  const total = conImporte.reduce((s, f) => s + (f.total ?? 0), 0);
  check("el importe total coincide con la suma de la hoja", Math.round(total) === 594181, Math.round(total));

  const proveedores = new Set(hoja.filas.map((f) => f.proveedor.toLowerCase().replace(/[^a-z0-9]/g, "")));
  check("reconoce 35 formas de escribir el nombre del proveedor", proveedores.size === 35, proveedores.size);

  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
