import Link from "next/link";
import { cn } from "@/lib/utils";
import type { cuadroEpp } from "@/server/queries";

/**
 * El cuadro tipo Excel del Resumen de EPP: un trabajador por fila, un EPP por columna, y en
 * cada casilla cuántos tiene hoy en su poder.
 *
 * La primera columna y la cabecera quedan fijas al desplazarse: con veinte EPP el cuadro
 * es más ancho que la pantalla, y perder de vista de quién es la fila lo vuelve inútil.
 * Las casillas en cero van con un punto tenue, para que lo que sí tiene resalte.
 */
export function CuadroEpp({ datos }: { datos: Awaited<ReturnType<typeof cuadroEpp>> }) {
  const { productos, filas, totales, total } = datos;

  if (productos.length === 0) {
    return (
      <p className="rounded-lg border border-steel-200 bg-white px-4 py-8 text-center text-sm text-steel-500">
        Nadie tiene EPP en su poder con esos filtros: no hay entregas pendientes de devolver.
      </p>
    );
  }

  // Las categorías encabezan grupos de columnas, como en una hoja de cálculo.
  const grupos: { categoria: string; cuantos: number }[] = [];
  for (const p of productos) {
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.categoria === p.categoria) ultimo.cuantos++;
    else grupos.push({ categoria: p.categoria, cuantos: 1 });
  }

  const celda = "border-b border-r border-steel-200 px-2 py-1.5";
  const fija = "sticky left-0 z-10 bg-white";

  return (
    <div className="max-h-[75vh] overflow-auto rounded-lg border border-steel-200 bg-white" data-cuadro-epp>
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          <tr className="bg-steel-100 text-xs uppercase tracking-wide text-steel-500">
            <th className={cn(celda, fija, "z-30 bg-steel-100 text-left")} rowSpan={2}>Trabajador</th>
            {grupos.map((g) => (
              <th key={g.categoria} colSpan={g.cuantos} className={cn(celda, "bg-steel-100 text-center font-semibold")}>
                {g.categoria}
              </th>
            ))}
            <th className={cn(celda, "bg-steel-100 text-right")} rowSpan={2}>Total</th>
          </tr>
          <tr className="bg-steel-50">
            {productos.map((p) => (
              <th
                key={p.id}
                title={`${p.code} · ${p.name}${p.size ? ` · talla ${p.size}` : ""}`}
                className={cn(celda, "min-w-[5.5rem] max-w-[8rem] bg-steel-50 text-center align-bottom text-xs font-semibold text-ink")}
              >
                <span className="line-clamp-2">{p.name}</span>
                {p.size && <span className="block font-normal text-steel-500">talla {p.size}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((r) => (
            <tr key={r.id} className={cn("hover:bg-steel-50", r.total === 0 && "text-steel-400")}>
              <td className={cn(celda, fija, "whitespace-nowrap")}>
                <Link href={`/trabajadores/${r.id}`} className="font-medium text-ink hover:underline">{r.nombre}</Link>
                <span className="block text-xs text-steel-500">
                  {r.area}
                  {r.cesado && <span className="ml-1.5 font-semibold text-red-700">· cesado</span>}
                </span>
              </td>
              {productos.map((p) => {
                const n = r.cantidades[p.id];
                return (
                  <td key={p.id} className={cn(celda, "text-center tabular")}>
                    {n > 0 ? <span className="font-semibold text-ink">{n}</span> : <span className="text-steel-300">·</span>}
                  </td>
                );
              })}
              <td className={cn(celda, "text-right tabular font-semibold", r.total > 0 ? "text-ink" : "text-steel-300")}>
                {r.total}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20">
          <tr className="bg-ink text-white">
            <td className={cn(celda, "sticky left-0 z-30 bg-ink font-semibold")}>Total en poder</td>
            {productos.map((p) => (
              <td key={p.id} className={cn(celda, "bg-ink text-center tabular font-semibold")}>{totales[p.id]}</td>
            ))}
            <td className={cn(celda, "bg-ink text-right tabular font-bold text-brand")}>{total}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
