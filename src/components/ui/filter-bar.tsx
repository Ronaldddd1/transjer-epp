"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { registerQueryHandler } from "@/lib/query-nav";
import { cn } from "@/lib/utils";
import { DateInput } from "./date-field";
import { controlClass } from "./field";

export type FilterDef =
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[]; allLabel?: string }
  /**
   * Una lista larga (los proveedores) que se busca escribiendo: por nombre o por lo que
   * diga `hint` (el RUC). Elegir una opción filtra igual que el select.
   */
  | { type: "search"; name: string; label: string; options: { value: string; label: string; hint?: string }[]; placeholder?: string }
  | { type: "date"; name: string; label: string };

const sinTildes = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** El buscador de una opción: escribe, aparecen las que coinciden, elige una. */
function ComboFiltro({ def, value, onChange }: {
  def: Extract<FilterDef, { type: "search" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const elegida = def.options.find((o) => o.value === value);
  const [texto, setTexto] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const listaId = `combo-${def.name}`;
  const buscado = sinTildes(texto.trim());
  const coinciden = buscado
    ? def.options.filter((o) => sinTildes(`${o.label} ${o.hint ?? ""}`).includes(buscado)).slice(0, 12)
    : def.options.slice(0, 12);

  const elegir = (v: string) => {
    onChange(v);
    setTexto("");
    setAbierto(false);
  };

  return (
    <div className="relative min-w-[16rem]">
      <input
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={listaId}
        aria-autocomplete="list"
        aria-label={def.label}
        value={abierto ? texto : elegida?.label ?? ""}
        placeholder={def.placeholder ?? "Escribe para buscar"}
        onFocus={() => { setAbierto(true); setTexto(""); setActivo(0); }}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActivo((i) => Math.min(i + 1, coinciden.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && coinciden[activo]) { e.preventDefault(); elegir(coinciden[activo].value); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setAbierto(false); (e.target as HTMLInputElement).blur(); }
        }}
        className={cn(controlClass, "h-10 pr-8 text-sm", elegida && !abierto && "font-medium text-ink")}
      />
      {elegida && !abierto && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Quitar ${def.label.toLowerCase()}`}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-steel-400 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {abierto && (
        <ul
          id={listaId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-steel-200 bg-white py-1 text-sm shadow-lg"
        >
          {coinciden.length === 0 && <li className="px-3 py-2 text-steel-500">Ninguno coincide con «{texto}»</li>}
          {coinciden.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === activo}
              onMouseDown={(e) => { e.preventDefault(); elegir(o.value); }}
              onMouseEnter={() => setActivo(i)}
              className={cn("cursor-pointer px-3 py-1.5", i === activo && "bg-steel-100")}
            >
              <span className="block font-medium text-ink">{o.label}</span>
              {o.hint && <span className="block text-xs text-steel-500">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
            {f.type === "search" ? (
              <ComboFiltro def={f} value={values.get(f.name) ?? ""} onChange={(v) => update({ [f.name]: v })} />
            ) : f.type === "select" ? (
              <select
                value={values.get(f.name) ?? ""}
                onChange={(e) => update({ [f.name]: e.target.value })}
                className={cn(controlClass, "h-10 min-w-[9rem] text-sm")}
              >
                <option value="">{f.allLabel ?? "Todos"}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <DateInput
                name={f.name}
                value={values.get(f.name) ?? ""}
                onChange={(v) => update({ [f.name]: v ?? "" })}
                className="min-w-[10rem]"
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
            // El orden y la vista elegida (cuadro o periodo, día o semana) no son filtros: se quedan.
            for (const k of ["sort", "dir", "vista"]) { const v = cur.get(k); if (v) keep.set(k, v); }
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
