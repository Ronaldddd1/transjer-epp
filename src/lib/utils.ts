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

/**
 * Reduce el nombre de un proveedor a lo esencial para poder compararlo.
 *
 * En el control en Excel el mismo proveedor aparecía escrito de varias formas: distinta
 * capitalización, con y sin "sac", con y sin puntos. Esto quita acentos, signos, espacios y
 * la forma societaria, de modo que "Corporacion dyj Rusal sac" y "CORPORACION DYJ RUSAL
 * S.A.C." se reconozcan como el mismo.
 */
export function normalizeSupplierName(nombre: string): string {
  return nombre
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(s\.?a\.?c\.?|e\.?i\.?r\.?l\.?|s\.?a\.?|s\.?r\.?l\.?)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ---------- Devolución de EPP ----------

export const RETURN_CONDITION_LABEL = {
  REUTILIZABLE: "Reutilizable",
  DESCARTADO: "Descartado",
  NO_DEVUELTO: "No devuelto",
} as const;
export type ReturnConditionKey = keyof typeof RETURN_CONDITION_LABEL;

/** Qué significa cada condición, para no tener que explicarlo en cada pantalla. */
export const RETURN_CONDITION_HINT: Record<ReturnConditionKey, string> = {
  REUTILIZABLE: "Sirve para otro trabajador: vuelve al stock.",
  DESCARTADO: "Volvió gastado o roto: se da de baja y no vuelve al stock.",
  NO_DEVUELTO: "El trabajador no lo entregó: queda registrado como pérdida.",
};

/** Nombre de cada rol tal como debe salir en un Excel, sin depender de la pantalla. */
export const ROLE_EXPORT_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  JEFE_ALMACEN: "Jefe de almacén",
  USUARIO: "Usuario",
  FINANZAS: "Finanzas",
  DETRACCIONES: "Detracciones",
};

// ---------- Detracciones (SPOT) ----------
// El transporte de bienes por vía terrestre detrae el 4 % del importe total de la operación,
// IGV incluido, y solo cuando ese importe supera los S/ 400 (R.S. 073-2006/SUNAT).
// El depósito se hace sin decimales: si la fracción llega a 0.5 sube al sol siguiente y si no,
// se suprime (R.S. 183-2004/SUNAT, quinta disposición final). Esto es justo lo que el control
// en Excel venía haciendo a ojo, redondeando unas veces hacia arriba y otras hacia abajo.

export const DETRACTION_RATE = 4;
export const DETRACTION_THRESHOLD = 400;

export const DETRACTION_STATUS_LABEL = {
  NO_APLICA: "No aplica",
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  PAGADA: "Pagada",
  OBSERVADA: "Observada",
} as const;
export type DetractionStatusKey = keyof typeof DETRACTION_STATUS_LABEL;

export type Detraction = {
  /** Si la operación llega al umbral y por tanto se detrae. */
  applies: boolean;
  /** Monto a depositar, en soles enteros. */
  amount: number;
  /** Lo que queda por pagarle al proveedor después de descontar la detracción. */
  netPayable: number;
};

/**
 * Calcula la detracción de una factura a partir de su importe total con IGV.
 *
 * Solo se aplica a las operaciones en soles: el depósito en el Banco de la Nación se hace
 * en soles, y detraer una factura en dólares exigiría un tipo de cambio que el sistema no
 * tiene. Esas quedan como "no aplica" y se tratan a mano.
 */
export function detractionFor(
  total: string | number | null | undefined,
  rate: number = DETRACTION_RATE,
  currency: string = "PEN",
): Detraction {
  const n = typeof total === "number" ? total : Number(total);
  if (currency !== "PEN" || !Number.isFinite(n) || n <= DETRACTION_THRESHOLD) {
    return { applies: false, amount: 0, netPayable: Number.isFinite(n) ? n : 0 };
  }
  const amount = Math.round((n * rate) / 100);
  return { applies: true, amount, netPayable: Math.round((n - amount) * 100) / 100 };
}

// ---------- Obligaciones periódicas ----------
export const OBLIGATION_TYPE_LABEL = {
  PRESTAMO: "Préstamo",
  SERVICIO: "Servicio",
  ALQUILER: "Alquiler",
  IMPUESTO: "Impuesto",
  OTRO: "Otro",
} as const;
export type ObligationTypeKey = keyof typeof OBLIGATION_TYPE_LABEL;

/**
 * Con qué se agrupa una obligación cuando nadie escribió su concepto.
 *
 * Se le quita al nombre lo que identifica la unidad por el final —la placa, el número de
 * línea—, que es lo que hacía que cada cochera y cada seguro salieran en su propio bloque.
 * Es una deducción, no una regla: el campo de la ficha manda sobre esto.
 */
export function conceptoDeObligacion(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  const sinUnidad = limpio.replace(/(\s+[-–]?\s*\S*\d\S*)+$/, "").trim();
  return sinUnidad || limpio;
}

/** En plural, para encabezar la tabla de cada tipo. No basta con agregar una "s". */
export const OBLIGATION_TYPE_PLURAL: Record<ObligationTypeKey, string> = {
  PRESTAMO: "Préstamos",
  SERVICIO: "Servicios",
  ALQUILER: "Alquileres",
  IMPUESTO: "Impuestos",
  OTRO: "Otras obligaciones",
};

export const OBLIGATION_TYPE_HINT: Record<ObligationTypeKey, string> = {
  PRESTAMO: "Crédito bancario con cronograma de cuotas.",
  SERVICIO: "Celular, luz, agua, internet y similares.",
  ALQUILER: "Local, cochera o equipo alquilado.",
  IMPUESTO: "Pagos a SUNAT u otra entidad.",
  OTRO: "Cualquier pago que se repite cada mes.",
};

export const OBLIGATION_STATUS_LABEL = { ACTIVA: "Activa", CERRADA: "Cerrada", ANULADA: "Anulada" } as const;
export const INSTALLMENT_STATUS_LABEL = { PENDIENTE: "Pendiente", PAGADA: "Pagada", ANULADA: "Anulada" } as const;

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
// Cada factura se paga en su propia fecha límite, según la condición pactada:
//
//   CONTADO  el plazo corre desde que la factura llega por correo. Por acuerdo con los
//            proveedores es 1 día, así que una factura que llega el lunes se paga el martes.
//
//   CREDITO  deben cumplirse dos cosas: que el proveedor haya mandado el correo y que haya
//            entregado la guía de remisión en físico. El plazo corre desde la más tardía de
//            las dos fechas, porque hasta entonces no se cumplieron ambas condiciones.
//            Mientras no se anote la entrega de la guía, la factura no tiene fecha de pago.

const DAY = 86_400_000;

export const PAYMENT_TERM_LABEL = { CONTADO: "Contado", CREDITO: "Crédito" } as const;
export type PaymentTermKey = keyof typeof PAYMENT_TERM_LABEL;

/** Plazo habitual de cada condición, en días. Se puede cambiar factura por factura. */
export const DEFAULT_TERM_DAYS: Record<PaymentTermKey, number> = { CONTADO: 1, CREDITO: 7 };

/** Suma días a una fecha YYYY-MM-DD y devuelve otra fecha YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

export type PayDueInput = {
  paymentTerm: PaymentTermKey;
  termDays: number;
  /** Cuándo llegó la factura por correo. */
  receptionYmd: string;
  /** Cuándo entregó el proveedor la guía en físico, si ya ocurrió. */
  guideReceivedAt?: string | null;
};

/**
 * Fecha límite de pago de una factura.
 * Devuelve null cuando es a crédito y todavía no se anotó la entrega de la guía:
 * en ese caso el plazo no ha empezado a correr.
 */
export function computePayDueDate(i: PayDueInput): string | null {
  if (i.paymentTerm === "CONTADO") return addDays(i.receptionYmd, i.termDays);
  if (!i.guideReceivedAt) return null;
  // Ambas condiciones deben cumplirse: manda la fecha más tardía.
  const start = i.guideReceivedAt > i.receptionYmd ? i.guideReceivedAt : i.receptionYmd;
  return addDays(start, i.termDays);
}

export type DueState = "ESPERANDO_GUIA" | "VENCIDA" | "HOY" | "PRONTO" | "PROGRAMADA";

export type DueInfo = {
  state: DueState;
  /** Días que faltan; negativo si ya venció. Null mientras espera la guía. */
  days: number | null;
  label: string;
};

/** Cómo mostrar el vencimiento de una factura pendiente. */
export function dueInfo(payDueDate: string | null | undefined, today = todayLima()): DueInfo {
  if (!payDueDate) return { state: "ESPERANDO_GUIA", days: null, label: "Esperando la guía" };
  const days = Math.round((Date.parse(`${payDueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (days < 0) return { state: "VENCIDA", days, label: days === -1 ? "Venció ayer" : `Venció hace ${-days} días` };
  if (days === 0) return { state: "HOY", days, label: "Vence hoy" };
  if (days === 1) return { state: "PRONTO", days, label: "Vence mañana" };
  if (days <= 3) return { state: "PRONTO", days, label: `Vence en ${days} días` };
  return { state: "PROGRAMADA", days, label: `Vence en ${days} días` };
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
