import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatNumber, type SearchParamsRecord } from "@/lib/utils";

function hrefFor(basePath: string, sp: SearchParamsRecord, page: number) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "page" || v === undefined) continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => params.append(k, x));
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function Pagination({ basePath, searchParams, page, pageSize, total }: { basePath: string; searchParams: SearchParamsRecord; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const linkCls = "inline-flex h-9 items-center gap-1 rounded-md border border-steel-300 bg-white px-3 text-sm hover:border-ink";
  const disabledCls = "pointer-events-none opacity-40";
  return (
    <nav className="mt-3 flex flex-col items-center justify-between gap-2 text-sm text-steel-600 sm:flex-row" aria-label="Paginación">
      <p>Mostrando {formatNumber(from)}–{formatNumber(to)} de {formatNumber(total)}</p>
      <div className="flex items-center gap-2">
        <Link href={hrefFor(basePath, searchParams, page - 1)} className={cn(linkCls, page <= 1 && disabledCls)} aria-disabled={page <= 1}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </Link>
        <span className="px-2 tabular-nums">{page} / {pages}</span>
        <Link href={hrefFor(basePath, searchParams, page + 1)} className={cn(linkCls, page >= pages && disabledCls)} aria-disabled={page >= pages}>
          Siguiente <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
    </nav>
  );
}
