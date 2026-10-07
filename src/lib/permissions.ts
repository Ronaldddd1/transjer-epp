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
  "obligations.view", "obligations.manage", "obligations.pay",
  "detractions.view", "detractions.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  USUARIO: [
    "products.view",
    "movements.view", "movements.create",
    "deliveries.view", "deliveries.create",
    "employees.view",
  ],
  // Jefe de almacén: manda en todo el módulo de EPP, sin usuarios ni facturas.
  JEFE_ALMACEN: [
    "products.view", "products.manage",
    "movements.view", "movements.create", "movements.adjust",
    "deliveries.view", "deliveries.create", "deliveries.void",
    "employees.view", "employees.manage",
    "categories.manage",
    "reports.view",
  ],
  // Administración y Finanzas: gestiona las facturas de proveedores, no el almacén.
  FINANZAS: [
    "invoices.view", "invoices.manage", "invoices.pay",
    "suppliers.manage",
    "obligations.view", "obligations.manage", "obligations.pay",
    "detractions.view", "detractions.manage",
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
