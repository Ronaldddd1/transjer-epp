"use client";

import {
  ArrowLeftRight, BarChart3, Building2, CalendarCheck, CalendarDays, ChevronDown, ClipboardCheck, ClipboardList,
  FolderOpen, HardHat, Landmark, LayoutDashboard, LogOut, Mail, Menu, PackageSearch, Receipt, ShieldCheck,
  Tags, Undo2, Users, Wallet, Wrench, X,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logoutAction } from "@/actions/auth";
import type { Role } from "@/db/schema";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { BrandLockup, BrandMark } from "./brand";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; permission?: Permission };
type NavSection = { id: string; label: string; items: NavItem[] };

/**
 * El menú va por secciones para que siga siendo legible conforme crecen los módulos.
 * Cada sección se abre y se cierra, y la que contiene la página actual se abre sola, así
 * nadie tiene que buscar dónde está parado.
 *
 * El dashboard queda fuera de las secciones: es la portada y conviene tenerla siempre a mano.
 */
const INICIO: NavItem = { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard };

const SECTIONS: NavSection[] = [
  {
    id: "almacen",
    label: "Almacén",
    items: [
      { href: "/inventario", label: "Inventario", icon: PackageSearch, permission: "products.view" },
      { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight, permission: "movements.view" },
      { href: "/entregas", label: "Entrega de EPP", icon: HardHat, permission: "deliveries.view" },
      { href: "/entregas/resumen", label: "Resumen de EPP", icon: ClipboardCheck, permission: "deliveries.view" },
      { href: "/devoluciones", label: "Devolución de EPP", icon: Undo2, permission: "deliveries.view" },
      { href: "/trabajadores", label: "Trabajadores", icon: Users, permission: "employees.view" },
      { href: "/asistencia", label: "Asistencia", icon: CalendarCheck, permission: "attendance.view" },
    ],
  },
  {
    // La flota es su propio trabajo, no una carpeta del almacén: tiene a quien le cuida
    // los papeles y a quien le cuida el camión, y son personas distintas.
    id: "flota",
    label: "Flota",
    items: [
      { href: "/documentos", label: "Documentos", icon: FolderOpen, permission: "documents.view" },
      { href: "/mantenimiento", label: "Mantenimiento", icon: Wrench, permission: "maintenance.view" },
    ],
  },
  {
    id: "proveedores",
    label: "Proveedores",
    items: [
      { href: "/facturas", label: "Facturas", icon: Receipt, permission: "invoices.view" },
      { href: "/detracciones", label: "Detracciones", icon: Landmark, permission: "detractions.view" },
      { href: "/proveedores", label: "Proveedores", icon: Building2, permission: "suppliers.manage" },
      { href: "/facturas/correos", label: "Buzón de correo", icon: Mail, permission: "invoices.mailbox" },
    ],
  },
  {
    id: "finanzas",
    label: "Finanzas",
    items: [
      { href: "/obligaciones", label: "Préstamos y servicios", icon: Wallet, permission: "obligations.view" },
      { href: "/calendario", label: "Calendario de pagos", icon: CalendarDays, permission: "invoices.view" },
    ],
  },
  {
    id: "reportes",
    label: "Reportes",
    items: [
      { href: "/reportes", label: "Reportes y exportación", icon: BarChart3, permission: "reports.view" },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    items: [
      { href: "/categorias", label: "Categorías", icon: Tags, permission: "categories.manage" },
      { href: "/usuarios", label: "Usuarios", icon: ShieldCheck, permission: "users.manage" },
      { href: "/auditoria", label: "Auditoría", icon: ClipboardList, permission: "audit.view" },
    ],
  },
];

/** Indica en el menú que la sección elegida se está cargando (sustituye al esqueleto de carga). */
function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={cn(
        "h-3.5 w-3.5 shrink-0 rounded-full border-2 border-brand border-t-transparent",
        pending ? "animate-spin opacity-100" : "hidden",
      )}
    />
  );
}

export function AppShell({ user, lowStockCount, pendingInvoices = 0, pendingDetractions = 0, pendingReturns = 0, children }: {
  user: { name: string; role: Role };
  lowStockCount: number;
  pendingInvoices?: number;
  pendingDetractions?: number;
  pendingReturns?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const visible = (items: NavItem[]) => items.filter((i) => !i.permission || can(user.role, i.permission));

  // Solo se muestran las secciones donde el rol tiene algo que hacer: así la encargada de
  // detracciones ve un menú de dos entradas en vez de uno lleno de secciones vacías.
  const secciones = SECTIONS
    .map((s) => ({ ...s, items: visible(s.items) }))
    .filter((s) => s.items.length > 0);

  const enSeccion = (s: NavSection) =>
    s.items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  /**
   * Qué secciones están abiertas.
   *
   * Arranca abierta solo la que contiene la pantalla actual, y las demás plegadas: con
   * seis secciones y dieciséis entradas, el menú entero obliga a leerlo todo para
   * encontrar una cosa. Lo que el usuario abra o cierre a mano manda sobre esto mientras
   * navega.
   */
  const [tocadas, setTocadas] = useState<Record<string, boolean>>({});

  /**
   * Cuáles se abren solas.
   *
   * Solo se pliega cuando hay menú de sobra: por encima de diez entradas, leerlas todas
   * para encontrar una cuesta más que abrir una sección. Un menú corto —el de finanzas, el
   * de documentación— se deja entero, porque ahí plegar solo añade un clic.
   *
   * Cuando se pliega, queda abierta la sección de la pantalla en la que se está; y si
   * ninguna la contiene —el dashboard no pertenece a ninguna—, la primera que el rol vea:
   * un menú con todo plegado es un menú vacío, que es peor que uno largo.
   */
  const entradas = secciones.reduce((n, s) => n + s.items.length, 0);
  const convienePlegar = entradas > 10;
  const ningunaActiva = !secciones.some(enSeccion);
  const abiertaDeEntrada = (s: NavSection) =>
    !convienePlegar || enSeccion(s) || (ningunaActiva && s.id === secciones[0]?.id);
  const alternar = (id: string, abiertaAhora: boolean) =>
    setTocadas((c) => ({ ...c, [id]: !abiertaAhora }));

  const link = (item: NavItem) => {
    // "/entregas/resumen" cuelga de "/entregas", así que el padre no debe marcarse activo
    // cuando la que está abierta es la hija: si no, se encenderían las dos.
    const hijaMasEspecifica = SECTIONS.some((s) =>
      s.items.some((i) => i.href !== item.href && i.href.startsWith(`${item.href}/`) && (pathname === i.href || pathname.startsWith(`${i.href}/`))));
    const active = !hijaMasEspecifica && (pathname === item.href || pathname.startsWith(`${item.href}/`));
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] transition-colors",
          active ? "bg-ink-700 text-white" : "text-steel-400 hover:bg-ink-800 hover:text-white",
        )}
      >
        <span className={cn("absolute left-0 top-2 bottom-2 w-1 rounded-r", active ? "bg-brand" : "bg-transparent")} aria-hidden />
        <Icon className={cn("h-[18px] w-[18px]", active && "text-brand")} />
        <span className="flex-1">{item.label}</span>
        <NavPending />
        {item.href === "/inventario" && lowStockCount > 0 && (
          <span className="rounded bg-brand px-1.5 text-xs font-bold text-ink" title="Productos por reponer">{lowStockCount}</span>
        )}
        {item.href === "/devoluciones" && pendingReturns > 0 && (
          <span className="rounded bg-brand px-1.5 text-xs font-bold text-ink" title="Trabajadores cesados con EPP por devolver">{pendingReturns}</span>
        )}
        {item.href === "/detracciones" && pendingDetractions > 0 && (
          <span className="rounded bg-brand px-1.5 text-xs font-bold text-ink" title="Detracciones por depositar">{pendingDetractions}</span>
        )}
        {item.href === "/facturas" && pendingInvoices > 0 && (
          <span className="rounded bg-brand px-1.5 text-xs font-bold text-ink" title="Facturas pendientes de pago">{pendingInvoices}</span>
        )}
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-ink">
      <div className="flex items-start justify-between px-5 pb-5 pt-6">
        <BrandLockup />
        <button className="-mr-1.5 rounded p-1.5 text-steel-400 hover:text-white lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Principal">
        <div className="grid gap-0.5">{link(INICIO)}</div>
        {secciones.map((s) => {
          // Abierta la de la pantalla en la que se está; el resto, plegadas. Si el
          // usuario la alterna a mano, manda lo suyo.
          const abierta = tocadas[s.id] !== undefined ? tocadas[s.id] : abiertaDeEntrada(s);
          return (
            <div key={s.id} className="mt-5">
              <button
                type="button"
                onClick={() => alternar(s.id, abierta)}
                aria-expanded={abierta}
                className="flex w-full items-center gap-1.5 rounded px-3 py-1 text-[13px] font-semibold uppercase tracking-wide text-steel-500 hover:text-steel-300"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !abierta && "-rotate-90")} aria-hidden />
                <span className="flex-1 text-left">{s.label}</span>
                {!abierta && enSeccion(s) && <span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />}
              </button>
              {abierta && <div className="mt-1 grid gap-0.5">{s.items.map(link)}</div>}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-ink-700 p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand font-display text-base font-bold text-ink">
            {user.name.trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{user.name}</p>
            <p className="text-xs text-steel-400">{ROLE_LABELS[user.role]}</p>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="rounded p-2 text-steel-400 hover:bg-ink-700 hover:text-white" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-[fade_120ms_ease-out]">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-ink-700 bg-ink px-4 lg:hidden">
        <button onClick={() => setOpen(true)} className="-ml-1 rounded p-2 text-white" aria-label="Abrir menú">
          <Menu className="h-6 w-6" />
        </button>
        <span className="flex items-center gap-2.5">
          <BrandMark height={26} />
          <span className="font-display text-lg font-bold text-white">Transjer <span className="font-medium text-steel-400">Gestión</span></span>
        </span>
      </header>

      <main className="lg:pl-64">
        <div className="hazard-stripe hidden h-1 lg:block" aria-hidden />
        <div className="mx-auto max-w-[1700px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
