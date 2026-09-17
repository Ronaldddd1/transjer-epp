"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { registerQueryHandler } from "@/lib/query-nav";
import { cn } from "@/lib/utils";
import { controlClass } from "./field";

export type FilterDef =
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  | { type: "date"; name: string; label: string };

/**
 * Estado de navegación de la barra. Vive fuera del componente para que sobreviva si Next
 * vuelve a montar la página durante una navegación; así no se pierden cambios en curso.
 *
 * Regla clave: una sola navegación a la vez (`inFlight`), para que se confirmen en orden.
 * No usar history.replaceState aquí: Next 15 lo intercepta y deja navegaciones sin aplicar.
 * Tampoco hay `loading.tsx` en (app): con cambios de parámetros en la misma página, ese
 * límite de carga dejaba transiciones suspendidas y los filtros dejaban de responder.
 */
const nav = { path: "", desired: "", inFlight: null as string | null, sentAt: 0, retries: 0 };

/** Filtros sincronizados con la URL: se pueden compartir, recargar y paginar sin perderlos. */
export function FilterBar({ searchPlaceholder, filters = [], className }: { searchPlaceholder?: string; filters?: FilterDef[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const committed = params.toString();

  // Estado deseado de los filtros (ver `nav`): se actualiza al instante y es la base de todo
  // cambio encadenado (buscar → filtrar → limpiar → ordenar), aunque la URL aún no se confirme.
  // Al montar: si hay una navegación nuestra en curso en esta misma página, se conserva lo
  // pedido; si no, manda la URL (primera visita, otra página, enlaces del menú).
  const [desired, setDesired] = useState(() => {
    if (nav.path !== pathname || nav.inFlight === null) {
      Object.assign(nav, { path: pathname, desired: committed, inFlight: null, retries: 0 });
    }
    return nav.desired;
  });
  const [q, setQ] = useState(() => new URLSearchParams(nav.desired).get("q") ?? "");

  const send = (str: string, retry = false) => {
    nav.retries = retry ? nav.retries + 1 : 0;
    nav.inFlight = str;
    nav.sentAt = Date.now();
    router.replace(`${pathname}${str ? `?${str}` : ""}`, { scroll: false });
  };

  useEffect(() => {
    if (nav.inFlight !== null) {
      if (committed !== nav.inFlight) return; // aún no llega la navegación en curso
      nav.inFlight = null;
      if (nav.desired !== committed) send(nav.desired); // hubo cambios mientras tanto
      return;
    }
    // Sin navegación propia en curso: el cambio vino de fuera (paginación, atrás/adelante).
    if (committed !== nav.desired) {
      nav.desired = committed;
      setDesired(committed);
      setQ(new URLSearchParams(committed).get("q") ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed]);

  const navigate = (next: URLSearchParams) => {
    const str = next.toString();
    if (str === nav.desired) return;
    nav.desired = str;
    setDesired(str);
    if (nav.inFlight === null) send(str);
  };

  const update = (entries: Record<string, string>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(nav.desired);
    for (const [k, v] of Object.entries(entries)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!opts?.keepPage) next.delete("page");
    navigate(next);
  };
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => registerQueryHandler((e, o) => updateRef.current(e, o)), []);

  useEffect(() => {
    if (searchPlaceholder === undefined) return;
    const t = setTimeout(() => {
      const current = new URLSearchParams(nav.desired).get("q") ?? "";
      if (current !== q.trim()) update({ q: q.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Salvaguarda: si una navegación no se confirma (p. ej. se cortó la red), se reenvía el
  // estado deseado vigente.
  useEffect(() => {
    const id = setInterval(() => {
      if (nav.inFlight === null || Date.now() - nav.sentAt < 8000) return;
      if (nav.retries < 2) send(nav.desired, true);
      else nav.inFlight = null; // se deja de insistir; la URL visible pasa a mandar
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const values = new URLSearchParams(desired);
  // Hay una navegación en curso mientras la URL confirmada no alcance a la deseada.
  const pending = desired !== committed;
  const activeCount = filters.filter((f) => values.get(f.name)).length + (values.get("q") || q ? 1 : 0);

  return (
    <div className={cn("mb-4 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-end", pending && "opacity-70", className)}>
      {searchPlaceholder !== undefined && (
        <div className="relative lg:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Buscar"
            className={cn(controlClass, "h-10 pl-9")}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        {filters.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-steel-500">
            {f.label}
            {f.type === "select" ? (
              <select
                value={values.get(f.name) ?? ""}
                onChange={(e) => update({ [f.name]: e.target.value })}
                className={cn(controlClass, "h-10 min-w-[9rem] text-sm")}
              >
                <option value="">{f.allLabel ?? "Todos"}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type="date"
                value={values.get(f.name) ?? ""}
                onChange={(e) => update({ [f.name]: e.target.value })}
                className={cn(controlClass, "h-10 text-sm")}
              />
            )}
          </label>
        ))}
      </div>
      {activeCount > 0 && (
        <button
          onClick={() => {
            setQ("");
            const keep = new URLSearchParams();
            const cur = new URLSearchParams(nav.desired);
            for (const k of ["sort", "dir"]) { const v = cur.get(k); if (v) keep.set(k, v); }
            navigate(keep);
          }}
          className="inline-flex h-10 items-center gap-1 self-start rounded-md px-2 text-sm text-steel-600 hover:text-ink lg:self-end"
        >
          <X className="h-4 w-4" /> Limpiar filtros
        </button>
      )}
    </div>
  );
}
