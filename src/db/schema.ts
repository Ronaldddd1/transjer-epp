/**
 * Esquema de base de datos — Control de Inventario de EPP (Transjer)
 * Para agregar un rol: añádelo a `roleEnum` y define sus permisos en src/lib/permissions.ts,
 * luego ejecuta `npm run db:generate` y `npm run db:migrate`.
 */
import { relations, sql } from "drizzle-orm";
import {
  OBLIGATION_TYPES,
  type InvoiceEmailStatusKey, type InvoiceServiceTypeKey, type ObligationTypeKey,
} from "@/lib/utils";
import {
  boolean, check, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp,
  uniqueIndex, uuid, varchar,
} from "drizzle-orm/pg-core";

/** Contenido binario de un adjunto (solo se usa con el modo de almacenamiento "db"). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const roleEnum = pgEnum("role", ["ADMIN", "USUARIO", "FINANZAS", "JEFE_ALMACEN", "DETRACCIONES"]);
export const movementTypeEnum = pgEnum("movement_type", ["ENTRADA", "SALIDA", "AJUSTE"]);
/** Facturas de proveedores por servicios de transporte. */
export const invoiceDocTypeEnum = pgEnum("invoice_doc_type", ["FACTURA", "BOLETA", "NOTA_CREDITO", "NOTA_DEBITO"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["PENDIENTE", "PAGADA", "OBSERVADA", "ANULADA"]);
export const invoiceSourceEnum = pgEnum("invoice_source", ["MANUAL", "CORREO"]);
// El estado del correo es texto con CHECK, no un enum: agregarle un estado más (como
// "por aprobar" y "rechazado") dentro de una migración exige que no sea enum.
export const attachmentKindEnum = pgEnum("attachment_kind", ["FACTURA_PDF", "FACTURA_XML", "GRT", "OTRO"]);
/**
 * Condición de pago pactada con el proveedor.
 *   CONTADO  el plazo corre desde que llega la factura por correo.
 *   CREDITO  el plazo corre desde que además llega físicamente la guía de remisión.
 */
export const paymentTermEnum = pgEnum("payment_term", ["CONTADO", "CREDITO"]);

/**
 * Estado de la detracción del 4 % que se deposita en el Banco de la Nación.
 * NO_APLICA es para las operaciones por debajo del umbral de S/ 400, que no se detraen.
 */
export const detractionStatusEnum = pgEnum("detraction_status", [
  "NO_APLICA", "PENDIENTE", "EN_PROCESO", "PAGADA", "OBSERVADA",
]);

/**
 * En qué estado vuelve un EPP cuando el trabajador lo entrega.
 *   REUTILIZABLE  sirve para otro trabajador, así que regresa al stock.
 *   DESCARTADO    volvió, pero gastado o roto: se da de baja y no regresa al stock.
 *   NO_DEVUELTO   el trabajador no lo entregó. Queda registrado para dar cuenta de la pérdida.
 */
export const returnConditionEnum = pgEnum("return_condition", ["REUTILIZABLE", "DESCARTADO", "NO_DEVUELTO"]);

/** Obligaciones periódicas: préstamos bancarios, servicios, alquileres e impuestos. */
/**
 * Los tipos de obligación son texto con una restricción CHECK, no un enum de Postgres.
 *
 * Eran un enum, pero agregarle un valor a un enum y usarlo en la misma corrida de
 * migraciones no se puede: Postgres no deja usar un valor recién agregado hasta que la
 * transacción cierra, y Drizzle corre todas las migraciones pendientes en una sola. Con
 * texto, sumar un tipo nuevo es agregarlo a OBLIGATION_TYPES en src/lib/utils.ts y
 * ampliar la restricción en una migración.
 */
const tiposEnSql = sql.raw(OBLIGATION_TYPES.map((t) => `'${t}'`).join(","));
export const obligationStatusEnum = pgEnum("obligation_status", ["ACTIVA", "CERRADA", "ANULADA"]);
export const installmentStatusEnum = pgEnum("installment_status", ["PENDIENTE", "PAGADA", "ANULADA"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("USUARIO"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  description: text("description"),
  brand: varchar("brand", { length: 80 }),
  size: varchar("size", { length: 20 }),
  color: varchar("color", { length: 40 }),
  unit: varchar("unit", { length: 30 }).notNull().default("Unidad"),
  stock: integer("stock").notNull().default(0),
  minimumStock: integer("minimum_stock").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("products_category_idx").on(t.categoryId),
  index("products_active_name_idx").on(t.active, t.name),
  check("products_stock_non_negative", sql`${t.stock} >= 0`),
  check("products_min_stock_non_negative", sql`${t.minimumStock} >= 0`),
]);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  dni: varchar("dni", { length: 12 }).notNull().unique(),
  firstName: varchar("first_name", { length: 80 }).notNull(),
  lastName: varchar("last_name", { length: 80 }).notNull(),
  position: varchar("position", { length: 80 }).notNull(),
  area: varchar("area", { length: 80 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  hireDate: date("hire_date"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  /**
   * Cese del trabajador. Se guarda aparte de `active` porque desactivar y cesar no son lo
   * mismo: un trabajador se puede desactivar por licencia, y solo el cese obliga a que
   * devuelva el EPP que tiene a su cargo.
   */
  terminatedAt: date("terminated_at"),
  terminationReason: varchar("termination_reason", { length: 160 }),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("employees_active_lastname_idx").on(t.active, t.lastName),
  index("employees_terminated_idx").on(t.terminatedAt),
]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  type: movementTypeEnum("type").notNull(),
  /** Entradas y salidas: siempre positiva. Ajustes: positiva o negativa. */
  quantity: integer("quantity").notNull(),
  stockBefore: integer("stock_before").notNull(),
  stockAfter: integer("stock_after").notNull(),
  reason: varchar("reason", { length: 120 }).notNull(),
  employeeId: uuid("employee_id").references(() => employees.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("movements_product_date_idx").on(t.productId, t.createdAt),
  index("movements_type_date_idx").on(t.type, t.createdAt),
  index("movements_user_idx").on(t.userId),
  index("movements_date_idx").on(t.createdAt),
]);

export const eppDeliveries = pgTable("epp_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  movementId: uuid("movement_id").notNull().unique().references(() => inventoryMovements.id),
  quantity: integer("quantity").notNull(),
  size: varchar("size", { length: 20 }),
  deliveryDate: date("delivery_date").notNull(),
  reason: varchar("reason", { length: 120 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Anulación: la entrega no se borra; se marca y su stock vuelve con una entrada vinculada.
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  voidedBy: uuid("voided_by").references(() => users.id),
  voidReason: varchar("void_reason", { length: 250 }),
  voidMovementId: uuid("void_movement_id").unique().references(() => inventoryMovements.id),
}, (t) => [
  check("deliveries_void_consistent", sql`(${t.voidedAt} is null) = (${t.voidMovementId} is null)`),
  index("deliveries_employee_date_idx").on(t.employeeId, t.deliveryDate),
  index("deliveries_product_idx").on(t.productId),
  index("deliveries_date_idx").on(t.deliveryDate),
]);

/**
 * Devolución de EPP: lo que el trabajador entrega de vuelta, normalmente al cesar.
 *
 * No es lo contrario de una entrega ni la anula: la entrega ocurrió y sigue en el historial.
 * Esto registra que el EPP volvió, y en qué estado. Solo lo que vuelve reutilizable suma
 * stock otra vez, y ese movimiento de ENTRADA queda vinculado para poder rastrearlo.
 *
 * Lo que un trabajador tiene a su cargo = entregas vigentes − devoluciones.
 */
export const eppReturns = pgTable("epp_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  size: varchar("size", { length: 20 }),
  returnDate: date("return_date").notNull(),
  condition: returnConditionEnum("condition").notNull(),
  /** Solo existe cuando el EPP volvió reutilizable y por tanto regresó al stock. */
  movementId: uuid("movement_id").unique().references(() => inventoryMovements.id),
  reason: varchar("reason", { length: 120 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("returns_quantity_positive", sql`${t.quantity} > 0`),
  check("returns_movement_consistent", sql`(${t.condition} = 'REUTILIZABLE') = (${t.movementId} is not null)`),
  index("returns_employee_idx").on(t.employeeId, t.returnDate),
  index("returns_product_idx").on(t.productId),
  index("returns_date_idx").on(t.returnDate),
]);


// ---------------------------------------------------------------------------
// Facturas de proveedores (Administración y Finanzas)
// ---------------------------------------------------------------------------

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * El RUC llega con el XML del comprobante electrónico. Los proveedores que vienen del
   * control en Excel se registran solo con su nombre y el RUC queda pendiente: por eso
   * admite nulo y el sistema avisa de los que faltan.
   */
  ruc: varchar("ruc", { length: 11 }).unique(),
  businessName: varchar("business_name", { length: 200 }).notNull(),
  tradeName: varchar("trade_name", { length: 200 }),
  email: varchar("email", { length: 160 }),
  phone: varchar("phone", { length: 20 }),
  contactName: varchar("contact_name", { length: 120 }),
  notes: text("notes"),
  /** Condición pactada con este proveedor; se propone al registrar una factura suya. */
  defaultPaymentTerm: paymentTermEnum("default_payment_term").notNull().default("CONTADO"),
  /** Días de plazo por defecto. Contado suele ser 1; crédito, 7. */
  defaultTermDays: integer("default_term_days").notNull().default(1),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("suppliers_active_name_idx").on(t.active, t.businessName),
  check("suppliers_ruc_format", sql`${t.ruc} is null or ${t.ruc} ~ '^[0-9]{11}$'`),
  check("suppliers_term_days_range", sql`${t.defaultTermDays} between 0 and 180`),
]);

export const supplierInvoices = pgTable("supplier_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  docType: invoiceDocTypeEnum("doc_type").notNull().default("FACTURA"),
  /** Serie y correlativo del comprobante, p. ej. F001 y 2589. */
  series: varchar("series", { length: 8 }).notNull(),
  number: varchar("number", { length: 12 }).notNull(),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date"),
  serviceDate: date("service_date"),
  currency: varchar("currency", { length: 3 }).notNull().default("PEN"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }),
  igv: numeric("igv", { precision: 14, scale: 2 }),
  total: numeric("total", { precision: 14, scale: 2 }).notNull(),
  description: varchar("description", { length: 250 }),
  /** Guía de Remisión Transportista asociada al servicio. */
  grtNumber: varchar("grt_number", { length: 40 }),
  /** Guía de remisión del remitente (la del cliente), cuando el XML la trae. */
  dispatchNote: varchar("dispatch_note", { length: 40 }),
  /**
   * Qué clase de factura es, según quien la aprueba: transporte o servicio.
   * Decide el plazo de pago y qué datos se piden. Null en las anteriores a este cambio.
   */
  serviceType: varchar("service_type", { length: 12 }).$type<InvoiceServiceTypeKey>(),
  // --- Datos del servicio de transporte, tal como se controlaban en el Excel ---
  /** Quién coordinó el servicio con el transportista. */
  contactName: varchar("contact_name", { length: 120 }),
  /** Placa del vehículo. Admite dos cuando el viaje fue con tractor y carreta. */
  plate: varchar("plate", { length: 24 }),
  /** Cliente de Transjer para el que se hizo el flete. */
  clientName: varchar("client_name", { length: 120 }),
  originCity: varchar("origin_city", { length: 80 }),
  destinationCity: varchar("destination_city", { length: 120 }),
  volumeM3: numeric("volume_m3", { precision: 8, scale: 2 }),
  weightTn: numeric("weight_tn", { precision: 8, scale: 2 }),
  /** Pagos a cuenta hechos al transportista antes de cancelar la factura. */
  advances: numeric("advances", { precision: 14, scale: 2 }),

  // --- Detracción del 4 % al Banco de la Nación ---
  detractionRate: numeric("detraction_rate", { precision: 5, scale: 2 }).notNull().default("4.00"),
  /** Monto a depositar, en soles enteros. Cero cuando la operación no llega al umbral. */
  detractionAmount: numeric("detraction_amount", { precision: 14, scale: 2 }),
  detractionStatus: detractionStatusEnum("detraction_status").notNull().default("PENDIENTE"),
  detractionPaidAt: date("detraction_paid_at"),
  /** Número de constancia del depósito. */
  detractionReceipt: varchar("detraction_receipt", { length: 40 }),
  /** Número de operación bancaria. */
  detractionOperation: varchar("detraction_operation", { length: 40 }),
  detractionBy: uuid("detraction_by").references(() => users.id),
  detractionNotes: text("detraction_notes"),

  /** Condición de pago: contado cuenta desde el correo, crédito desde la entrega de la guía. */
  paymentTerm: paymentTermEnum("payment_term").notNull().default("CONTADO"),
  /** Días de plazo desde que empieza a correr el tiempo. */
  termDays: integer("term_days").notNull().default(1),
  /** Cuándo entregó el proveedor la guía en físico. Se anota a mano; sin ella el crédito no arranca. */
  guideReceivedAt: date("guide_received_at"),
  /**
   * Fecha límite de pago, ya calculada. Se recalcula al crear o editar la factura y al
   * anotar la guía. Queda en null mientras una factura a crédito espera su guía.
   */
  payDueDate: date("pay_due_date"),
  status: invoiceStatusEnum("status").notNull().default("PENDIENTE"),
  paidAt: date("paid_at"),
  paymentReference: varchar("payment_reference", { length: 120 }),
  paymentNotes: text("payment_notes"),
  paidBy: uuid("paid_by").references(() => users.id),
  /** Motivo cuando la factura se devuelve al proveedor o se anula. */
  statusReason: varchar("status_reason", { length: 250 }),
  source: invoiceSourceEnum("source").notNull().default("MANUAL"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  // Un mismo comprobante no puede registrarse dos veces para el mismo proveedor.
  uniqueIndex("invoices_supplier_doc_unique").on(t.supplierId, t.docType, t.series, t.number),
  index("invoices_status_date_idx").on(t.status, t.issueDate),
  index("invoices_supplier_idx").on(t.supplierId),
  index("invoices_issue_date_idx").on(t.issueDate),
  index("invoices_pay_due_idx").on(t.status, t.payDueDate),
  check("invoices_term_days_range", sql`${t.termDays} between 0 and 180`),
  index("invoices_detraction_idx").on(t.detractionStatus, t.detractionPaidAt),
  index("invoices_client_idx").on(t.clientName),
  check("invoices_detraction_rate_range", sql`${t.detractionRate} between 0 and 100`),
  check("invoices_detraction_amount_positive", sql`${t.detractionAmount} is null or ${t.detractionAmount} >= 0`),
  // Una detracción pagada siempre guarda su fecha de depósito, y una sin pagar nunca la tiene.
  check("invoices_detraction_paid_consistent", sql`(${t.detractionStatus} = 'PAGADA') = (${t.detractionPaidAt} is not null)`),
  check("invoices_total_positive", sql`${t.total} > 0`),
  check("invoices_service_type_valid", sql`${t.serviceType} is null or ${t.serviceType} in ('TRANSPORTE','SERVICIO')`),
  check("invoices_currency_valid", sql`${t.currency} in ('PEN','USD')`),
  // Una factura pagada siempre guarda su fecha de pago, y viceversa.
  check("invoices_paid_consistent", sql`(${t.status} = 'PAGADA') = (${t.paidAt} is not null)`),
]);

export const invoiceEmails = pgTable("invoice_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Identificador del mensaje en el buzón: evita procesar dos veces el mismo correo. */
  messageId: varchar("message_id", { length: 400 }).notNull().unique(),
  internetMessageId: varchar("internet_message_id", { length: 400 }),
  subject: varchar("subject", { length: 400 }),
  fromAddress: varchar("from_address", { length: 250 }),
  fromName: varchar("from_name", { length: 250 }),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("REVISAR").$type<InvoiceEmailStatusKey>(),
  invoiceId: uuid("invoice_id").references(() => supplierInvoices.id, { onDelete: "set null" }),
  attachmentCount: integer("attachment_count").notNull().default(0),
  detail: text("detail"),
  parsed: jsonb("parsed"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  /** Quién aceptó o rechazó el comprobante, y cuándo. */
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  rejectReason: varchar("reject_reason", { length: 30 }),
  rejectComment: text("reject_comment"),
  /**
   * La respuesta que se le mandó al proveedor. Se guarda lo enviado y, si no salió, el
   * motivo: un rechazo cuyo correo falló se ve igual que uno que llegó, y del otro lado
   * nadie se entera de que su factura fue devuelta.
   */
  replyTo: varchar("reply_to", { length: 250 }),
  replyBody: text("reply_body"),
  replySentAt: timestamp("reply_sent_at", { withTimezone: true }),
  replyError: text("reply_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoice_emails_status_date_idx").on(t.status, t.receivedAt),
  index("invoice_emails_date_idx").on(t.receivedAt),
  check("invoice_emails_status_valid",
    sql`${t.status} in ('POR_APROBAR','PROCESADO','REVISAR','DESCARTADO','RECHAZADO','ERROR')`),
]);

export const invoiceAttachments = pgTable("invoice_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").references(() => supplierInvoices.id, { onDelete: "cascade" }),
  emailId: uuid("email_id").references(() => invoiceEmails.id, { onDelete: "cascade" }),
  kind: attachmentKindEnum("kind").notNull().default("OTRO"),
  filename: varchar("filename", { length: 250 }).notNull(),
  contentType: varchar("content_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Dónde vive el archivo: "db" (columna content), "blob" o "supabase" (storageKey). */
  storageDriver: varchar("storage_driver", { length: 20 }).notNull(),
  storageKey: varchar("storage_key", { length: 500 }),
  content: bytea("content"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoice_attachments_invoice_idx").on(t.invoiceId),
  index("invoice_attachments_email_idx").on(t.emailId),
  check("invoice_attachments_owner", sql`${t.invoiceId} is not null or ${t.emailId} is not null`),
]);

/** Ajustes del sistema en pares clave/valor: estado de la conexión con el buzón, etc. */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 60 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * Obligaciones periódicas de la empresa: préstamos bancarios, planes de celular, luz,
 * internet, alquileres e impuestos. Cada una tiene su cronograma en `obligationInstallments`.
 *
 * Un préstamo trae el cronograma completo del banco (capital, interés, seguro y saldo).
 * Un servicio de monto variable genera cuotas mensuales sin importe, que se completan
 * cuando llega el recibo.
 */
export const obligations = pgTable("obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: varchar("type", { length: 16 }).notNull().default("SERVICIO").$type<ObligationType>(),
  /** Cómo la llama la empresa: "Préstamo BCP capital de trabajo", "Claro - flota". */
  name: varchar("name", { length: 160 }).notNull(),
  /** A quién se le paga: BCP, Interbank, Claro, Movistar, el arrendador. */
  creditor: varchar("creditor", { length: 160 }).notNull(),
  /** Número de crédito, de cuenta o de suministro. */
  reference: varchar("reference", { length: 80 }),
  /**
   * Con qué se agrupa en el listado: "Cochera", "Seguro vehicular", "Línea Entel".
   *
   * No sirve la entidad ni el nombre. La entidad en la práctica trae la placa o el número
   * de línea, y el nombre lleva dentro esa misma unidad, así que agrupar por cualquiera de
   * los dos deja cada cochera y cada seguro en su propio bloque, que es justo lo contrario
   * de lo que hace falta para ver cuánto se va en cocheras este mes.
   */
  category: varchar("category", { length: 80 }),
  currency: varchar("currency", { length: 3 }).notNull().default("PEN"),

  // --- Solo préstamos ---
  principal: numeric("principal", { precision: 14, scale: 2 }),
  /** Tasa efectiva anual, en porcentaje: 17.00 */
  annualRate: numeric("annual_rate", { precision: 6, scale: 3 }),
  installmentsCount: integer("installments_count"),
  disbursedAt: date("disbursed_at"),

  // --- Solo servicios y alquileres ---
  /**
   * Día del mes en que vence, del 1 al 31. En los meses que no llegan a ese día el
   * vencimiento cae en el último: un servicio que vence el 31 vence el 28 en febrero.
   */
  billingDay: integer("billing_day"),
  /**
   * Cuándo vence la primera cuota. Permite registrar un servicio que arranca el mes que
   * viene, o uno que empezó meses atrás y hay que poner al día. Si está vacío, los
   * vencimientos arrancan este mes en el día de pago, que es como funcionaba antes.
   */
  firstDueDate: date("first_due_date"),
  /**
   * Hasta cuándo rige el contrato. Pasada esa fecha no se generan más vencimientos, así
   * que un alquiler a plazo fijo deja de aparecer en el calendario cuando toca y no sigue
   * acumulando cuotas que nadie va a pagar.
   */
  endsAt: date("ends_at"),
  /** El importe cambia cada mes (luz, celular por consumo). */
  variableAmount: boolean("variable_amount").notNull().default(false),
  /** Importe cuando no varía (alquiler, plan fijo). */
  fixedAmount: numeric("fixed_amount", { precision: 14, scale: 2 }),

  status: obligationStatusEnum("status").notNull().default("ACTIVA"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("obligations_status_type_idx").on(t.status, t.type),
  index("obligations_creditor_idx").on(t.creditor),
  check("obligations_type_valid", sql`${t.type} in (${tiposEnSql})`),
  check("obligations_currency_valid", sql`${t.currency} in ('PEN','USD')`),
  check("obligations_billing_day_range", sql`${t.billingDay} is null or ${t.billingDay} between 1 and 31`),
  check("obligations_vigencia_coherente", sql`${t.endsAt} is null or ${t.firstDueDate} is null or ${t.endsAt} >= ${t.firstDueDate}`),
  check("obligations_principal_positive", sql`${t.principal} is null or ${t.principal} > 0`),
]);

/** Una fila del cronograma: la cuota número N de una obligación. */
export const obligationInstallments = pgTable("obligation_installments", {
  id: uuid("id").primaryKey().defaultRandom(),
  obligationId: uuid("obligation_id").notNull().references(() => obligations.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  dueDate: date("due_date").notNull(),

  principal: numeric("principal", { precision: 14, scale: 2 }),
  interest: numeric("interest", { precision: 14, scale: 2 }),
  /** Seguro de desgravamen u otros seguros que cobra el banco dentro de la cuota. */
  insurance: numeric("insurance", { precision: 14, scale: 2 }),
  fees: numeric("fees", { precision: 14, scale: 2 }),
  /** Importe de la cuota. Null mientras un servicio variable espera su recibo. */
  total: numeric("total", { precision: 14, scale: 2 }),
  /** Saldo de capital que queda después de pagar esta cuota. */
  balanceAfter: numeric("balance_after", { precision: 14, scale: 2 }),

  status: installmentStatusEnum("status").notNull().default("PENDIENTE"),
  paidAt: date("paid_at"),
  /** Lo que realmente se pagó, que puede diferir de la cuota programada. */
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }),
  paymentReference: varchar("payment_reference", { length: 120 }),
  paidBy: uuid("paid_by").references(() => users.id),
  notes: text("notes"),
  /**
   * Cuándo se avisó por WhatsApp que esta cuota estaba por vencer. Evita que el mismo
   * vencimiento se avise cada día hasta que llegue: se avisa una vez y queda marcado.
   */
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  ...timestamps,
}, (t) => [
  uniqueIndex("obligation_installment_number_unique").on(t.obligationId, t.number),
  index("installments_status_due_idx").on(t.status, t.dueDate),
  index("installments_obligation_idx").on(t.obligationId),
  check("installments_total_positive", sql`${t.total} is null or ${t.total} > 0`),
  // Una cuota pagada siempre guarda su fecha de pago, y viceversa.
  check("installments_paid_consistent", sql`(${t.status} = 'PAGADA') = (${t.paidAt} is not null)`),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: varchar("user_name", { length: 120 }),
  action: varchar("action", { length: 30 }).notNull(),
  module: varchar("module", { length: 30 }).notNull(),
  recordId: varchar("record_id", { length: 60 }),
  description: text("description").notNull(),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_module_date_idx").on(t.module, t.createdAt),
  index("audit_user_idx").on(t.userId),
  index("audit_date_idx").on(t.createdAt),
]);

// Relaciones
export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  movements: many(inventoryMovements),
  deliveries: many(eppDeliveries),
}));
export const employeesRelations = relations(employees, ({ many }) => ({
  deliveries: many(eppDeliveries),
  movements: many(inventoryMovements),
  returns: many(eppReturns),
}));
export const eppReturnsRelations = relations(eppReturns, ({ one }) => ({
  employee: one(employees, { fields: [eppReturns.employeeId], references: [employees.id] }),
  product: one(products, { fields: [eppReturns.productId], references: [products.id] }),
  movement: one(inventoryMovements, { fields: [eppReturns.movementId], references: [inventoryMovements.id] }),
  user: one(users, { fields: [eppReturns.userId], references: [users.id] }),
}));
export const movementsRelations = relations(inventoryMovements, ({ one }) => ({
  product: one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  employee: one(employees, { fields: [inventoryMovements.employeeId], references: [employees.id] }),
  user: one(users, { fields: [inventoryMovements.userId], references: [users.id] }),
}));
export const deliveriesRelations = relations(eppDeliveries, ({ one }) => ({
  employee: one(employees, { fields: [eppDeliveries.employeeId], references: [employees.id] }),
  product: one(products, { fields: [eppDeliveries.productId], references: [products.id] }),
  movement: one(inventoryMovements, { fields: [eppDeliveries.movementId], references: [inventoryMovements.id] }),
  user: one(users, { fields: [eppDeliveries.userId], references: [users.id] }),
}));
export const suppliersRelations = relations(suppliers, ({ many }) => ({ invoices: many(supplierInvoices) }));
export const supplierInvoicesRelations = relations(supplierInvoices, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [supplierInvoices.supplierId], references: [suppliers.id] }),
  attachments: many(invoiceAttachments),
}));
export const invoiceAttachmentsRelations = relations(invoiceAttachments, ({ one }) => ({
  invoice: one(supplierInvoices, { fields: [invoiceAttachments.invoiceId], references: [supplierInvoices.id] }),
  email: one(invoiceEmails, { fields: [invoiceAttachments.emailId], references: [invoiceEmails.id] }),
}));
export const invoiceEmailsRelations = relations(invoiceEmails, ({ one, many }) => ({
  invoice: one(supplierInvoices, { fields: [invoiceEmails.invoiceId], references: [supplierInvoices.id] }),
  attachments: many(invoiceAttachments),
}));
export const obligationsRelations = relations(obligations, ({ many }) => ({
  installments: many(obligationInstallments),
}));
/**
 * Los vehículos de la flota, identificados por su placa.
 *
 * Existen para colgarles los documentos: SOAT, tarjeta de propiedad, de circulación y
 * revisión técnica. Hasta ahora la placa solo aparecía escrita dentro del nombre de un
 * seguro o una cochera, que sirve para leerlo pero no para buscar por unidad.
 */
export const vehicles = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Siempre con guion y en mayúsculas: BJA-838. Se normaliza antes de guardar. */
  plate: varchar("plate", { length: 10 }).notNull().unique(),
  /** Marca y modelo, o como la llamen en operaciones. */
  description: varchar("description", { length: 160 }),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("vehicles_active_idx").on(t.active),
]);

/**
 * Los documentos de un trabajador o de un vehículo.
 *
 * El archivo se guarda igual que los adjuntos de las facturas, con el mismo almacén, así
 * que no hay dos formas distintas de guardar un PDF en el sistema.
 *
 * `expiresAt` es el motivo de que esto exista y no sea una carpeta compartida: el SOAT y
 * la revisión técnica vencen cada año, y una unidad circulando con el SOAT vencido es una
 * multa y un problema de seguro. Con la fecha guardada, el sistema avisa antes.
 */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** De quién es: uno de los dos va lleno, nunca los dos ni ninguno. */
  employeeId: uuid("employee_id").references(() => employees.id, { onDelete: "cascade" }),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "cascade" }),
  /** Qué documento es: SOAT, LICENCIA, TARJETA_PROPIEDAD… Ver DOCUMENT_KIND_LABEL. */
  kind: varchar("kind", { length: 30 }).notNull().default("OTRO"),
  /** Cómo lo llama la empresa, por si hay dos del mismo tipo. */
  title: varchar("title", { length: 160 }),
  issuedAt: date("issued_at"),
  /** Sin fecha, el documento no caduca: una tarjeta de propiedad, por ejemplo. */
  expiresAt: date("expires_at"),
  notes: text("notes"),
  filename: varchar("filename", { length: 250 }).notNull(),
  contentType: varchar("content_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageDriver: varchar("storage_driver", { length: 20 }).notNull(),
  storageKey: varchar("storage_key", { length: 500 }),
  content: bytea("content"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("documents_employee_idx").on(t.employeeId),
  index("documents_vehicle_idx").on(t.vehicleId),
  index("documents_expires_idx").on(t.expiresAt),
  check("documents_owner", sql`(${t.employeeId} is not null) <> (${t.vehicleId} is not null)`),
  check("documents_size_positive", sql`${t.sizeBytes} > 0`),
  check("documents_fechas_coherentes", sql`${t.expiresAt} is null or ${t.issuedAt} is null or ${t.expiresAt} >= ${t.issuedAt}`),
]);

export const obligationInstallmentsRelations = relations(obligationInstallments, ({ one }) => ({
  obligation: one(obligations, { fields: [obligationInstallments.obligationId], references: [obligations.id] }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type MovementType = (typeof movementTypeEnum.enumValues)[number];
export type Supplier = typeof suppliers.$inferSelect;
export type SupplierInvoice = typeof supplierInvoices.$inferSelect;
export type InvoiceAttachment = typeof invoiceAttachments.$inferSelect;
export type InvoiceEmail = typeof invoiceEmails.$inferSelect;
export type InvoiceDocType = (typeof invoiceDocTypeEnum.enumValues)[number];
export type InvoiceStatus = (typeof invoiceStatusEnum.enumValues)[number];
export type InvoiceEmailStatus = InvoiceEmailStatusKey;
export type AttachmentKind = (typeof attachmentKindEnum.enumValues)[number];
export type PaymentTerm = (typeof paymentTermEnum.enumValues)[number];
export type DetractionStatus = (typeof detractionStatusEnum.enumValues)[number];
export type Obligation = typeof obligations.$inferSelect;
export type ObligationInstallment = typeof obligationInstallments.$inferSelect;
export type ObligationType = ObligationTypeKey;
export type ObligationStatus = (typeof obligationStatusEnum.enumValues)[number];
export type InstallmentStatus = (typeof installmentStatusEnum.enumValues)[number];
export type Vehicle = typeof vehicles.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type EppReturn = typeof eppReturns.$inferSelect;
export type ReturnCondition = (typeof returnConditionEnum.enumValues)[number];
