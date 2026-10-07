import "server-only";
import ExcelJS from "exceljs";

/**
 * Lectura del control de facturas que la encargada lleva en Excel.
 *
 * La hoja real no es una tabla limpia: tiene un título encima de la cabecera, hojas sueltas
 * con tablas dinámicas y notas, columnas que cambian de nombre con el tiempo y celdas donde
 * el volumen viene escrito "50m3". Por eso no se asume ninguna posición: se busca la hoja
 * que parezca el control, se busca su fila de cabecera y las columnas se reconocen por su
 * nombre, no por dónde están. Así la importación sobrevive a que alguien agregue o mueva
 * una columna.
 *
 * Este módulo solo lee y normaliza. No decide qué se guarda ni toca la base de datos.
 */

export type SheetInvoice = {
  /** Fila del Excel, tal como la ve la encargada, para poder señalarle dónde está el problema. */
  fila: number;
  proveedor: string;
  serie: string;
  numero: string;
  fechaEmision: string | null;
  fechaServicio: string | null;
  contacto: string | null;
  placa: string | null;
  cliente: string | null;
  origen: string | null;
  destino: string | null;
  m3: number | null;
  tn: number | null;
  base: number | null;
  igv: number | null;
  total: number | null;
  detraccionExcel: number | null;
  adelantos: number | null;
  /** Lo que dice la hoja, sin interpretar: "Pagado", "Anulado", "NC E001-29"… */
  estadoPago: string;
  estadoDetraccion: string;
  constancia: string | null;
  operacion: string | null;
};

export type SheetReadResult = {
  hoja: string;
  filaCabecera: number;
  filas: SheetInvoice[];
  /** Filas que no se pudieron leer, con el motivo, para mostrárselas a quien importa. */
  avisos: { fila: number; detalle: string }[];
  /** Columnas de la hoja que el sistema no usa, por si falta mapear alguna. */
  columnasIgnoradas: string[];
};

/** Texto comparable: sin tildes, sin signos y en minúsculas. */
function llave(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Nombres con los que cada dato puede aparecer en la hoja. El primero es el habitual; los
 * demás son variantes que ya se han visto o que son razonables.
 */
const COLUMNAS: Record<keyof Omit<SheetInvoice, "fila" | "serie" | "numero">, string[]> & { factura: string[] } = {
  proveedor: ["proveedor", "razon social", "transportista"],
  factura: ["factura", "n factura", "nro factura", "numero de factura", "comprobante", "documento"],
  fechaEmision: ["fecha fact", "fecha factura", "fecha de emision", "fecha emision", "emision"],
  fechaServicio: ["fecha de servicio", "fecha servicio", "servicio"],
  contacto: ["contacto"],
  placa: ["placa"],
  cliente: ["cliente"],
  m3: ["m3", "volumen"],
  tn: ["tn", "peso", "toneladas"],
  origen: ["inicio", "origen", "partida"],
  destino: ["destino", "llegada"],
  base: ["bi flete", "base imponible", "base", "subtotal", "valor de venta"],
  igv: ["igv", "impuesto"],
  total: ["flete total bruto", "flete total", "importe total", "total bruto", "total"],
  detraccionExcel: ["0 04", "4", "detraccion", "monto detraccion", "spot"],
  adelantos: ["adelantos", "adelanto", "a cuenta"],
  estadoPago: ["estado de pago", "estado pago", "estado"],
  estadoDetraccion: ["estado de detraccion", "estado detraccion"],
  constancia: ["constancia", "n constancia", "nro constancia"],
  operacion: ["ope", "n ope", "operacion", "nro operacion"],
};

/** Encuentra la columna de un dato dentro de una fila de cabecera. */
function ubicar(cabecera: string[], alias: string[]): number {
  // Primero coincidencia exacta; solo si no la hay se acepta que el nombre contenga el alias.
  for (const a of alias) {
    const i = cabecera.indexOf(a);
    if (i >= 0) return i;
  }
  for (const a of alias) {
    const i = cabecera.findIndex((c) => c && (c === a || c.startsWith(`${a} `) || c.endsWith(` ${a}`)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * El valor de una celda, sea lo que sea que traiga.
 *
 * La mitad de las columnas de importe son fórmulas (el IGV es `L3*18%`, el total es
 * `L3+M3`), y para esas ExcelJS no devuelve un número sino un objeto con la fórmula y su
 * resultado. Leerlo sin desenvolver daba cero en todos los totales.
 */
function valorDeCelda(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return v;
  if (v instanceof Date) return v;
  if ("error" in v) return null;                               // #REF!, #DIV/0!…
  if ("result" in v) return valorDeCelda((v as { result: unknown }).result);
  if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if ("text" in v) return (v as { text: unknown }).text;       // hipervínculos
  return null;
}

const texto = (v: unknown): string | null => {
  const crudo = valorDeCelda(v);
  if (crudo === null || crudo === undefined) return null;
  const limpio = crudo instanceof Date ? crudo.toISOString() : String(crudo).trim();
  return limpio ? limpio : null;
};

/** Un número aunque venga escrito "50m3", "S/ 4,838.00" o "7 tn". */
function numero(v: unknown): number | null {
  const crudo = valorDeCelda(v);
  if (typeof crudo === "number") return Number.isFinite(crudo) ? crudo : null;
  const s = texto(crudo);
  if (!s) return null;
  // Se toma el primer número del texto, no todos los dígitos sueltos: en "50m3" la unidad
  // lleva un 3 dentro, y juntarlo daba 503 metros cúbicos.
  const m = s.replace(/\s/g, "").match(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Fecha en formato YYYY-MM-DD.
 *
 * Excel entrega las fechas como instantes en UTC; se leen con los getters UTC para que una
 * factura del 11 de enero no retroceda al 10 por la diferencia horaria de Lima.
 */
function fecha(entrada: unknown): string | null {
  const v = valorDeCelda(entrada);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  const s = texto(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // dd/mm/aaaa, que es como se escribe a mano en la hoja.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const [, d, mes, a] = m;
    const anio = a.length === 2 ? `20${a}` : a;
    const dia = Number(d), mm = Number(mes);
    if (dia >= 1 && dia <= 31 && mm >= 1 && mm <= 12) {
      return `${anio}-${String(mm).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    }
  }
  return null;
}

/** "E001-356" → serie E001, número 356. También acepta "E001 - 00356" y "E001356". */
export function partirComprobante(v: string): { serie: string; numero: string } | null {
  const s = v.trim().toUpperCase().replace(/\s+/g, "");
  const conGuion = s.match(/^([A-Z0-9]{1,8})-0*(\d{1,12})$/);
  if (conGuion) return { serie: conGuion[1], numero: conGuion[2] };
  const pegado = s.match(/^([A-Z]\d{2,3})0*(\d{1,12})$/);
  if (pegado) return { serie: pegado[1], numero: pegado[2] };
  return null;
}

/** La hoja que más se parece al control: la que tiene una cabecera con proveedor y factura. */
function elegirHoja(libro: ExcelJS.Workbook) {
  let mejor: { hoja: ExcelJS.Worksheet; fila: number; cabecera: string[]; aciertos: number } | null = null;

  for (const hoja of libro.worksheets) {
    const tope = Math.min(hoja.rowCount, 12);
    for (let n = 1; n <= tope; n++) {
      const cabecera = (hoja.getRow(n).values as unknown[]).slice(1).map(llave);
      const aciertos = Object.values(COLUMNAS).filter((alias) => ubicar(cabecera, alias) >= 0).length;
      if (aciertos >= 5 && (!mejor || aciertos > mejor.aciertos)) {
        mejor = { hoja, fila: n, cabecera, aciertos };
      }
    }
  }
  return mejor;
}

export async function readInvoiceSheet(data: Buffer): Promise<SheetReadResult> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(data as unknown as ArrayBuffer);

  const elegida = elegirHoja(libro);
  if (!elegida) {
    throw new Error(
      "No se encontró una hoja con el control de facturas. Debe tener una fila de cabecera con al menos las columnas Proveedor, Factura, Fecha y los importes.",
    );
  }
  const { hoja, fila: filaCabecera, cabecera } = elegida;

  const col = Object.fromEntries(
    Object.entries(COLUMNAS).map(([clave, alias]) => [clave, ubicar(cabecera, alias)]),
  ) as Record<keyof typeof COLUMNAS, number>;

  for (const obligatoria of ["proveedor", "factura", "total"] as const) {
    if (col[obligatoria] < 0) {
      throw new Error(`La hoja "${hoja.name}" no tiene una columna de ${obligatoria === "factura" ? "número de factura" : obligatoria}.`);
    }
  }

  const usadas = new Set(Object.values(col).filter((i) => i >= 0));
  const columnasIgnoradas = cabecera
    .map((c, i) => (c && !usadas.has(i) ? String((hoja.getRow(filaCabecera).values as unknown[])[i + 1] ?? "").trim() : ""))
    .filter(Boolean);

  const dato = (fila: ExcelJS.Row, clave: keyof typeof COLUMNAS) =>
    col[clave] >= 0 ? (fila.values as unknown[])[col[clave] + 1] : null;

  const filas: SheetInvoice[] = [];
  const avisos: { fila: number; detalle: string }[] = [];

  for (let n = filaCabecera + 1; n <= hoja.rowCount; n++) {
    const fila = hoja.getRow(n);
    const proveedor = texto(dato(fila, "proveedor"));
    const comprobante = texto(dato(fila, "factura"));

    // Fila vacía o de totales: se salta sin ruido. La hoja trae varias al final.
    if (!proveedor && !comprobante) continue;
    if (!proveedor) { avisos.push({ fila: n, detalle: `${comprobante}: no dice de qué proveedor es.` }); continue; }
    if (!comprobante) { avisos.push({ fila: n, detalle: `${proveedor}: no tiene número de factura.` }); continue; }

    const partes = partirComprobante(comprobante);
    if (!partes) {
      avisos.push({ fila: n, detalle: `${proveedor}: "${comprobante}" no se entiende como serie y número (se espera algo como E001-356).` });
      continue;
    }

    filas.push({
      fila: n,
      proveedor,
      serie: partes.serie,
      numero: partes.numero,
      fechaEmision: fecha(dato(fila, "fechaEmision")),
      fechaServicio: fecha(dato(fila, "fechaServicio")),
      contacto: texto(dato(fila, "contacto")),
      placa: texto(dato(fila, "placa")),
      cliente: texto(dato(fila, "cliente")),
      origen: texto(dato(fila, "origen")),
      destino: texto(dato(fila, "destino")),
      m3: numero(dato(fila, "m3")),
      tn: numero(dato(fila, "tn")),
      base: numero(dato(fila, "base")),
      igv: numero(dato(fila, "igv")),
      total: numero(dato(fila, "total")),
      detraccionExcel: numero(dato(fila, "detraccionExcel")),
      adelantos: numero(dato(fila, "adelantos")),
      estadoPago: texto(dato(fila, "estadoPago")) ?? "",
      estadoDetraccion: texto(dato(fila, "estadoDetraccion")) ?? "",
      constancia: texto(dato(fila, "constancia")),
      operacion: texto(dato(fila, "operacion")),
    });
  }

  return { hoja: hoja.name, filaCabecera, filas, avisos, columnasIgnoradas };
}

/** Lo que dice la hoja sobre el pago, llevado a los estados del sistema. */
export function estadoDePago(v: string): "PENDIENTE" | "PAGADA" | "ANULADA" {
  const k = llave(v);
  if (k.startsWith("anul")) return "ANULADA";
  if (k.startsWith("pagad") || k.startsWith("cancel")) return "PAGADA";
  return "PENDIENTE";
}

/**
 * Lo que dice la hoja sobre la detracción.
 *
 * Devuelve también la anotación original cuando no es un estado reconocible: en la hoja real
 * hay celdas con "NC E001-29", que no es un estado sino la nota de crédito que la reemplazó.
 * Eso no se puede traducir, así que la factura queda observada con la nota a la vista.
 */
export function estadoDeDetraccion(v: string): { estado: "PENDIENTE" | "PAGADA" | "NO_APLICA" | "OBSERVADA"; nota: string | null } {
  const k = llave(v);
  if (!k) return { estado: "PENDIENTE", nota: null };
  if (k.startsWith("pagad") || k.startsWith("deposit")) return { estado: "PAGADA", nota: null };
  if (k.startsWith("pendiente")) return { estado: "PENDIENTE", nota: null };
  if (k === "n a" || k === "na" || k.startsWith("no aplica")) return { estado: "NO_APLICA", nota: null };
  return { estado: "OBSERVADA", nota: v.trim() };
}
