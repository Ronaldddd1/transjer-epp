import type { Role } from "@/db/schema";

/** Catálogo de permisos. Para un nuevo rol, añade una entrada en ROLE_PERMISSIONS. */
export const PERMISSIONS = [
  "products.view", "products.manage",
  "movements.view", "movements.create", "movements.adjust",
  "deliveries.view", "deliveries.create", "deliveries.void",
  "employees.view", "employees.manage",
  "categories.manage",
  "users.manage",
  "reports.view",
  "audit.view",
  "invoices.view", "invoices.manage", "invoices.pay",
  "suppliers.manage",
  "invoices.mailbox",
  // Aceptar o rechazar un comprobante que llegó por correo. Va aparte de invoices.manage
  // porque decide si la empresa reconoce la deuda y, al rechazar, sale un correo firmado
  // por la empresa: no es lo mismo que registrar una factura ya aceptada.
  "invoices.approve",
  "obligations.view", "obligations.manage", "obligations.pay",
  "detractions.view", "detractions.manage",
  "documents.view", "documents.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  USUARIO: [
    "products.view",
    "movements.view", "movements.create",
    "deliveries.view", "deliveries.create",
    "employees.view",
    "documents.view",
  ],
  // Jefe de almacén: manda en todo el módulo de EPP, sin usuarios ni facturas.
  JEFE_ALMACEN: [
    "products.view", "products.manage",
    "movements.view", "movements.create", "movements.adjust",
    "deliveries.view", "deliveries.create", "deliveries.void",
    "employees.view", "employees.manage",
    "categories.manage",
    "documents.view", "documents.manage",
    "reports.view",
  ],
  // Administración y Finanzas: gestiona las facturas de proveedores, no el almacén.
  FINANZAS: [
    "invoices.view", "invoices.manage", "invoices.pay", "invoices.approve",
    "suppliers.manage",
    "obligations.view", "obligations.manage", "obligations.pay",
    "detractions.view", "detractions.manage",
    "documents.view",
    "reports.view",
  ],
  // Encargada de detracciones: solo deposita y da cuenta del 4 % al Banco de la Nación.
  // Ve las facturas para saber sobre qué está depositando, pero no las registra ni las paga.
  DETRACCIONES: [
    "invoices.view",
    "detractions.view", "detractions.manage",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  JEFE_ALMACEN: "Jefe de almacén",
  USUARIO: "Usuario",
  FINANZAS: "Finanzas",
  DETRACCIONES: "Detracciones",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Acceso total al sistema.",
  JEFE_ALMACEN: "Almacén completo: productos, categorías, trabajadores, ajustes y reportes. Sin usuarios ni facturas.",
  USUARIO: "Almacén: consulta el inventario, registra movimientos y entregas.",
  FINANZAS: "Facturas de proveedores, préstamos y servicios: registra, revisa y marca los pagos.",
  DETRACCIONES: "Solo detracciones: consulta las facturas y registra los depósitos del 4 % al Banco de la Nación.",
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
