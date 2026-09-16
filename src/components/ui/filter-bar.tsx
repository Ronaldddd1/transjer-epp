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

/** Filtros sincronizados con la URL: se pueden compartir, recargar y paginar sin perderlos. */
export function FilterBar({ searchPlaceholder, filters = [], className }: { searchPlaceholder?: string; filters?: FilterDef[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const committed = params.toString();

  // Estado deseado de los filtros: se actualiza al instante y es la base de todo cambio
  // encadenado (buscar → filtrar → limpiar → ordenar), aunque la URL aún no se confirme.
  const [desired, setDesired] = useState(committed);
  const desiredRef = useRef(committed);
  const requested = useRef(new Set<string>());
  const [q, setQ] = useState(params.get("q") ?? "");

  // La URL confirmada solo manda si el cambio vino de fuera (enlaces, atrás/adelante).
  useEffect(() => {
    if (committed === desiredRef.current) { requested.current.clear(); return; }
    if (requested.current.has(committed)) return; // paso intermedio de una navegación nuestra
    requested.current.clear();
    desiredRef.current = committed;
    setDesired(committed);
    setQ(new URLSearchParams(committed).get("q") ?? "");
  }, [committed]);

  const navigate = (next: URLSearchParams) => {
    const str = next.toString();
    if (str === desiredRef.current) return;
    desiredRef.current = str;
    requested.current.add(str);
    setDesired(str);
    router.replace(`${pathname}${str ? `?${str}` : ""}`, { scroll: false });
  };

  const update = (entries: Record<string, string>, opts?: { keepPage?: boolean }) => {
    const next = new URLSearchParams(desiredRef.current);
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
      const current = new URLSearchParams(desiredRef.current).get("q") ?? "";
      if (current !== q.trim()) update({ q: q.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Salvaguarda: Next puede descartar una navegación lanzada justo cuando llega la
  // respuesta de la anterior. Si la URL no alcanza el estado deseado, se reintenta.
  useEffect(() => {
    if (desired === committed) return;
    const t = setTimeout(() => {
      if (desiredRef.current === desired) router.replace(`${pathname}${desired ? `?${desired}` : ""}`, { scroll: false });
    }, 1200);
    return () => clearTimeout(t);
  }, [desired, committed, pathname, router]);

  // Con reemplazos muy seguidos, Next puede renderizar la URL nueva pero dejar la barra
  // de direcciones con la anterior; al recargar volverían filtros ya quitados. Se sincroniza.
  useEffect(() => {
    if (desired !== committed) return;
    const t = setTimeout(() => {
      const shown = window.location.search.replace(/^\?/, "");
      if (desiredRef.current === committed && shown !== committed) {
        window.history.replaceState(window.history.state, "", `${pathname}${committed ? `?${committed}` : ""}`);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [desired, committed, pathname]);

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
            const cur = new URLSearchParams(desiredRef.current);
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
