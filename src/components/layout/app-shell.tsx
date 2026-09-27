"use client";

import {
  ArrowLeftRight, BarChart3, Building2, ClipboardList, HardHat, LayoutDashboard, LogOut, Menu, PackageSearch, Receipt, ShieldCheck, Tags, Users, X,
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

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inventario", label: "Inventario", icon: PackageSearch, permission: "products.view" },
  { href: "/movimientos", label: "Movimientos", icon: ArrowLeftRight, permission: "movements.view" },
  { href: "/entregas", label: "Entregas", icon: HardHat, permission: "deliveries.view" },
  { href: "/trabajadores", label: "Trabajadores", icon: Users, permission: "employees.view" },
  { href: "/facturas", label: "Facturas", icon: Receipt, permission: "invoices.view" },
  { href: "/reportes", label: "Reportes", icon: BarChart3, permission: "reports.view" },
];
const SETTINGS_NAV: NavItem[] = [
  { href: "/proveedores", label: "Proveedores", icon: Building2, permission: "suppliers.manage" },
  { href: "/categorias", label: "Categorías", icon: Tags, permission: "categories.manage" },
  { href: "/usuarios", label: "Usuarios", icon: ShieldCheck, permission: "users.manage" },
  { href: "/auditoria", label: "Auditoría", icon: ClipboardList, permission: "audit.view" },
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

export function AppShell({ user, lowStockCount, pendingInvoices = 0, children }: { user: { name: string; role: Role }; lowStockCount: number; pendingInvoices?: number; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const visible = (items: NavItem[]) => items.filter((i) => !i.permission || can(user.role, i.permission));
  const settings = visible(SETTINGS_NAV);

  const link = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
        <div className="grid gap-0.5">{visible(MAIN_NAV).map(link)}</div>
        {settings.length > 0 && (
          <>
            <p className="mb-1.5 mt-6 px-3 text-[13px] font-medium text-steel-500">Configuración</p>
            <div className="grid gap-0.5">{settings.map(link)}</div>
          </>
        )}
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
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
