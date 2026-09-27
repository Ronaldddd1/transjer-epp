import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const TIMEZONE = "America/Lima";

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  // Las columnas DATE llegan como "YYYY-MM-DD": se muestran sin conversión de zona horaria.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat("es-PE", { timeZone: TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: TIMEZONE, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function formatTime(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-PE", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function formatNumber(n: number) {
  return new Intl.NumberFormat("es-PE").format(n);
}

/** Fecha de hoy en Lima como YYYY-MM-DD */
export function todayLima() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

/** Lima es UTC-5 todo el año (sin horario de verano). */
export function limaDayStart(ymd: string) {
  return new Date(`${ymd}T00:00:00-05:00`);
}
export function limaDayEnd(ymd: string) {
  return new Date(`${ymd}T23:59:59.999-05:00`);
}
export function limaMonthStartYmd() {
  return `${todayLima().slice(0, 7)}-01`;
}

export type StockStatus = "DISPONIBLE" | "STOCK_BAJO" | "AGOTADO";

export function stockStatus(stock: number, minimum: number): StockStatus {
  if (stock <= 0) return "AGOTADO";
  if (stock <= minimum) return "STOCK_BAJO";
  return "DISPONIBLE";
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  DISPONIBLE: "Disponible",
  STOCK_BAJO: "Stock bajo",
  AGOTADO: "Agotado",
};

export const MOVEMENT_LABEL = { ENTRADA: "Entrada", SALIDA: "Salida", AJUSTE: "Ajuste" } as const;

// ---------- Facturas de proveedores ----------
export const INVOICE_STATUS_LABEL = {
  PENDIENTE: "Pendiente de pago",
  PAGADA: "Pagada",
  OBSERVADA: "Observada",
  ANULADA: "Anulada",
} as const;
export type InvoiceStatusKey = keyof typeof INVOICE_STATUS_LABEL;

export const INVOICE_DOC_TYPE_LABEL = {
  FACTURA: "Factura",
  BOLETA: "Boleta",
  NOTA_CREDITO: "Nota de crédito",
  NOTA_DEBITO: "Nota de débito",
} as const;

export const INVOICE_SOURCE_LABEL = { MANUAL: "Registro manual", CORREO: "Correo" } as const;

export const ATTACHMENT_KIND_LABEL = {
  FACTURA_PDF: "Factura (PDF)",
  FACTURA_XML: "Factura (XML)",
  GRT: "Guía de remisión",
  OTRO: "Otro documento",
} as const;

export const EMAIL_STATUS_LABEL = {
  PROCESADO: "Procesado",
  REVISAR: "Por revisar",
  DESCARTADO: "Descartado",
  ERROR: "Con error",
} as const;

export const CURRENCY_SYMBOL = { PEN: "S/", USD: "US$" } as const;

/** Importe con su símbolo: S/ 1,180.50 */
export function formatMoney(amount: string | number | null | undefined, currency: string = "PEN") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "—";
  const symbol = CURRENCY_SYMBOL[currency as keyof typeof CURRENCY_SYMBOL] ?? currency;
  return `${symbol} ${new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

/** Número completo del comprobante: F001-2589 */
export function invoiceNumber(series: string, number: string) {
  return `${series}-${number}`;
}

/** Días que faltan (positivo) o que han pasado (negativo) hasta una fecha, en horario de Lima. */
export function daysUntil(ymd: string | null | undefined) {
  if (!ymd) return null;
  const today = todayLima();
  const diff = (Date.parse(`${ymd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return Math.round(diff);
}

// ---------- Calendario de pago: los viernes ----------
// Transjer paga a proveedores los viernes. A cada factura le toca el viernes de la semana en
// que llegó; si ese viernes pasa sin pagarse, el pago se corre al viernes siguiente.

const DAY = 86_400_000;

/** Primer viernes en esa fecha o después. Devuelve YYYY-MM-DD. */
export function nextFriday(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  // getUTCDay: domingo 0 … viernes 5
  const shift = (5 - d.getUTCDay() + 7) % 7;
  return new Date(d.getTime() + shift * DAY).toISOString().slice(0, 10);
}

/** Cuántos viernes hay entre dos fechas que caen en viernes. */
export function fridaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / (7 * DAY));
}

export type PaymentSchedule = {
  /** El viernes que le correspondía según su llegada. */
  scheduled: string;
  /** El viernes en que se pagará realmente (si el programado ya pasó, se corre). */
  effective: string;
  /** Semanas que se ha corrido el pago. 0 si va en fecha. */
  weeksDelayed: number;
  /** Se paga en la tanda de este viernes. */
  isThisFriday: boolean;
};

/** Calcula el viernes de pago de una factura pendiente, a partir de su fecha de llegada. */
export function paymentSchedule(receivedYmd: string, today = todayLima()): PaymentSchedule {
  const scheduled = nextFriday(receivedYmd);
  const thisFriday = nextFriday(today);
  const effective = scheduled < thisFriday ? thisFriday : scheduled;
  return {
    scheduled,
    effective,
    weeksDelayed: fridaysBetween(scheduled, effective),
    isThisFriday: effective === thisFriday,
  };
}

/** Fecha de llegada de una factura: la registrada, o la de creación si no se anotó. */
export function receptionDate(invoice: { receivedAt?: Date | string | null; createdAt: Date | string }): string {
  const raw = invoice.receivedAt ?? invoice.createdAt;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(raw));
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;
export type SearchParams = Promise<SearchParamsRecord>;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function pageParams(sp: SearchParamsRecord, pageSize = 15) {
  const page = Math.max(1, Number(first(sp.page)) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function isYmd(v: string | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
