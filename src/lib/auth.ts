import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { users, type Role } from "@/db/schema";
import { AuthError } from "./auth-error";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE, SESSION_MAX_AGE, signSession, verifySession } from "./session";

export type CurrentUser = { id: string; name: string; username: string; email: string; role: Role };

export async function createSession(user: { id: string; role: Role; name: string }) {
  const token = await signSession({ sub: user.id, role: user.role, name: user.name });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Lee la sesión y confirma en BD que el usuario sigue activo (los cambios de rol aplican al instante). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const [user] = await db
    .select({ id: users.id, name: users.name, username: users.username, email: users.email, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, session.sub))
    .limit(1);
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, username: user.username, email: user.email, role: user.role };
});

/** Para páginas: redirige si no hay sesión o no tiene permiso. */
export async function requirePageUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/dashboard?denied=1");
  return user;
}

export { AuthError } from "./auth-error";

/** Para server actions: lanza error si no hay sesión o permiso. */
export async function requireActionUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Tu sesión expiró. Vuelve a iniciar sesión.");
  if (permission && !can(user.role, permission)) throw new AuthError("No tienes permiso para realizar esta acción.");
  return user;
}
