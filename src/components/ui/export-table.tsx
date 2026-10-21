"use client";

import { ChevronDown, FileArchive, FileDown, FileSpreadsheet, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Botón para bajarse la tabla que se está viendo.
 *
 * Arrastra los filtros de la propia pantalla, así que el archivo trae exactamente las filas
 * que hay delante y no la tabla entera. Excel es lo primero porque es lo que la gente usa
 * para seguir trabajando con los datos; CSV y PDF quedan a un clic más.
 */
export function ExportTable({ tabla, extra, label = "Exportar", className, enlaces = [] }: {
  /** Clave de la tabla en el registro del servidor. */
  tabla: string;
  /** Parámetros propios de la pantalla, como el id de una obligación. */
  extra?: Record<string, string>;
  label?: string;
  className?: string;
  /**
   * Otras descargas de la misma pantalla, dentro del mismo menú.
   *
   * Van aquí y no como botones sueltos: una barra con cinco botones de descarga obliga a
   * leerlos todos para encontrar el que se busca.
   */
  enlaces?: { href: string; label: string; detalle?: string }[];
}) {
  const sp = useSearchParams();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  const href = (format: string) => {
    const p = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    p.set("tabla", tabla);
    p.set("format", format);
    // La paginación no viaja: el archivo trae todas las filas que pasan los filtros.
    p.delete("page");
    return `/api/export/tabla?${p.toString()}`;
  };

  const item = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[15px] text-ink-800 hover:bg-steel-50";

  return (
    <div className={cn("relative", className)} ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="inline-flex h-10 items-center gap-2 rounded-md border border-steel-300 bg-white px-4 text-[15px] text-ink transition-colors hover:border-ink"
      >
        <FileSpreadsheet className="h-4 w-4 text-steel-500" aria-hidden />
        {label}
        <ChevronDown className={cn("h-4 w-4 text-steel-400 transition-transform", abierto && "rotate-180")} aria-hidden />
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-md border border-steel-200 bg-white py-1 shadow-lg"
        >
          <a href={href("xlsx")} className={item} role="menuitem" onClick={() => setAbierto(false)} download>
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
            <span className="flex-1">Excel
              <span className="block text-xs text-steel-500">.xlsx, para seguir trabajando</span>
            </span>
          </a>
          <a href={href("csv")} className={item} role="menuitem" onClick={() => setAbierto(false)} download>
            <FileDown className="h-4 w-4 text-steel-500" aria-hidden />
            <span className="flex-1">CSV
              <span className="block text-xs text-steel-500">texto simple, para otros programas</span>
            </span>
          </a>
          <a href={href("pdf")} className={item} role="menuitem" onClick={() => setAbierto(false)} download>
            <FileText className="h-4 w-4 text-red-700" aria-hidden />
            <span className="flex-1">PDF
              <span className="block text-xs text-steel-500">para imprimir o enviar</span>
            </span>
          </a>

          {enlaces.length > 0 && <div className="my-1 border-t border-steel-200" aria-hidden />}
          {enlaces.map((e) => (
            <a key={e.href} href={e.href} className={item} role="menuitem" onClick={() => setAbierto(false)} download>
              <FileArchive className="h-4 w-4 text-brand-dark" aria-hidden />
              <span className="flex-1">{e.label}
                {e.detalle && <span className="block text-xs text-steel-500">{e.detalle}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
