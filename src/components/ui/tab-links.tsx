import Link from "next/link";
import { cn, type SearchParamsRecord } from "@/lib/utils";

/**
 * Pestañas que filtran sin perder lo demás.
 *
 * Son enlaces, no botones: conservan el resto de los filtros y la búsqueda, y al volver
 * atrás con el navegador se vuelve a la pestaña anterior. Cambiar de pestaña siempre
 * devuelve a la primera página, porque la página 3 de "pendientes" no tiene nada que ver
 * con la página 3 de "pagadas".
 */
export type Tab = { value: string; label: string; count?: number };

export function TabLinks({ name, tabs, current, base, params, className }: {
  /** El parámetro de la dirección que cambia cada pestaña, p. ej. "estado". */
  name: string;
  tabs: Tab[];
  /** Cuál está activa. Cadena vacía para la de "todas". */
  current: string;
  base: string;
  params: SearchParamsRecord;
  className?: string;
}) {
  const href = (value: string) => {
    const query = new URLSearchParams();
    for (const [clave, valor] of Object.entries(params)) {
      if (clave === name || clave === "page") continue;
      const texto = Array.isArray(valor) ? valor[0] : valor;
      if (texto) query.set(clave, texto);
    }
    // La pestaña de "todas" también escribe su parámetro, vacío. Si se omitiera, la
    // dirección quedaría igual que al entrar sin elegir nada y la pantalla volvería a
    // aplicar su filtro por defecto: el botón parecería no funcionar.
    query.set(name, value);
    const cadena = query.toString();
    return cadena ? `${base}?${cadena}` : base;
  };

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="tablist">
      {tabs.map((t) => {
        const activa = current === t.value;
        return (
          <Link
            key={t.value || "todas"}
            href={href(t.value)}
            role="tab"
            aria-selected={activa}
            className={cn(
              "rounded-md border px-3.5 py-2 text-sm font-medium transition-colors",
              activa
                ? "border-ink bg-ink text-white"
                : "border-steel-200 bg-white text-steel-600 hover:border-steel-400 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("ml-2 tabular", activa ? "text-brand" : "text-steel-400")}>{t.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
