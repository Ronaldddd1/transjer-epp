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
