import { cn, stockStatus } from "@/lib/utils";

/**
 * Barra de nivel: la marca vertical es el stock mínimo.
 * La escala llega hasta 2× el mínimo para que el umbral quede siempre a la mitad.
 */
export function StockMeter({ stock, minimum, className }: { stock: number; minimum: number; className?: string }) {
  const status = stockStatus(stock, minimum);
  const scale = Math.max(minimum * 2, 1);
  const pct = Math.min(100, (stock / scale) * 100);
  const color = status === "AGOTADO" ? "bg-red-500" : status === "STOCK_BAJO" ? "bg-brand" : "bg-ink";
  return (
    <div className={cn("relative h-1.5 w-24 rounded-full bg-steel-200", className)} role="img" aria-label={`Stock ${stock} de mínimo ${minimum}`}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      {minimum > 0 && <div className="absolute -top-1 left-1/2 h-3.5 w-px bg-steel-500" aria-hidden />}
    </div>
  );
}
