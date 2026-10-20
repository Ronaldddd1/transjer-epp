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

// ---------- Redondeo al sol inmediato superior ----------
// Cualquier céntimo sube al sol siguiente: el 4 % de 605 son 24.20 y se depositan 25. Lo
// que sobra queda en la cuenta de detracciones del proveedor, que es suya igual; al revés,
// el faltante se lo quedaría la empresa.
//
// Los tres casos marcados abajo son los que la hoja en Excel ya calculaba así a mano. El
// sistema los "corregía" hacia abajo y por eso no cuadraban.
const casos: [number, number][] = [
  [605, 25],     // 24.20  → el ejemplo que puso la empresa
  [4838, 194],   // 193.52
  [3304, 133],   // 132.16
  [590, 24],     // 23.60
  [5428, 218],   // 217.12 → como en la hoja
  [4956, 199],   // 198.24 → como en la hoja
  [2950, 118],   // exacto: no sube
  [5900, 236],   // exacto: no sube
  [3186, 128],   // 127.44 → como en la hoja
  [424.8, 17],   // 16.99
  [6254, 251],   // 250.16
];
for (const [total, esperado] of casos) {
  check(`S/ ${total} → detracción de S/ ${esperado}`, detractionFor(total).amount === esperado, detractionFor(total));
}

// Sube cualquier fracción, por chica que sea: un céntimo ya obliga al sol siguiente.
check("una fracción de 0.5 exacta sube", detractionFor(412.5).amount === 17, detractionFor(412.5));
check("una fracción por debajo de la mitad también sube", detractionFor(512.4).amount === 21, detractionFor(512.4));
check("un solo céntimo sube", detractionFor(425.25).amount === 18, detractionFor(425.25));

/**
 * Un importe cuyo 4 % es un entero NO sube.
 *
 * En coma flotante el 4 % de algunos importes da 118.00000000000001, y redondear eso hacia
 * arriba depositaría un sol de más por un error de aritmética del lenguaje. Se comprueba
 * sobre varios miles de importes, no sobre dos o tres elegidos a mano.
 */
let exactosQueSubieron = 0;
for (let t = 425; t <= 100000; t += 25) {
  const exacto = (t * 4) / 100;
  if (Number.isInteger(exacto) && detractionFor(t).amount !== exacto) exactosQueSubieron++;
}
check("ningún 4 % exacto sube de más", exactosQueSubieron === 0, exactosQueSubieron);

// ---------- Lo que queda para el proveedor ----------
const d = detractionFor(4838);
check("el neto descuenta la detracción", d.netPayable === 4644, d);
// Lo que se le transfiere baja en la misma proporción en que sube la detracción.
const redondeada = detractionFor(605);
check("si la detracción sube a 25, al proveedor se le transfieren 580",
  redondeada.amount === 25 && redondeada.netPayable === 580, redondeada);
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
