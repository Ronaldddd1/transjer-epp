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
  // Mantenimiento de la flota: cambios de aceite, lavados y revisiones periódicas.
  // Va aparte de los documentos porque son dos trabajos distintos: uno cuida los papeles
  // y el otro cuida el camión.
  "maintenance.view", "maintenance.manage",
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
  /**
   * Mantenimiento: cuida que las unidades pasen lo que tienen que pasar.
   *
   * Ve los documentos para saber cuándo vence la revisión técnica, pero no los administra:
   * subir y corregir papeles es trabajo de documentación.
   */
  MANTENIMIENTO: [
    "maintenance.view", "maintenance.manage",
    "documents.view",
  ],
  /** Documentación: los papeles de la flota y de los trabajadores, nada más. */
  DOCUMENTACION: [
    "documents.view", "documents.manage",
    "employees.view",
  ],
  /** Operación: mantenimiento, documentación y almacén. No ve facturas ni usuarios. */
  OPERACION: [
    "maintenance.view", "maintenance.manage",
    "documents.view", "documents.manage",
    "products.view", "products.manage",
    "movements.view", "movements.create", "movements.adjust",
    "deliveries.view", "deliveries.create", "deliveries.void",
    "employees.view", "employees.manage",
    "categories.manage",
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
  MANTENIMIENTO: "Mantenimiento",
  DOCUMENTACION: "Documentación",
  OPERACION: "Operación",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Acceso total al sistema.",
  JEFE_ALMACEN: "Almacén completo: productos, categorías, trabajadores, ajustes y reportes. Sin usuarios ni facturas.",
  USUARIO: "Almacén: consulta el inventario, registra movimientos y entregas.",
  FINANZAS: "Facturas de proveedores, préstamos y servicios: registra, revisa y marca los pagos.",
  DETRACCIONES: "Solo detracciones: consulta las facturas y registra los depósitos del 4 % al Banco de la Nación.",
  MANTENIMIENTO: "Mantenimiento de la flota: registra cambios de aceite, lavados y revisiones, y ve los documentos para saber cuándo vencen.",
  DOCUMENTACION: "Documentos de la flota y de los trabajadores: los sube, los corrige y controla sus vencimientos.",
  OPERACION: "Mantenimiento, documentos y almacén completo. Sin facturas ni usuarios.",
};

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
