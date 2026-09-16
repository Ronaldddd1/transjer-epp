import type { Metadata } from "next";
import { BrandLockup } from "@/components/layout/brand";
import { first, type SearchParams } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <BrandLockup inverted />
        <div className="max-w-md">
          <h1 className="font-display text-[56px] font-bold leading-[0.95] tracking-tight">
            Control de Inventario de EPP
          </h1>
          <p className="mt-5 text-lg text-steel-300">
            Stock, entregas al personal y trazabilidad de cada equipo de protección, en un solo lugar.
          </p>
        </div>
        <p className="text-sm text-steel-500">Transjer Operador Logístico S.A.C.</p>
        <div className="hazard-stripe absolute inset-x-0 bottom-0 h-2" aria-hidden />
      </section>

      <section className="flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 lg:hidden"><BrandLockup /></div>
          <h2 className="font-display text-3xl font-bold text-ink">Iniciar sesión</h2>
          <p className="mt-1 text-steel-500">Ingresa con tu usuario o correo corporativo.</p>
          <LoginForm next={first(sp.next) ?? ""} />
        </div>
      </section>
    </main>
  );
}
