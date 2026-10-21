import "server-only";
import { db, type Tx } from "@/db";
import { auditLogs } from "@/db/schema";
import type { CurrentUser } from "./auth";

export type AuditModule = "PRODUCTOS" | "CATEGORIAS" | "TRABAJADORES" | "MOVIMIENTOS" | "ENTREGAS" | "USUARIOS" | "SESION" | "FACTURAS" | "PROVEEDORES" | "CORREO" | "OBLIGACIONES" | "DETRACCIONES" | "DOCUMENTOS" | "MANTENIMIENTO";
export type AuditAction = "CREAR" | "EDITAR" | "ELIMINAR" | "ACTIVAR" | "DESACTIVAR" | "ENTRADA" | "SALIDA" | "AJUSTE" | "ENTREGA" | "ANULAR" | "CONTRASEÑA" | "INGRESO" | "PAGAR" | "OBSERVAR" | "REABRIR" | "IMPORTAR" | "ADJUNTAR";

export const AUDIT_MODULES: AuditModule[] = ["PRODUCTOS", "CATEGORIAS", "TRABAJADORES", "MOVIMIENTOS", "ENTREGAS", "FACTURAS", "PROVEEDORES", "CORREO", "OBLIGACIONES", "DETRACCIONES", "DOCUMENTOS", "MANTENIMIENTO", "USUARIOS", "SESION"];

const SENSITIVE_KEYS = new Set(["passwordHash", "password"]);

function clean(data: unknown) {
  if (data === undefined || data === null) return null;
  return JSON.parse(JSON.stringify(data, (key, value) => (SENSITIVE_KEYS.has(key) ? undefined : value)));
}

export async function logAudit(
  entry: {
    user: Pick<CurrentUser, "id" | "name"> | null;
    action: AuditAction;
    module: AuditModule;
    recordId?: string | null;
    description: string;
    oldData?: unknown;
    newData?: unknown;
  },
  tx?: Tx,
) {
  await (tx ?? db).insert(auditLogs).values({
    userId: entry.user?.id ?? null,
    userName: entry.user?.name ?? null,
    action: entry.action,
    module: entry.module,
    recordId: entry.recordId ?? null,
    description: entry.description,
    oldData: clean(entry.oldData),
    newData: clean(entry.newData),
  });
}
