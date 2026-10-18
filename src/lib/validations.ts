import { z } from "zod";
import { OBLIGATION_TYPES, REJECT_REASONS } from "@/lib/utils";

/** Concuerda el mensaje con el género del campo: "La serie es obligatoria", "El motivo es obligatorio". */
function required(label: string) {
  const art = label.trim().split(" ")[0].toLowerCase();
  const concordancia: Record<string, string> = {
    la: "es obligatoria",
    las: "son obligatorias",
    los: "son obligatorios",
  };
  return `${label} ${concordancia[art] ?? "es obligatorio"}`;
}

const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => (v ? v : null));
const requiredText = (label: string, max: number) =>
  z.string({ required_error: required(label) }).trim().min(1, required(label)).max(max, `Máximo ${max} caracteres`);
/** Un campo en blanco no es un cero: se deja pasar como NaN para que la validación lo rechace. */
const vacioEsNada = (v: unknown) => (typeof v === "string" && v.trim() === "" ? Number.NaN : v);

/**
 * Campo numérico entero.
 *
 * El campo vacío se rechaza en vez de valer 0. `Number("")` da 0 sin protestar, y eso
 * convertía un ajuste de inventario con la cantidad en blanco en un ajuste a cero: el stock
 * del producto se iba a 0 y quedaba en auditoría como un ajuste legítimo. Un número que no
 * se escribió no es un cero.
 */
const intField = (label: string, min = 0, max?: number) => {
  let numero = z.coerce.number({ invalid_type_error: `${label} debe ser un número` })
    .int(`${label} debe ser un número entero`)
    .min(min, `${label} debe ser mayor o igual a ${min}`);
  if (max !== undefined) numero = numero.max(max, `${label} no puede pasar de ${max}`);
  return z.preprocess(vacioEsNada, numero);
};
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export const productBaseSchema = z.object({
  name: requiredText("El nombre", 150),
  categoryId: z.string().uuid("Selecciona una categoría"),
  description: optionalText(1000),
  brand: optionalText(80),
  size: optionalText(20),
  color: optionalText(40),
  unit: requiredText("La unidad de medida", 30),
  minimumStock: intField("El stock mínimo"),
  notes: optionalText(1000),
});

/**
 * El código también se edita.
 *
 * Antes quedaba fijo al crear el producto, y un código mal escrito se arrastraba para
 * siempre o forzaba a crear el producto de nuevo y perder su historial. Al cambiarlo, el
 * historial sigue colgando del mismo producto: lo que cambia es la etiqueta, no la cosa.
 */
export const productEditSchema = productBaseSchema.extend({
  code: requiredText("El código", 30).transform((v) => v.toUpperCase()),
});

export const productCreateSchema = productEditSchema.extend({
  initialStock: intField("El stock inicial"),
});

/**
 * Entrega de varios EPP a un mismo trabajador, de una sola vez.
 *
 * Las cantidades llegan como un campo por producto (`cantidad_<id>`), así que se validan
 * en la acción: aquí van los datos que son comunes a toda la entrega.
 */
export const bulkDeliverySchema = z.object({
  employeeId: z.string().uuid("Selecciona un trabajador"),
  deliveryDate: ymd,
  reason: requiredText("El motivo", 120),
  notes: optionalText(1000),
});

export const categorySchema = z.object({
  name: requiredText("El nombre", 80),
  description: optionalText(500),
});

export const employeeSchema = z.object({
  dni: z.string().trim().regex(/^\d{8,12}$/, "El DNI debe tener entre 8 y 12 dígitos"),
  firstName: requiredText("Los nombres", 80),
  lastName: requiredText("Los apellidos", 80),
  position: requiredText("El cargo", 80),
  area: requiredText("El área", 80),
  phone: z.string().trim().regex(/^[\d +()-]{0,20}$/, "Teléfono inválido").optional().transform((v) => (v ? v : null)),
  hireDate: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  notes: optionalText(1000),
});

export const movementSchema = z.object({
  productId: z.string().uuid("Selecciona un producto"),
  type: z.enum(["ENTRADA", "SALIDA", "AJUSTE"]),
  // Sin el filtro de vacío, un ajuste con la cantidad en blanco valía 0 y dejaba el stock
  // del producto en cero, registrado como un ajuste normal.
  quantity: z.preprocess(vacioEsNada, z.coerce.number({ invalid_type_error: "La cantidad debe ser un número" })
    .int("La cantidad debe ser un número entero")),
  reason: requiredText("El motivo", 120),
  notes: optionalText(1000),
}).superRefine((d, ctx) => {
  if (d.type !== "AJUSTE" && d.quantity <= 0) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "La cantidad debe ser mayor a 0" });
  }
  if (d.type === "AJUSTE" && d.quantity < 0) {
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Indica el stock contado (0 o más)" });
  }
});

export const deliverySchema = z.object({
  employeeId: z.string().uuid("Selecciona un trabajador"),
  productId: z.string().uuid("Selecciona un EPP"),
  quantity: intField("La cantidad", 1),
  deliveryDate: ymd,
  reason: requiredText("El motivo", 120),
  notes: optionalText(1000),
});

export const voidDeliverySchema = z.object({
  voidReason: requiredText("El motivo de la anulación", 250).refine((v) => v.length >= 5, "Explica el motivo (mínimo 5 caracteres)"),
});

/** Cese del trabajador: desde aquí el sistema le reclama el EPP que tiene a su cargo. */
export const terminationSchema = z.object({
  terminatedAt: ymd,
  terminationReason: optionalText(160),
});

/** Devolución de EPP: lo que el trabajador entrega de vuelta y en qué estado llega. */
export const eppReturnSchema = z.object({
  productId: z.string().uuid("Selecciona un EPP"),
  quantity: intField("La cantidad", 1),
  returnDate: ymd,
  condition: z.enum(["REUTILIZABLE", "DESCARTADO", "NO_DEVUELTO"]),
  reason: requiredText("El motivo", 120),
  notes: optionalText(1000),
}).superRefine((d, ctx) => {
  // Lo que no se entregó no es una devolución sin explicación: es una pérdida que alguien
  // tendrá que justificar, así que se exige la nota.
  if (d.condition === "NO_DEVUELTO" && !d.notes) {
    ctx.addIssue({ code: "custom", path: ["notes"], message: "Explica qué pasó con el EPP que no devolvió" });
  }
});


// --------------------------------------------------------------------------
// Facturas de proveedores
// --------------------------------------------------------------------------

/** Importe en soles o dólares: acepta "1180", "1180.50" o "1,180.50". */
const money = (label: string) =>
  z.string({ required_error: required(label) })
    .trim()
    .min(1, required(label))
    .transform((v) => v.replace(/\s/g, "").replace(/,/g, ""))
    .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), `${label} debe ser un importe válido, por ejemplo 1180.50`)
    .transform((v) => Number(v).toFixed(2));

const optionalMoney = (label: string) =>
  z.string().trim().optional()
    .transform((v) => (v ? v.replace(/\s/g, "").replace(/,/g, "") : ""))
    .refine((v) => v === "" || /^\d{1,12}(\.\d{1,2})?$/.test(v), `${label} debe ser un importe válido`)
    .transform((v) => (v === "" ? null : Number(v).toFixed(2)));

export const supplierSchema = z.object({
  // El RUC puede faltar: los proveedores que vienen del control en Excel no lo traen y se
  // completa cuando llega una factura electrónica suya con el XML.
  ruc: z.string().trim().optional().or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{11}$/.test(v), "El RUC debe tener 11 dígitos"),
  businessName: requiredText("La razón social", 200),
  tradeName: optionalText(200),
  email: z.string().trim().toLowerCase().email("Correo inválido").optional().or(z.literal("")).transform((v) => (v ? v : null)),
  phone: z.string().trim().regex(/^[\d +()-]{0,20}$/, "Teléfono inválido").optional().transform((v) => (v ? v : null)),
  contactName: optionalText(120),
  notes: optionalText(1000),
  defaultPaymentTerm: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  defaultTermDays: intField("Los días de plazo", 0, 180).default(1),
});

export const invoiceSchema = z.object({
  supplierId: z.string().uuid("Selecciona un proveedor"),
  docType: z.enum(["FACTURA", "BOLETA", "NOTA_CREDITO", "NOTA_DEBITO"]),
  series: requiredText("La serie", 8).transform((v) => v.toUpperCase()),
  number: requiredText("El número", 12).transform((v) => v.replace(/^0+(?=\d)/, "")),
  issueDate: ymd,
  dueDate: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  serviceDate: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  /** Cuándo llegó la factura: desde aquí corre el plazo de pago. */
  receivedDate: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  paymentTerm: z.enum(["CONTADO", "CREDITO"]),
  termDays: intField("Los días de plazo", 0, 180),
  /** Entrega física de la guía. Solo aplica a crédito; desde aquí corre el plazo. */
  guideReceivedAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  currency: z.enum(["PEN", "USD"]),
  subtotal: optionalMoney("El subtotal"),
  igv: optionalMoney("El IGV"),
  total: money("El importe total"),
  description: optionalText(250),
  grtNumber: optionalText(40),
  notes: optionalText(1000),
  // --- Datos del servicio de transporte ---
  contactName: optionalText(120),
  plate: z.string().trim().toUpperCase().max(24, "Máximo 24 caracteres").optional().or(z.literal("")).transform((v) => (v ? v : null)),
  clientName: optionalText(120),
  originCity: optionalText(80),
  destinationCity: optionalText(120),
  volumeM3: optionalMoney("El volumen"),
  weightTn: optionalMoney("El peso"),
  advances: optionalMoney("Los adelantos"),
}).superRefine((d, ctx) => {
  if (d.dueDate && d.dueDate < d.issueDate) {
    ctx.addIssue({ code: "custom", path: ["dueDate"], message: "El vencimiento no puede ser anterior a la emisión" });
  }
  if (Number(d.total) <= 0) {
    ctx.addIssue({ code: "custom", path: ["total"], message: "El importe total debe ser mayor a 0" });
  }
  if (d.paymentTerm === "CONTADO" && d.guideReceivedAt) {
    ctx.addIssue({ code: "custom", path: ["guideReceivedAt"], message: "La entrega de guía solo aplica a las facturas a crédito" });
  }
  if (d.guideReceivedAt && d.guideReceivedAt < d.issueDate) {
    ctx.addIssue({ code: "custom", path: ["guideReceivedAt"], message: "La guía no pudo entregarse antes de emitirse la factura" });
  }
});

/** Registro del depósito de la detracción en el Banco de la Nación. */
export const detractionSchema = z.object({
  detractionStatus: z.enum(["NO_APLICA", "PENDIENTE", "EN_PROCESO", "PAGADA", "OBSERVADA"]),
  detractionPaidAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  detractionReceipt: optionalText(40),
  detractionOperation: optionalText(40),
  detractionNotes: optionalText(1000),
}).superRefine((d, ctx) => {
  if (d.detractionStatus === "PAGADA" && !d.detractionPaidAt) {
    ctx.addIssue({ code: "custom", path: ["detractionPaidAt"], message: "Una detracción pagada necesita la fecha del depósito" });
  }
  // La constancia es lo que permite cuadrar el depósito con el Banco de la Nación después;
  // el formulario la pedía con asterisco y el servidor la dejaba pasar en blanco.
  if (d.detractionStatus === "PAGADA" && !d.detractionReceipt) {
    ctx.addIssue({ code: "custom", path: ["detractionReceipt"], message: "Anota el número de constancia del depósito" });
  }
  if (d.detractionStatus !== "PAGADA" && d.detractionPaidAt) {
    ctx.addIssue({ code: "custom", path: ["detractionPaidAt"], message: "Solo una detracción pagada lleva fecha de depósito" });
  }
  if (d.detractionStatus === "OBSERVADA" && !d.detractionNotes) {
    ctx.addIssue({ code: "custom", path: ["detractionNotes"], message: "Explica qué se observó" });
  }
});

/** Anotar la entrega física de la guía: es lo que hace arrancar el plazo de una factura a crédito. */
export const guideReceivedSchema = z.object({
  guideReceivedAt: ymd,
  notes: optionalText(500),
});

// ---------- Obligaciones periódicas ----------

/** Una casilla marcada llega como "on"; sin marcar no llega. */
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const optionalInt = (label: string, min: number, max: number) =>
  z.string().trim().optional().or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d+$/.test(v), `${label} debe ser un número entero`)
    .transform((v) => (v === null ? null : Number(v)))
    .refine((v) => v === null || (v >= min && v <= max), `${label} debe estar entre ${min} y ${max}`);

export const obligationSchema = z.object({
  type: z.enum(OBLIGATION_TYPES),
  name: requiredText("El nombre", 160),
  creditor: requiredText("La entidad", 160),
  reference: optionalText(80),
  /** Con qué se agrupa en el listado. Vacío: se deduce del nombre. */
  category: optionalText(80),
  currency: z.enum(["PEN", "USD"]),
  // Préstamos
  principal: optionalMoney("El capital"),
  annualRate: z.string().trim().optional().or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{1,3}(\.\d{1,3})?$/.test(v), "La tasa debe ser un porcentaje válido")
    .refine((v) => v === null || Number(v) <= 200, "La tasa no puede pasar de 200 %")
    .transform((v) => (v === null ? null : Number(v).toFixed(3))),
  installmentsCount: optionalInt("El número de cuotas", 1, 360),
  disbursedAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  // Servicios y alquileres
  // Hasta 31: en los meses más cortos el vencimiento cae en el último día del mes.
  billingDay: optionalInt("El día de pago", 1, 31),
  /** Vencimiento de la primera cuota de un servicio. Opcional: sin él arranca este mes. */
  firstDueDate: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  /** Hasta cuándo rige el contrato. Sin fecha, el servicio sigue indefinidamente. */
  endsAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  variableAmount: checkbox,
  fixedAmount: optionalMoney("El importe"),
  notes: optionalText(1000),
}).superRefine((d, ctx) => {
  if (d.type === "PRESTAMO" && !d.disbursedAt) {
    ctx.addIssue({ code: "custom", path: ["disbursedAt"], message: "Un préstamo necesita su fecha de desembolso" });
  }
  // Basta con uno de los dos: la fecha de la primera cuota ya dice qué día del mes vence.
  if (d.type !== "PRESTAMO" && !d.billingDay && !d.firstDueDate) {
    ctx.addIssue({ code: "custom", path: ["billingDay"], message: "Indica qué día del mes vence, o la fecha de la primera cuota" });
  }
  if (d.type === "PRESTAMO" && d.firstDueDate) {
    ctx.addIssue({ code: "custom", path: ["firstDueDate"], message: "En un préstamo la primera cuota sale del cronograma" });
  }
  if (d.type === "PRESTAMO" && d.endsAt) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "Un préstamo termina con su última cuota, no lleva vigencia" });
  }
  if (d.endsAt && d.firstDueDate && d.endsAt < d.firstDueDate) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "La vigencia no puede terminar antes de la primera cuota" });
  }
  if (d.type !== "PRESTAMO" && !d.variableAmount && !d.fixedAmount) {
    ctx.addIssue({ code: "custom", path: ["fixedAmount"], message: "Indica el importe, o marca que cambia cada mes" });
  }
});

/** Una fila del cronograma, tal como se guarda. */
export const installmentRowSchema = z.object({
  number: z.number().int().min(1).max(360),
  dueDate: ymd,
  principal: z.number().nullable(),
  interest: z.number().nullable(),
  insurance: z.number().nullable(),
  total: z.number().positive("Cada cuota debe ser mayor a 0"),
  balanceAfter: z.number().nullable().optional(),
});

export const scheduleSchema = z.object({
  rows: z.array(installmentRowSchema).min(1, "El cronograma no tiene cuotas").max(360, "Máximo 360 cuotas"),
});

export const payInstallmentSchema = z.object({
  paidAt: ymd,
  paidAmount: money("El importe pagado"),
  paymentReference: optionalText(120),
  notes: optionalText(1000),
});

/** Anotar el importe del recibo de un servicio de monto variable. */
export const installmentAmountSchema = z.object({
  total: money("El importe"),
  notes: optionalText(1000),
});

/**
 * Renegociación del importe de un servicio.
 *
 * `from` es el mes desde el que rige el precio nuevo: lo anterior se queda como está,
 * porque eso ya se pagó o ya se debe a su precio de entonces.
 */
export const renegotiationSchema = z.object({
  amount: money("El importe nuevo"),
  from: ymd,
  reason: optionalText(300),
});

/** Un documento de un trabajador o de un vehículo. */
export const documentSchema = z.object({
  // Uno de los dos, nunca los dos: lo comprueba la acción, que es la que sabe si existen.
  employeeId: optionalText(40),
  vehicleId: optionalText(40),
  kind: z.string().trim().min(1, "Elige qué documento es").max(30),
  title: optionalText(160),
  issuedAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  expiresAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  notes: optionalText(1000),
}).superRefine((d, ctx) => {
  if (d.expiresAt && d.issuedAt && d.expiresAt < d.issuedAt) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "No puede vencer antes de haberse emitido" });
  }
});

export const vehicleSchema = z.object({
  plate: requiredText("La placa", 10),
  description: optionalText(160),
  notes: optionalText(1000),
});

export const payInvoiceSchema = z.object({
  paidAt: ymd,
  paymentReference: optionalText(120),
  paymentNotes: optionalText(1000),
});

export const observeInvoiceSchema = z.object({
  statusReason: requiredText("El motivo", 250).refine((v) => v.length >= 5, "Explica el motivo (mínimo 5 caracteres)"),
});

/**
 * Aceptar un comprobante del buzón. Los datos del comprobante vienen del XML y no se
 * tocan; lo único que se decide aquí es la condición de pago, que no está en el XML:
 * la pacta la empresa con el proveedor.
 */
export const approveEmailSchema = z.object({
  paymentTerm: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  termDays: z.coerce.number().int("Los días deben ser un número entero")
    .min(0, "No puede ser negativo").max(365, "Son demasiados días").default(0),
  description: optionalText(250),
});

/**
 * Rechazar un comprobante. El cuerpo del correo llega ya armado desde la pantalla, donde
 * quien rechaza pudo leerlo y corregirlo: se guarda y se envía tal cual lo aprobó.
 */
export const rejectEmailSchema = z.object({
  reason: z.enum(REJECT_REASONS as [string, ...string[]]),
  comment: optionalText(1000),
  replyTo: z.string().trim().max(250)
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Esa dirección de correo no es válida")
    .optional().or(z.literal("")),
  body: requiredText("El texto del correo", 4000)
    .refine((v) => v.length >= 20, "El texto es demasiado corto"),
  /** Sin esto se registra el rechazo, pero no se le avisa al proveedor. */
  send: z.coerce.boolean().default(false),
});


const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100);

export const userBaseSchema = z.object({
  name: requiredText("El nombre", 120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "Usa 3 a 50 caracteres: letras, números, punto, guion"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  role: z.enum(["ADMIN", "USUARIO", "FINANZAS", "JEFE_ALMACEN", "DETRACCIONES"]),
});
export const userCreateSchema = userBaseSchema.extend({ password });
export const passwordSchema = z.object({ password });

export const loginSchema = z.object({
  identifier: requiredText("El usuario o correo", 160),
  password: z.string().min(1, "La contraseña es obligatoria"),
});
