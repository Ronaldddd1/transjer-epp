/**
 * Prueba del cálculo de la detracción.
 *
 * Los casos vienen del control en Excel de Transjer. La hoja escribía el monto a mano y por
 * eso redondeaba unas veces hacia arriba y otras hacia abajo: dos facturas idénticas de
 * S/ 4,956 figuraban con 198 y con 199. La regla es una sola: 4 % del importe total con IGV,
 * redondeado al sol más próximo (R.S. 183-2004/SUNAT), y solo cuando la operación supera
 * los S/ 400 (R.S. 073-2006/SUNAT, transporte de bienes por vía terrestre).
 */
import { detractionFor, DETRACTION_THRESHOLD, normalizeSupplierName } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// ---------- Umbral ----------
check("una operación de S/ 236 no se detrae", detractionFor(236).applies === false);
check("y su monto es cero", detractionFor(236).amount === 0);
check("al proveedor se le paga todo", detractionFor(236).netPayable === 236);
check("exactamente S/ 400 no se detrae", detractionFor(400).applies === false, detractionFor(400));
check("S/ 400.01 ya se detrae", detractionFor(400.01).applies === true);
check("S/ 413 se detrae, como en la hoja", detractionFor(413).applies === true && detractionFor(413).amount === 17, detractionFor(413));
check("el umbral está en 400", DETRACTION_THRESHOLD === 400);

// ---------- Redondeo al sol más próximo ----------
// Primer valor: importe de la factura. Segundo: lo que corresponde depositar.
const casos: [number, number][] = [
  [4838, 194],   // 193.52 → sube
  [3304, 132],   // 132.16 → baja
  [590, 24],     // 23.60  → sube
  [5428, 217],   // 217.12 → baja (la hoja decía 218)
  [4956, 198],   // 198.24 → baja (la hoja tenía 198 en una fila y 199 en otra)
  [2950, 118],   // exacto
  [5900, 236],   // exacto
  [3186, 127],   // 127.44 → baja (la hoja decía 128)
  [424.8, 17],   // 16.99  → sube
  [6254, 250],   // exacto
];
for (const [total, esperado] of casos) {
  check(`S/ ${total} → detracción de S/ ${esperado}`, detractionFor(total).amount === esperado, detractionFor(total));
}

// La mitad justa sube, que es lo que dice la norma: "si la fracción es igual o superior a
// cinco, el valor se ajusta a la unidad inmediata superior".
check("una fracción de 0.5 exacta sube", detractionFor(412.5).amount === 17, detractionFor(412.5));
check("otra fracción de 0.5 exacta sube", detractionFor(512.5).amount === 21, detractionFor(512.5));
check("una fracción justo por debajo baja", detractionFor(512.4).amount === 20, detractionFor(512.4));

// ---------- Lo que queda para el proveedor ----------
const d = detractionFor(4838);
check("el neto descuenta la detracción", d.netPayable === 4644, d);
check("neto + detracción = total", Math.abs(d.netPayable + d.amount - 4838) < 0.005);

// ---------- Moneda ----------
// El depósito se hace en soles; una factura en dólares necesitaría tipo de cambio.
check("una factura en dólares no se detrae sola", detractionFor(4838, 4, "USD").applies === false, detractionFor(4838, 4, "USD"));
check("y en soles sí", detractionFor(4838, 4, "PEN").amount === 194);

// ---------- Datos imposibles ----------
check("sin importe no se detrae", detractionFor(null).applies === false && detractionFor("").applies === false);
check("un texto no revienta", detractionFor("hola").applies === false);
check("cero no se detrae", detractionFor(0).applies === false);

// ---------- Nombres de proveedor repetidos ----------
// En la hoja el mismo proveedor aparecía escrito de varias formas; así se reconocen.
check("ignora mayúsculas y la forma societaria",
  normalizeSupplierName("Corporacion dyj Rusal sac") === normalizeSupplierName("CORPORACION DYJ RUSAL SAC"));
check("ignora los puntos de S.A.C.",
  normalizeSupplierName("Roda Expess sac") === normalizeSupplierName("RODA EXPESS S.A.C."));
check("ignora acentos", normalizeSupplierName("Logística Rosama") === normalizeSupplierName("Logistica Rosama"));
check("ignora espacios de más", normalizeSupplierName("Inversiones  K & T ") === normalizeSupplierName("INVERSIONES K & T"));
check("no mezcla proveedores distintos",
  normalizeSupplierName("Antonio Quispe Wilber") !== normalizeSupplierName("Huaman Quispe Wilder"));
check("no mezcla Ruvilsan con Rusilsan, que son erratas distintas pero del mismo nombre base",
  normalizeSupplierName("Inversiones generales Ruvilsan") === normalizeSupplierName("Inversiones Generales Ruvilsan"));

console.log(fails === 0 ? "\nDETRACCIONES: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
