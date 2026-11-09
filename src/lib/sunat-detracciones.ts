/**
 * El archivo de "Depósitos Masivos" de detracciones de SUNAT (canal internet / SOL).
 *
 * Formato tomado del instructivo de SUNAT para el pago masivo:
 * https://www.sunat.gob.pe/orientacion/Detracciones/InstructivoPagoMasivonuevaversionv3.pdf
 *
 * Nombre:   D + RUC del adquiriente (11) + número de lote (6), extensión .txt
 * Cabecera (68 caracteres):
 *   1     "*" (archivo del adquiriente)
 *   2-12  RUC del adquiriente
 *   13-47 razón social (35, rellena con espacios)
 *   48-53 número de lote AANNNN
 *   54-68 importe total del lote (15: 13 enteros y 2 decimales en cero, sin punto)
 * Detalle (107 caracteres, uno por depósito):
 *   1      tipo de documento del proveedor: "6" (RUC)
 *   2-12   RUC del proveedor
 *   13-47  nombre del proveedor: en blanco cuando el documento es RUC
 *   48-56  número de proforma: opcional, en ceros
 *   57-59  código del bien o servicio (027: servicio de transporte de carga)
 *   60-70  cuenta de detracciones del proveedor en el Banco de la Nación
 *   71-85  importe del depósito (15: 13 enteros y 2 decimales en cero, sin punto)
 *   86-87  tipo de operación (01: venta gravada con IGV)
 *   88-93  periodo tributario aaaamm
 *   94-95  tipo de comprobante (01 factura, 03 boleta)
 *   96-99  serie del comprobante (4)
 *   100-107 número del comprobante (8, los últimos 8 dígitos)
 *
 * Todo es puro y sin base de datos, para poder probarlo línea por línea.
 */

export const CODIGO_TRANSPORTE_DE_CARGA = "027";
export const OPERACION_GRAVADA = "01";
/** SUNAT no acepta archivos de más de 200 000 bytes. */
export const TAMANO_MAXIMO_ARCHIVO = 200_000;
export const LARGO_CABECERA = 68;
export const LARGO_DETALLE = 107;
/** Cuántas detracciones caben en un archivo, con el salto de línea de Windows. */
export const MAXIMO_POR_LOTE = Math.floor((TAMANO_MAXIMO_ARCHIVO - LARGO_CABECERA) / (LARGO_DETALLE + 2));

export type DepositoDetraccion = {
  /** Para señalar en los mensajes cuál es la que tiene el problema. */
  etiqueta: string;
  rucProveedor: string | null;
  cuentaProveedor: string | null;
  /** En soles. SUNAT pide el monto sin céntimos. */
  monto: number;
  /** Fecha de emisión aaaa-mm-dd: de ahí sale el periodo. */
  emision: string;
  tipoDocumento: string;
  serie: string;
  numero: string;
};

export type LoteDetracciones = {
  rucPagador: string;
  razonSocialPagador: string;
  lote: string;
  depositos: DepositoDetraccion[];
};

/** Mayúsculas y solo caracteres simples: el archivo se mide en bytes, y una tilde ocupa dos. */
export function textoSunat(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 &.,\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function campoTexto(valor: string, largo: number): string {
  return textoSunat(valor).slice(0, largo).padEnd(largo, " ");
}

/** 25 soles → "000000000002500". Los céntimos van siempre en cero. */
export function montoSunat(soles: number): string {
  if (!Number.isFinite(soles) || soles < 0) throw new Error("Monto inválido");
  if (!Number.isInteger(soles)) throw new Error("SUNAT pide el depósito en soles enteros");
  const texto = `${soles}00`;
  if (texto.length > 15) throw new Error("Monto demasiado grande");
  return texto.padStart(15, "0");
}

export const esRuc = (v: string | null | undefined): v is string => !!v && /^\d{11}$/.test(v);
export const esCuentaBN = (v: string | null | undefined): v is string => !!v && /^\d{11}$/.test(v);

/** La cuenta del Banco de la Nación se escribe a veces con guiones o espacios: 00-123-456789. */
export function limpiarCuenta(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s-]/g, "");
}

export function tipoComprobanteSunat(tipoDocumento: string): string | null {
  // El instructivo manda las notas de débito como tipo 01.
  if (tipoDocumento === "FACTURA" || tipoDocumento === "NOTA_DEBITO") return "01";
  if (tipoDocumento === "BOLETA") return "03";
  return null;
}

/** La serie va en 4 caracteres: "F001", "E001", o una física "0001". */
export function serieSunat(serie: string): string | null {
  const s = serie.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(s)) return null;
  // Las series físicas son numéricas y se completan con ceros a la izquierda.
  return /^\d+$/.test(s) ? s.padStart(4, "0") : s.length === 4 ? s : null;
}

/** El número va en 8 dígitos; si tiene más, los últimos 8. */
export function numeroSunat(numero: string): string | null {
  const n = numero.trim().replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(n)) return null;
  return n.slice(-8).padStart(8, "0");
}

export function periodoSunat(emision: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(emision);
  if (!m) return null;
  const periodo = `${m[1]}${m[2]}`;
  return periodo < "200409" ? null : periodo;
}

/** Lo que impide que una detracción vaya en el archivo, en palabras. Vacío si está bien. */
export function problemasDeDeposito(d: DepositoDetraccion): string[] {
  const p: string[] = [];
  if (!esRuc(d.rucProveedor)) p.push("el proveedor no tiene RUC");
  if (!esCuentaBN(d.cuentaProveedor)) p.push("falta la cuenta de detracciones del proveedor");
  if (!Number.isInteger(d.monto) || d.monto <= 0) p.push("el monto no es un número entero de soles");
  if (!tipoComprobanteSunat(d.tipoDocumento)) p.push("una nota de crédito no lleva detracción");
  if (!serieSunat(d.serie)) p.push(`la serie "${d.serie}" no tiene el formato de SUNAT`);
  if (!numeroSunat(d.numero)) p.push(`el número "${d.numero}" no es numérico`);
  if (!periodoSunat(d.emision)) p.push("la fecha de emisión no es válida");
  return p;
}

export function lineaDeDeposito(d: DepositoDetraccion): string {
  const problemas = problemasDeDeposito(d);
  if (problemas.length) throw new Error(`${d.etiqueta}: ${problemas.join(", ")}`);
  const linea = "6"
    + d.rucProveedor
    + "".padEnd(35, " ")
    + "000000000"
    + CODIGO_TRANSPORTE_DE_CARGA
    + d.cuentaProveedor
    + montoSunat(d.monto)
    + OPERACION_GRAVADA
    + periodoSunat(d.emision)
    + tipoComprobanteSunat(d.tipoDocumento)
    + serieSunat(d.serie)
    + numeroSunat(d.numero);
  if (linea.length !== LARGO_DETALLE) throw new Error(`${d.etiqueta}: la línea salió de ${linea.length} caracteres`);
  return linea;
}

export function nombreDeArchivo(rucPagador: string, lote: string): string {
  return `D${rucPagador}${lote}.txt`;
}

/** Arma el archivo completo. Lanza un error si algo no cumple el formato. */
export function armarArchivo(l: LoteDetracciones): { nombre: string; contenido: string; total: number } {
  if (!esRuc(l.rucPagador)) throw new Error("El RUC de la empresa debe tener 11 dígitos");
  if (!/^\d{6}$/.test(l.lote)) throw new Error("El número de lote es AANNNN: 6 dígitos");
  if (!textoSunat(l.razonSocialPagador)) throw new Error("Falta la razón social de la empresa");
  if (l.depositos.length === 0) throw new Error("El lote no tiene detracciones");
  if (l.depositos.length > MAXIMO_POR_LOTE) throw new Error(`Un archivo admite hasta ${MAXIMO_POR_LOTE} detracciones`);

  const total = l.depositos.reduce((s, d) => s + d.monto, 0);
  const cabecera = "*" + l.rucPagador + campoTexto(l.razonSocialPagador, 35) + l.lote + montoSunat(total);
  const lineas = [cabecera, ...l.depositos.map(lineaDeDeposito)];
  // Salto de línea de Windows: es lo que produce el Bloc de notas, que es con lo que SUNAT
  // enseña a armarlo a mano.
  const contenido = lineas.join("\r\n");
  if (contenido.length > TAMANO_MAXIMO_ARCHIVO) throw new Error("El archivo pasa los 200 000 bytes que admite SUNAT");
  return { nombre: nombreDeArchivo(l.rucPagador, l.lote), contenido, total };
}

/** El siguiente número de lote del año: 26 + correlativo, después del mayor ya usado. */
export function siguienteLote(hoy: string, usados: string[]): string {
  const aa = hoy.slice(2, 4);
  const delAnio = usados.filter((u) => u.startsWith(aa)).map((u) => Number(u.slice(2)));
  const siguiente = (delAnio.length ? Math.max(...delAnio) : 0) + 1;
  return `${aa}${String(Math.min(siguiente, 9999)).padStart(4, "0")}`;
}
