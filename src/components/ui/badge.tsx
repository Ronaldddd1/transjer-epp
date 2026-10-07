import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  DETRACTION_STATUS_LABEL, dueInfo, EMAIL_STATUS_LABEL, formatDate, INSTALLMENT_STATUS_LABEL, INVOICE_STATUS_LABEL,
  OBLIGATION_STATUS_LABEL, PAYMENT_TERM_LABEL, RETURN_CONDITION_LABEL, STOCK_STATUS_LABEL, todayLima,
  type DueState, type ReturnConditionKey, type StockStatus,
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

/** En qué estado volvió un EPP devuelto. */
export function ReturnConditionBadge({ condition }: { condition: string }) {
  const map: Record<string, BadgeTone> = { REUTILIZABLE: "green", DESCARTADO: "neutral", NO_DEVUELTO: "red" };
  return <Badge tone={map[condition] ?? "neutral"}>{RETURN_CONDITION_LABEL[condition as ReturnConditionKey] ?? condition}</Badge>;
}

/**
 * Estado del trabajador frente al EPP: activo, cesado al día o cesado debiendo.
 * El pendiente manda sobre el cese, porque es lo que alguien tiene que resolver.
 */
export function EmployeeStateBadge({ active, terminatedAt, pendiente = 0 }: {
  active: boolean; terminatedAt: string | null; pendiente?: number;
}) {
  if (terminatedAt && pendiente > 0) return <Badge tone="red">Cesado · debe EPP</Badge>;
  if (terminatedAt) return <Badge tone="neutral">Cesado {formatDate(terminatedAt)}</Badge>;
  return active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>;
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

const DETRACTION_TONE: Record<string, BadgeTone> = {
  NO_APLICA: "neutral",
  PENDIENTE: "yellow",
  EN_PROCESO: "blue",
  PAGADA: "green",
  OBSERVADA: "red",
};

/** Estado del depósito del 4 % en el Banco de la Nación. */
export function DetractionBadge({ status }: { status: string }) {
  return (
    <Badge tone={DETRACTION_TONE[status] ?? "neutral"}>
      {DETRACTION_STATUS_LABEL[status as keyof typeof DETRACTION_STATUS_LABEL] ?? status}
    </Badge>
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

const DUE_TONE: Record<DueState, BadgeTone> = {
  ESPERANDO_GUIA: "blue",
  VENCIDA: "red",
  HOY: "red",
  PRONTO: "yellow",
  PROGRAMADA: "neutral",
};

/**
 * Fecha límite de pago. Una factura a crédito a la que todavía no le entregaron la guía
 * no tiene fecha, porque su plazo aún no empieza a correr, y eso se dice con todas sus letras.
 */
export function DueBadge({ payDueDate, compact = false }: { payDueDate: string | null | undefined; compact?: boolean }) {
  const info = dueInfo(payDueDate);
  return (
    <div className={cn("whitespace-nowrap", compact ? "text-xs" : "text-sm")}>
      <Badge tone={DUE_TONE[info.state]}>{info.label}</Badge>
      {payDueDate && <p className="mt-1 text-xs text-steel-500">{formatDate(payDueDate)}</p>}
    </div>
  );
}

/** Contado o crédito, tal como se pactó con el proveedor. */
export function PaymentTermBadge({ term, termDays }: { term: string; termDays?: number | null }) {
  const label = PAYMENT_TERM_LABEL[term as keyof typeof PAYMENT_TERM_LABEL] ?? term;
  return (
    <Badge tone={term === "CREDITO" ? "blue" : "neutral"}>
      {label}
      {termDays ? ` · ${termDays} d` : ""}
    </Badge>
  );
}

const OBLIGATION_TONE: Record<string, BadgeTone> = { ACTIVA: "green", CERRADA: "neutral", ANULADA: "red" };

export function ObligationStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={OBLIGATION_TONE[status] ?? "neutral"}>
      {OBLIGATION_STATUS_LABEL[status as keyof typeof OBLIGATION_STATUS_LABEL] ?? status}
    </Badge>
  );
}

const INSTALLMENT_TONE: Record<string, BadgeTone> = { PENDIENTE: "yellow", PAGADA: "green", ANULADA: "neutral" };

export function InstallmentStatusBadge({ status, dueDate }: { status: string; dueDate?: string | null }) {
  const vencida = status === "PENDIENTE" && !!dueDate && dueDate < todayLima();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={vencida ? "red" : INSTALLMENT_TONE[status] ?? "neutral"}>
        {INSTALLMENT_STATUS_LABEL[status as keyof typeof INSTALLMENT_STATUS_LABEL] ?? status}
      </Badge>
      {vencida && <Badge tone="red">Vencida</Badge>}
    </span>
  );
}
