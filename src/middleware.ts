import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Rutas que llaman servicios externos y no pueden llevar la sesión del navegador.
 * Cada una comprueba su propia identidad: el aviso de Microsoft valida su palabra secreta
 * y la tarea programada valida la clave CRON_SECRET.
 */
const PUBLIC_API = ["/api/correo/graph", "/api/cron/"];

/** Primera barrera: sin sesión válida no se accede a ninguna página interna. Los permisos se validan en el servidor. */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_API.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  const isLogin = pathname === "/login";

  if (!session && !isLogin) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    const url = new URL("/login", req.url);
    if (pathname !== "/" && pathname !== "/dashboard") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (session && isLogin) return NextResponse.redirect(new URL("/dashboard", req.url));
  return NextResponse.next();
}

export const config = {
  // Se excluyen los archivos estáticos: el logotipo debe verse en el login, antes de haber sesión.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)"],
};
