import { ZodError } from "zod";
import { AuthError } from "./auth";

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export class BusinessError extends Error {}

/** Convierte cualquier error en un mensaje claro para el usuario. */
export function toActionError(error: unknown): ActionResult {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, message: "Revisa los campos marcados.", fieldErrors };
  }
  if (error instanceof AuthError || error instanceof BusinessError) {
    return { ok: false, message: error.message };
  }
  const pg = findPgError(error);
  if (pg?.code === "23505") return { ok: false, message: "Ya existe un registro con ese valor (código, DNI, usuario o correo repetido)." };
  if (pg?.code === "23514") return { ok: false, message: "No hay suficiente stock disponible." };
  if (pg?.code === "23503") return { ok: false, message: "El registro está relacionado con otros datos y no se puede modificar así." };
  console.error(error);
  return { ok: false, message: "Ocurrió un error inesperado. Inténtalo nuevamente." };
}

function findPgError(error: unknown): { code?: string } | null {
  let e: unknown = error;
  for (let i = 0; i < 4 && e && typeof e === "object"; i++) {
    if ("code" in e && typeof (e as { code: unknown }).code === "string") return e as { code: string };
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export function formToObject(formData: FormData) {
  const obj: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") obj[key] = value.trim();
  });
  return obj;
}
