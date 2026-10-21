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

/**
 * Qué clase de factura es, decidida por quien la aprueba.
 *
 * Separa las dos cosas que la empresa compra, y que no se pagan igual: un flete se paga
 * a 15 días desde que llega la factura, y un servicio corriente al contado.
 */
export const INVOICE_SERVICE_TYPE_LABEL = {
  TRANSPORTE: "Factura de transporte",
  SERVICIO: "Factura de servicio",
} as const;
export type InvoiceServiceTypeKey = keyof typeof INVOICE_SERVICE_TYPE_LABEL;
export const INVOICE_SERVICE_TYPES = Object.keys(INVOICE_SERVICE_TYPE_LABEL) as InvoiceServiceTypeKey[];

/** Días de plazo según lo que se compró. El transporte se paga a 15 días del correo. */
export const TERM_DAYS_BY_SERVICE_TYPE: Record<InvoiceServiceTypeKey, number> = {
  TRANSPORTE: 15,
  SERVICIO: 1,
};

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

/**
 * En qué punto está un correo del buzón.
 *
 *   POR_APROBAR  se leyó el comprobante y espera que una persona lo acepte o lo rechace
 *   PROCESADO    aceptado: la factura quedó registrada
 *   RECHAZADO    devuelto al proveedor, con el motivo y el correo que se le envió
 *   REVISAR      no se pudo leer el comprobante (sin XML, dañado); se resuelve a mano
 *   DESCARTADO   no era una factura por pagar, o ya estaba registrada
 *   ERROR        falló la lectura del correo; se puede reintentar
 */
export const EMAIL_STATUS_LABEL = {
  POR_APROBAR: "Por aprobar",
  PROCESADO: "Aceptado",
  RECHAZADO: "Rechazado",
  REVISAR: "Por revisar",
  DESCARTADO: "Descartado",
  ERROR: "Con error",
} as const;

export const INVOICE_EMAIL_STATUSES = Object.keys(EMAIL_STATUS_LABEL) as InvoiceEmailStatusKey[];
export type InvoiceEmailStatusKey = keyof typeof EMAIL_STATUS_LABEL;

/** Motivos por los que se devuelve un comprobante al proveedor. */
export const REJECT_REASON_LABEL = {
  DATOS_ERRADOS: "Datos equivocados en el comprobante",
  NO_CORRESPONDE: "El servicio no corresponde o no se recibió",
  IMPORTE: "El importe no coincide con lo acordado",
  FALTA_GRT: "Falta la guía de remisión",
  OTRA_EMPRESA: "Está emitida a otra empresa",
  DUPLICADO: "Ya nos habían enviado este comprobante",
  OTRO: "Otro motivo",
} as const;

export type RejectReasonKey = keyof typeof REJECT_REASON_LABEL;

/**
 * Los motivos tras los cuales el proveedor tendrá que emitir una nota de crédito.
 *
 * Son aquellos en que la factura SÍ era para nosotros y está mal: el comprobante existe
 * ante SUNAT y la única forma de dejarlo sin efecto es la NC. Los otros dos —emitida a
 * otra empresa, o duplicada— no generan ninguna factura nuestra, así que no hay nada que
 * registrar ni nada que reclamar.
 */
export const PIDEN_NOTA_DE_CREDITO = new Set<string>([
  "DATOS_ERRADOS", "IMPORTE", "FALTA_GRT",
]);
export const REJECT_REASONS = Object.keys(REJECT_REASON_LABEL) as RejectReasonKey[];

/**
 * El correo que se le manda al proveedor cuando se le devuelve un comprobante.
 *
 * Se arma aquí, y no en el servidor, para que la persona vea exactamente el texto que va
 * a salir y pueda corregirlo antes de enviarlo. Un rechazo mal redactado llega igual de
 * lejos que uno bien redactado, así que conviene leerlo antes.
 */
export function rejectionEmailBody(datos: {
  comprobante: string | null;
  proveedor: string | null;
  motivo: RejectReasonKey | string;
  comentario: string;
  empresa?: string;
  firma?: string;
}): string {
  const motivo = REJECT_REASON_LABEL[datos.motivo as RejectReasonKey] ?? "Otro motivo";
  const empresa = datos.empresa?.trim() || "Transjer Operador Logístico S.A.C.";
  const saludo = datos.proveedor ? `Estimados señores de ${datos.proveedor}:` : "Estimados señores:";
  const cual = datos.comprobante ? `el comprobante ${datos.comprobante}` : "el comprobante que nos enviaron";
  const comentario = datos.comentario.trim();

  // Las líneas en blanco son parte del texto, así que lo que se descarta son las partes
  // que no aplican (el comentario vacío), no los espacios entre párrafos.
  const lineas: (string | null)[] = [
    saludo,
    "",
    `Les escribimos para informarles que no podemos aceptar ${cual}.`,
    "",
    `Motivo: ${motivo}.`,
    comentario ? "" : null,
    comentario || null,
    "",
    "Les agradeceremos corregirlo y volver a enviarlo a este mismo correo. Mientras tanto, el comprobante no queda registrado para pago.",
    "",
    "Quedamos atentos.",
    "",
    datos.firma?.trim() || empresa,
  ];
  return lineas.filter((l) => l !== null).join("\n");
}

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
  MANTENIMIENTO: "Mantenimiento",
  DOCUMENTACION: "Documentación",
  OPERACION: "Operación",
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
  /**
   * Se redondea SIEMPRE hacia arriba, nunca al más cercano.
   *
   * El 4 % de S/ 605 son 24.20, y eso se deposita como 25. Redondear al más cercano daría
   * 24 y dejaría 20 céntimos sin detraer: la diferencia va a parar al pago directo en vez
   * de a la cuenta de detracciones del proveedor, que es suya igual. Hacia arriba, el
   * faltante nunca queda del lado de la empresa.
   */
  // Se corta en céntimos antes de subir. En coma flotante, el 4 % de ciertos importes da
  // 118.00000000000001, y redondear eso hacia arriba daría 119: un sol de más depositado
  // por un error de la aritmética del lenguaje, no de la norma.
  const exacto = Number(((n * rate) / 100).toFixed(2));
  const amount = Math.ceil(exacto);
  return { applies: true, amount, netPayable: Math.round((n - amount) * 100) / 100 };
}

// ---------- Obligaciones periódicas ----------
/**
 * Los tipos de obligación, en el orden en que se muestran.
 *
 * Cochera, seguro y línea tienen tipo propio en vez de caer todos en "Servicio": son los
 * tres gastos que la empresa repite por cada unidad de la flota, y mezclados con la luz y
 * el internet no se podía leer cuánto se va en cada cosa.
 */
export const OBLIGATION_TYPE_LABEL = {
  PRESTAMO: "Préstamo",
  ALQUILER: "Alquiler",
  COCHERA: "Cochera",
  SEGURO: "Seguro",
  LINEA: "Línea móvil",
  SERVICIO: "Servicio",
  IMPUESTO: "Impuesto",
  OTRO: "Otro",
} as const;
export type ObligationTypeKey = keyof typeof OBLIGATION_TYPE_LABEL;

/**
 * La lista de tipos, en un solo lugar. De aquí salen la restricción de la base, el
 * validador del formulario y el orden de las tablas: agregar un tipo es agregarlo arriba
 * y correr una migración que amplíe la restricción.
 */
export const OBLIGATION_TYPES = Object.keys(OBLIGATION_TYPE_LABEL) as [ObligationTypeKey, ...ObligationTypeKey[]];

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
  ALQUILER: "Alquileres",
  COCHERA: "Cocheras",
  SEGURO: "Seguros",
  LINEA: "Líneas móviles",
  SERVICIO: "Servicios",
  IMPUESTO: "Impuestos",
  OTRO: "Otras obligaciones",
};

export const OBLIGATION_TYPE_HINT: Record<ObligationTypeKey, string> = {
  PRESTAMO: "Crédito bancario con cronograma de cuotas.",
  ALQUILER: "Local, oficina, almacén o equipo alquilado.",
  COCHERA: "Estacionamiento de las unidades, una por placa.",
  SEGURO: "SOAT y pólizas de las unidades o de toda la flota.",
  LINEA: "Celulares y planes de telefonía.",
  SERVICIO: "Luz, agua, internet y similares.",
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

/**
 * Lo que se le transfiere al proveedor: el total menos la detracción.
 *
 * La detracción no se le paga a él, va al Banco de la Nación, así que el importe del
 * comprobante nunca es el que sale de caja hacia el proveedor. Tenerlo calculado evita
 * la resta a mano en cada pago, que es donde se escapaban los errores.
 */
export function netoAPagar(total: string | number | null | undefined, detraccion: string | number | null | undefined): string {
  const t = Number(total ?? 0);
  const d = Number(detraccion ?? 0);
  if (!Number.isFinite(t)) return "0.00";
  const neto = t - (Number.isFinite(d) ? d : 0);
  return (neto > 0 ? neto : 0).toFixed(2);
}

/**
 * Lo que se transfiere el día del pago: el neto menos lo ya adelantado.
 *
 * Un adelanto es plata que el proveedor ya recibió, así que pagarle el neto completo
 * sería pagarle dos veces la misma parte. Antes esa resta se hacía a mano factura por
 * factura.
 */
export function saldoAPagar(
  total: string | number | null | undefined,
  detraccion: string | number | null | undefined,
  adelantos: string | number | null | undefined,
): string {
  const neto = Number(netoAPagar(total, detraccion));
  const a = Number(adelantos ?? 0);
  const saldo = neto - (Number.isFinite(a) ? a : 0);
  return (saldo > 0 ? saldo : 0).toFixed(2);
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

// ---------- Meses, para la cuadrícula del calendario ----------

/** "2026-10" → "2026-10-01" */
export const monthStart = (mes: string) => `${mes}-01`;

/** "2026-10" → "2026-10-31". Sale de restarle un día al 1 del mes siguiente. */
export function monthEnd(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const siguiente = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return addDays(siguiente, -1);
}

/** "2026-10" más n meses: "2026-12", "2026-09". */
export function addMonths(mes: string, n: number): string {
  const [y, m] = mes.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];

/** "2026-10" → "Octubre de 2026", como se encabeza un calendario. */
export function monthLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const nombre = MESES[m - 1] ?? "";
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de ${y}`;
}

/** Qué día de la semana cae esa fecha: 0 domingo … 6 sábado. */
export const weekdayOf = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Encabezados de la cuadrícula, empezando en domingo como los calendarios de pared. */
export const WEEKDAYS = ["Dom.", "Lun.", "Mar.", "Mié.", "Jue.", "Vie.", "Sáb."] as const;

// ---------- Documentos de trabajadores y vehículos ----------

/**
 * Los tipos de documento, separados por a quién pertenecen.
 *
 * Son los que la empresa maneja hoy. "Otro" existe para que nunca haya que esperar a una
 * actualización del sistema para poder guardar un papel que no estaba en la lista.
 */
export const VEHICLE_DOCUMENT_KINDS = {
  SOAT: "SOAT",
  REVISION_TECNICA: "Revisión técnica",
  TARJETA_PROPIEDAD: "Tarjeta de propiedad",
  TARJETA_CIRCULACION: "Tarjeta de circulación",
  POLIZA: "Póliza de seguro",
  MTC: "Habilitación MTC",
  OTRO_VEHICULO: "Otro documento del vehículo",
} as const;

export const EMPLOYEE_DOCUMENT_KINDS = {
  DNI: "DNI",
  LICENCIA: "Licencia de conducir",
  EXAMEN_MEDICO: "Examen médico ocupacional",
  CONTRATO: "Contrato",
  CERTIFICADO: "Certificado o curso",
  OTRO_TRABAJADOR: "Otro documento del trabajador",
} as const;

export const DOCUMENT_KIND_LABEL: Record<string, string> = {
  ...VEHICLE_DOCUMENT_KINDS,
  ...EMPLOYEE_DOCUMENT_KINDS,
  OTRO: "Otro",
};

/**
 * Cuáles conviene que lleven fecha de vencimiento.
 *
 * No es una obligación: el sistema no rechaza un SOAT sin fecha, porque a veces no se
 * tiene a mano y es peor no guardar el archivo. Sirve para avisar en el formulario de que
 * sin esa fecha nadie va a enterarse cuando caduque.
 */
export const DOCUMENT_KINDS_THAT_EXPIRE = new Set([
  "SOAT", "REVISION_TECNICA", "POLIZA", "MTC", "LICENCIA", "EXAMEN_MEDICO", "CONTRATO",
]);

export type DocumentStatus = "VIGENTE" | "POR_VENCER" | "VENCIDO" | "SIN_FECHA";

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  VIGENTE: "Vigente",
  POR_VENCER: "Por vencer",
  VENCIDO: "Vencido",
  SIN_FECHA: "Sin vencimiento",
};

/** Desde cuántos días antes se considera que un documento está por vencer. */
export const DOCUMENT_WARNING_DAYS = 30;

/**
 * Años que una unidad circula sin necesitar revisión técnica.
 *
 * La inspección recién se exige pasados tres años del año del vehículo: a un camión del
 * 2024 le toca desde el 2027. Reclamársela antes es una falsa alarma, y una falsa alarma
 * repetida en la pantalla es lo que hace que se dejen de mirar las de verdad.
 */
export const REVISION_TECNICA_ANIOS_GRACIA = 3;

// ---------- Mantenimiento de la flota ----------

/**
 * Lo que se le hace a una unidad, en el orden en que importa.
 *
 * El aceite va primero porque es el que se mide en kilómetros y el que de verdad para un
 * camión si se pasa. Lo demás se controla por tiempo.
 */
export const MAINTENANCE_KIND_LABEL = {
  ACEITE: "Cambio de aceite",
  FILTROS: "Cambio de filtros",
  FRENOS: "Revisión de frenos",
  LLANTAS: "Llantas",
  LAVADO: "Lavado",
  ENGRASE: "Engrase",
  OTRO: "Otro mantenimiento",
} as const;
export type MaintenanceKind = keyof typeof MAINTENANCE_KIND_LABEL;
export const MAINTENANCE_KINDS = Object.keys(MAINTENANCE_KIND_LABEL) as MaintenanceKind[];

/**
 * Cada cuánto toca cada cosa, mientras nadie diga otra cosa para una unidad concreta.
 *
 * Son los intervalos corrientes de un camión de carga. No son ley: cada unidad puede tener
 * el suyo, y por eso existe la tabla de planes. Estos son los que evitan que haya que
 * configurar dieciocho unidades a mano antes de que el módulo sirva de algo.
 */
export const MAINTENANCE_DEFAULTS: Record<MaintenanceKind, { everyKm: number | null; everyDays: number | null }> = {
  ACEITE: { everyKm: 10000, everyDays: 180 },
  FILTROS: { everyKm: 20000, everyDays: 365 },
  FRENOS: { everyKm: 20000, everyDays: 180 },
  LLANTAS: { everyKm: 40000, everyDays: null },
  LAVADO: { everyKm: null, everyDays: 15 },
  ENGRASE: { everyKm: 10000, everyDays: 90 },
  OTRO: { everyKm: null, everyDays: 365 },
};

/** Desde cuántos días (o kilómetros) antes se avisa de un mantenimiento. */
export const MAINTENANCE_WARNING_DAYS = 15;
export const MAINTENANCE_WARNING_KM = 1000;

export type MaintenanceStatus = "VENCIDO" | "POR_VENCER" | "AL_DIA" | "SIN_REGISTRO";

export const MAINTENANCE_STATUS_LABEL: Record<MaintenanceStatus, string> = {
  VENCIDO: "Vencido",
  POR_VENCER: "Toca pronto",
  AL_DIA: "Al día",
  SIN_REGISTRO: "Nunca se registró",
};

/**
 * Cuándo toca el próximo mantenimiento y en qué situación está.
 *
 * Se calcula por los dos caminos a la vez —kilómetros y tiempo— y manda el que llegue
 * antes: un camión parado tres meses necesita su cambio de aceite aunque no haya rodado
 * los 10.000 km, y uno que hace Lima-Arequipa todas las semanas los hace antes de los seis
 * meses. Quedarse con uno solo deja fuera la mitad de los casos.
 */
export function estadoMantenimiento(entrada: {
  /** Última vez que se hizo: fecha y kilometraje de ese día. */
  ultimaFecha: string | null;
  ultimoKm: number | null;
  /** La regla de esta unidad para este mantenimiento. */
  everyKm: number | null;
  everyDays: number | null;
  /** Lectura actual del odómetro, si se tiene. */
  kmActual: number | null;
  hoy?: string;
}): {
  estado: MaintenanceStatus;
  proximaFecha: string | null;
  proximoKm: number | null;
  /** Días que faltan (negativo si ya pasó). Null si este mantenimiento no va por tiempo. */
  diasRestantes: number | null;
  /** Kilómetros que faltan (negativo si ya se pasó). Null si no va por kilometraje. */
  kmRestantes: number | null;
} {
  const hoy = entrada.hoy ?? todayLima();

  if (!entrada.ultimaFecha) {
    return { estado: "SIN_REGISTRO", proximaFecha: null, proximoKm: null, diasRestantes: null, kmRestantes: null };
  }

  const proximaFecha = entrada.everyDays ? addDays(entrada.ultimaFecha, entrada.everyDays) : null;
  const proximoKm = entrada.everyKm !== null && entrada.ultimoKm !== null
    ? entrada.ultimoKm + entrada.everyKm
    : null;

  const diasRestantes = proximaFecha ? daysToExpiry(proximaFecha, hoy) : null;
  const kmRestantes = proximoKm !== null && entrada.kmActual !== null ? proximoKm - entrada.kmActual : null;

  const vencido = (diasRestantes !== null && diasRestantes < 0) || (kmRestantes !== null && kmRestantes < 0);
  if (vencido) return { estado: "VENCIDO", proximaFecha, proximoKm, diasRestantes, kmRestantes };

  const cerca = (diasRestantes !== null && diasRestantes <= MAINTENANCE_WARNING_DAYS)
    || (kmRestantes !== null && kmRestantes <= MAINTENANCE_WARNING_KM);
  return { estado: cerca ? "POR_VENCER" : "AL_DIA", proximaFecha, proximoKm, diasRestantes, kmRestantes };
}

/** En qué situación está una unidad de la flota, en palabras. */
export const FLEET_STATUS_LABEL: Record<string, string> = {
  AL_DIA: "Puede salir",
  POR_VENCER: "Algo vence pronto",
  FALTA: "Le falta un papel",
  VENCIDO: "Con algo vencido",
  BAJA: "Dada de baja",
};

/** Desde qué año se le exige la revisión técnica a una unidad. Null si no se sabe su año. */
export function anioPrimeraRevision(year: number | null | undefined): number | null {
  return year ? year + REVISION_TECNICA_ANIOS_GRACIA : null;
}

/**
 * Si a esta unidad ya le toca tener revisión técnica.
 *
 * Sin el año del vehículo se da por exigible: no poder probar que está exonerada no es lo
 * mismo que estarlo, y es preferible una alerta de más que una unidad parada en un control
 * por un papel que sí hacía falta.
 */
export function exigeRevisionTecnica(year: number | null | undefined, hoy = todayLima()): boolean {
  const desde = anioPrimeraRevision(year);
  if (desde === null) return true;
  return Number(hoy.slice(0, 4)) >= desde;
}

export function documentStatus(expiresAt: string | null | undefined, hoy = todayLima()): DocumentStatus {
  if (!expiresAt) return "SIN_FECHA";
  if (expiresAt < hoy) return "VENCIDO";
  return expiresAt <= addDays(hoy, DOCUMENT_WARNING_DAYS) ? "POR_VENCER" : "VIGENTE";
}

/** Cuántos días faltan (o pasaron) para el vencimiento. Negativo si ya venció. */
export function daysToExpiry(expiresAt: string | null | undefined, hoy = todayLima()): number | null {
  if (!expiresAt) return null;
  return Math.round((Date.parse(`${expiresAt}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / DAY);
}

/**
 * De qué documento se trata, deducido del nombre del archivo.
 *
 * Los nombres vienen de personas distintas y de escáneres distintos: "REVISION TECNICA",
 * "Revisión Técnica 1" y "RT-D4D838" son el mismo papel. Se compara sin tildes ni
 * mayúsculas. Lo que no reconoce queda como "otro": es preferible guardarlo y
 * reclasificarlo después que dejarlo fuera y que nadie se acuerde.
 */
export function documentKindFromFilename(nombre: string): string {
  const limpio = String(nombre ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/SOAT/.test(limpio)) return "SOAT";
  if (/REVISION\s*TECNICA|\bRT[-_ ]/.test(limpio)) return "REVISION_TECNICA";
  if (/TARJETA.*PROPIEDAD|[-_ ]RP\b/.test(limpio)) return "TARJETA_PROPIEDAD";
  if (/TARJETA.*CIRCULACION|\bTUC\b|TIVE/.test(limpio)) return "TARJETA_CIRCULACION";
  if (/POLIZA|SEGURO/.test(limpio)) return "POLIZA";
  if (/\bMTC\b|HABILITACION/.test(limpio)) return "MTC";
  return "OTRO_VEHICULO";
}

/**
 * Una placa siempre escrita igual: mayúsculas y con guion. "bja838" y "BJA 838" son la
 * misma unidad, y sin normalizar quedarían como dos vehículos distintos.
 */
export function normalizePlate(valor: string): string {
  const limpio = String(valor ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (limpio.length < 5) return limpio;
  // El formato peruano es de tres caracteres, guion, y tres más.
  return `${limpio.slice(0, 3)}-${limpio.slice(3)}`;
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

export function formatFileSize(bytes: number | null | undefined) {
  // Un documento puede estar registrado solo con su fecha de vencimiento, sin el PDF
  // todavía: así se avisa de la caducidad aunque el papel no esté escaneado.
  if (bytes === null || bytes === undefined) return "Sin archivo";
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
