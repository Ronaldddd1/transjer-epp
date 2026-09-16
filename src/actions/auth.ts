"use server";

import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { formToObject } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { loginSchema } from "@/lib/validations";

export type LoginState = { error?: string } | undefined;

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse(formToObject(formData));
  if (!parsed.success) return { error: "Ingresa tu usuario o correo y tu contraseña." };

  const identifier = parsed.data.identifier.toLowerCase();
  const [user] = await db
    .select()
    .from(users)
    .where(or(eq(users.username, identifier), eq(users.email, identifier)))
    .limit(1);

  // Se compara siempre un hash para no revelar si el usuario existe.
  const hash = user?.passwordHash ?? "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.QZ4h1U1Fq1sT7m8rP0.9eCJtQy6e";
  const valid = await bcrypt.compare(parsed.data.password, hash);
  if (!user || !valid) return { error: "Usuario o contraseña incorrectos." };
  if (!user.active) return { error: "Tu usuario está desactivado. Contacta al administrador." };

  await createSession(user);
  await logAudit({ user, action: "INGRESO", module: "SESION", recordId: user.id, description: `${user.name} inició sesión.` });
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logoutAction() {
  const user = await getCurrentUser();
  if (user) await destroySession();
  redirect("/login");
}
