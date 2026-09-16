import type { Role } from "@/db/schema";

/** Catálogo de permisos. Para un nuevo rol, añade una entrada en ROLE_PERMISSIONS. */
export const PERMISSIONS = [
  "products.view", "products.manage",
  "movements.view", "movements.create", "movements.adjust",
  "deliveries.view", "deliveries.create",
  "employees.view", "employees.manage",
  "categories.manage",
  "users.manage",
  "reports.view",
  "audit.view",
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
};

export const ROLE_LABELS: Record<Role, string> = { ADMIN: "Administrador", USUARIO: "Usuario" };

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
