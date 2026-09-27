import type { Metadata } from "next";
import { TransjerLogo } from "@/components/layout/brand";
import { first, type SearchParams } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const year = new Date().getFullYear();

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center bg-ink px-4 py-10">
      <div className="hazard-texture absolute inset-0" aria-hidden />
      <div className="hazard-stripe absolute inset-x-0 top-0 h-1.5" aria-hidden />

      <div className="relative w-full max-w-[420px]">
        <div className="rounded-xl border border-steel-200 bg-white px-7 py-9 shadow-2xl shadow-black/40 sm:px-10">
          <TransjerLogo width={168} priority className="mx-auto" />

          <div className="mt-8 border-t border-steel-200 pt-7">
            <h1 className="font-display text-2xl font-bold text-ink">Iniciar sesión</h1>
            <p className="mt-1 text-[15px] text-steel-500">Ingresa con tu usuario o correo corporativo.</p>
            <LoginForm next={first(sp.next) ?? ""} />
          </div>

          <p className="mt-7 border-t border-steel-200 pt-5 text-[13px] leading-relaxed text-steel-500">
            Acceso exclusivo para personal autorizado. Si olvidaste tu contraseña,
            solicita al administrador del sistema que la restablezca.
          </p>
        </div>

        <footer className="mt-7 text-center text-[13px] text-steel-500">
          <p className="font-medium text-steel-400">Transjer Operador Logístico S.A.C.</p>
          <p className="mt-0.5">Sistema de gestión interna · {year}</p>
        </footer>
      </div>
    </main>
  );
}
