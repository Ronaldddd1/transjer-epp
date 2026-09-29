import { z } from "zod";

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
const intField = (label: string, min = 0) =>
  z.coerce.number({ invalid_type_error: `${label} debe ser un número` }).int(`${label} debe ser un número entero`).min(min, `${label} debe ser mayor o igual a ${min}`);
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

export const productCreateSchema = productBaseSchema.extend({
  code: requiredText("El código", 30).transform((v) => v.toUpperCase()),
  initialStock: intField("El stock inicial"),
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
  quantity: z.coerce.number({ invalid_type_error: "La cantidad debe ser un número" }).int("La cantidad debe ser un número entero"),
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
  ruc: z.string().trim().regex(/^\d{11}$/, "El RUC debe tener 11 dígitos"),
  businessName: requiredText("La razón social", 200),
  tradeName: optionalText(200),
  email: z.string().trim().toLowerCase().email("Correo inválido").optional().or(z.literal("")).transform((v) => (v ? v : null)),
  phone: z.string().trim().regex(/^[\d +()-]{0,20}$/, "Teléfono inválido").optional().transform((v) => (v ? v : null)),
  contactName: optionalText(120),
  notes: optionalText(1000),
  defaultPaymentTerm: z.enum(["CONTADO", "CREDITO"]).default("CONTADO"),
  defaultTermDays: intField("Los días de plazo").max(180, "El plazo no puede pasar de 180 días").default(1),
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
  termDays: intField("Los días de plazo").max(180, "El plazo no puede pasar de 180 días"),
  /** Entrega física de la guía. Solo aplica a crédito; desde aquí corre el plazo. */
  guideReceivedAt: ymd.optional().or(z.literal("")).transform((v) => (v ? v : null)),
  currency: z.enum(["PEN", "USD"]),
  subtotal: optionalMoney("El subtotal"),
  igv: optionalMoney("El IGV"),
  total: money("El importe total"),
  description: optionalText(250),
  grtNumber: optionalText(40),
  notes: optionalText(1000),
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
  type: z.enum(["PRESTAMO", "SERVICIO", "ALQUILER", "IMPUESTO", "OTRO"]),
  name: requiredText("El nombre", 160),
  creditor: requiredText("La entidad", 160),
  reference: optionalText(80),
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
  billingDay: optionalInt("El día de pago", 1, 28),
  variableAmount: checkbox,
  fixedAmount: optionalMoney("El importe"),
  notes: optionalText(1000),
}).superRefine((d, ctx) => {
  if (d.type === "PRESTAMO" && !d.disbursedAt) {
    ctx.addIssue({ code: "custom", path: ["disbursedAt"], message: "Un préstamo necesita su fecha de desembolso" });
  }
  if (d.type !== "PRESTAMO" && !d.billingDay) {
    ctx.addIssue({ code: "custom", path: ["billingDay"], message: "Indica qué día del mes vence" });
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

export const payInvoiceSchema = z.object({
  paidAt: ymd,
  paymentReference: optionalText(120),
  paymentNotes: optionalText(1000),
});

export const observeInvoiceSchema = z.object({
  statusReason: requiredText("El motivo", 250).refine((v) => v.length >= 5, "Explica el motivo (mínimo 5 caracteres)"),
});


const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100);

export const userBaseSchema = z.object({
  name: requiredText("El nombre", 120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "Usa 3 a 50 caracteres: letras, números, punto, guion"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  role: z.enum(["ADMIN", "USUARIO", "FINANZAS", "JEFE_ALMACEN"]),
});
export const userCreateSchema = userBaseSchema.extend({ password });
export const passwordSchema = z.object({ password });

export const loginSchema = z.object({
  identifier: requiredText("El usuario o correo", 160),
  password: z.string().min(1, "La contraseña es obligatoria"),
});
