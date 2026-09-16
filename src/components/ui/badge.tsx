import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STOCK_STATUS_LABEL, type StockStatus } from "@/lib/utils";

const tones = {
  neutral: "bg-steel-100 text-steel-600 border-steel-200",
  dark: "bg-ink text-white border-ink",
  yellow: "bg-brand-soft text-[#7A5A00] border-brand/60",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  red: "bg-red-50 text-red-700 border-red-200",
  blue: "bg-sky-50 text-sky-800 border-sky-200",
} as const;
export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<StockStatus, BadgeTone> = { DISPONIBLE: "green", STOCK_BAJO: "yellow", AGOTADO: "red" };
const STATUS_ICON: Record<StockStatus, string> = { DISPONIBLE: "", STOCK_BAJO: "⚠️", AGOTADO: "🔴" };

export function StockBadge({ status }: { status: StockStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      {STATUS_ICON[status] && <span aria-hidden className="text-[11px] leading-none">{STATUS_ICON[status]}</span>}
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function MovementBadge({ type }: { type: "ENTRADA" | "SALIDA" | "AJUSTE" }) {
  const map = { ENTRADA: ["green", "Entrada"], SALIDA: ["dark", "Salida"], AJUSTE: ["blue", "Ajuste"] } as const;
  const [tone, label] = map[type];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge() {
  return <Badge tone="neutral" className="font-medium">Prueba</Badge>;
}
