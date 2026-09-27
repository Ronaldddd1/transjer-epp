import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  EMAIL_STATUS_LABEL, formatDate, fridaysBetween, INVOICE_STATUS_LABEL, nextFriday,
  STOCK_STATUS_LABEL, todayLima, type StockStatus,
} from "@/lib/utils";

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

/** Marca de entrega anulada con quién, cuándo y por qué. */
export function VoidedNote({ voidedAt, voidedByName, voidReason }: { voidedAt: Date | string; voidedByName: string | null; voidReason: string | null }) {
  return (
    <div className="mt-1 max-w-[18rem] text-xs text-red-700">
      <Badge tone="red">Anulada</Badge>
      <p className="mt-1 whitespace-normal">
        {formatDate(voidedAt)}{voidedByName ? ` · ${voidedByName}` : ""}{voidReason ? ` — ${voidReason}` : ""}
      </p>
    </div>
  );
}

const INVOICE_TONE: Record<string, BadgeTone> = {
  PENDIENTE: "yellow",
  PAGADA: "green",
  OBSERVADA: "red",
  ANULADA: "neutral",
};

export function InvoiceStatusBadge({ status, dueDate }: { status: string; dueDate?: string | null }) {
  const overdue = status === "PENDIENTE" && !!dueDate && dueDate < todayLima();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={INVOICE_TONE[status] ?? "neutral"}>
        {INVOICE_STATUS_LABEL[status as keyof typeof INVOICE_STATUS_LABEL] ?? status}
      </Badge>
      {overdue && <Badge tone="red">Vencida</Badge>}
    </span>
  );
}

const EMAIL_TONE: Record<string, BadgeTone> = {
  PROCESADO: "green",
  REVISAR: "yellow",
  DESCARTADO: "neutral",
  ERROR: "red",
};

export function EmailStatusBadge({ status }: { status: string }) {
  return <Badge tone={EMAIL_TONE[status] ?? "neutral"}>{EMAIL_STATUS_LABEL[status as keyof typeof EMAIL_STATUS_LABEL] ?? status}</Badge>;
}

/**
 * Viernes en que se pagará la factura. Si su viernes pasó sin pagarse, avisa de la
 * reprogramación y de cuántas semanas lleva corriéndose.
 */
export function PaymentFridayBadge({ scheduled, effective, compact = false }: {
  scheduled: string; effective: string; compact?: boolean;
}) {
  const hoy = todayLima();
  const esTanda = effective === nextFriday(hoy);
  const corrida = effective !== scheduled;
  const semanas = corrida ? fridaysBetween(scheduled, effective) : 0;

  return (
    <div className={cn("whitespace-nowrap", compact ? "text-xs" : "text-sm")}>
      <Badge tone={corrida ? "red" : esTanda ? "yellow" : "neutral"}>
        {esTanda ? "Se paga este viernes" : `Viernes ${formatDate(effective)}`}
      </Badge>
      {corrida && (
        <p className="mt-1 text-xs text-red-700">
          Reprogramada {semanas} semana{semanas === 1 ? "" : "s"}: le tocaba el {formatDate(scheduled)}
        </p>
      )}
    </div>
  );
}
