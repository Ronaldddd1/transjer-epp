import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-9 w-9", className)} aria-hidden>
      <rect width="64" height="64" rx="10" fill="#FFC20E" />
      <path d="M14 44 L32 16 L50 44 Z" fill="#000" />
      <rect x="29.5" y="26" width="5" height="10" rx="1" fill="#FFC20E" />
      <rect x="29.5" y="38.5" width="5" height="4" rx="1" fill="#FFC20E" />
    </svg>
  );
}

export function BrandLockup({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark />
      <div className="leading-none">
        <p className={cn("font-display text-[22px] font-bold tracking-wide", inverted ? "text-white" : "text-ink")}>Transjer</p>
        <p className={cn("mt-1 text-[12px] font-medium", inverted ? "text-steel-400" : "text-steel-500")}>Control de EPP</p>
      </div>
    </div>
  );
}
