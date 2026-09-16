"use client";

import { usePathname, useRouter } from "next/navigation";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

import { PERIODS, type PeriodKey } from "@/lib/periods";

export function PeriodSelect({ value }: { value: PeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <label className="flex items-center gap-2 text-sm text-steel-600">
      Periodo
      <select
        value={value}
        onChange={(e) => router.replace(`${pathname}?period=${e.target.value}`, { scroll: false })}
        className={cn(controlClass, "h-9 w-auto text-sm")}
      >
        {Object.entries(PERIODS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </label>
  );
}
