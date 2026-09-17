import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max, `Máximo ${max} caracteres`).optional().transform((v) => (v ? v : null));
const requiredText = (label: string, max: number) =>
  z.string({ required_error: `${label} es obligatorio` }).trim().min(1, `${label} es obligatorio`).max(max, `Máximo ${max} caracteres`);
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

const password = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(100);

export const userBaseSchema = z.object({
  name: requiredText("El nombre", 120),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "Usa 3 a 50 caracteres: letras, números, punto, guion"),
  email: z.string().trim().toLowerCase().email("Correo inválido"),
  role: z.enum(["ADMIN", "USUARIO"]),
});
export const userCreateSchema = userBaseSchema.extend({ password });
export const passwordSchema = z.object({ password });

export const loginSchema = z.object({
  identifier: requiredText("El usuario o correo", 160),
  password: z.string().min(1, "La contraseña es obligatoria"),
});
