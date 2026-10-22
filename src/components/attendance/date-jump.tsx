"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { DateInput } from "@/components/ui/date-field";
import { addDays, formatDate } from "@/lib/utils";

/**
 * El día que se está pasando.
 *
 * Con flechas y no solo con un calendario porque lo normal es corregir el día anterior:
 * "ayer no marqué a nadie". Dos clics, no cinco.
 */
export function DateJump({ dia, hoy }: { dia: string; hoy: string }) {
  const router = useRouter();
  const sp = useSearchParams();

  const ir = (nuevo: string) => {
    const p = new URLSearchParams(sp?.toString() ?? "");
    p.set("dia", nuevo);
    // El resumen sigue al día: si se salta a otro mes, se mira ese mes.
    p.set("mes", nuevo.slice(0, 7));
    router.replace(`/asistencia?${p.toString()}`, { scroll: false });
  };

  const siguiente = addDays(dia, 1);
  const haySiguiente = siguiente <= hoy;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => ir(addDays(dia, -1))}
        className="inline-flex h-10 items-center gap-1 rounded-md border border-steel-300 bg-white px-3 text-sm text-steel-600 hover:border-ink hover:text-ink"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden /> Día anterior
      </button>

      <div className="w-44">
        <DateInput
          name="dia"
          value={dia}
          max={hoy}
          onChange={(iso) => { if (iso) ir(iso); }}
        />
      </div>

      <button
        type="button"
        onClick={() => haySiguiente && ir(siguiente)}
        disabled={!haySiguiente}
        className="inline-flex h-10 items-center gap-1 rounded-md border border-steel-300 bg-white px-3 text-sm text-steel-600 hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        title={haySiguiente ? "Día siguiente" : "No se puede pasar lista de un día que no llegó"}
      >
        Día siguiente <ChevronRight className="h-4 w-4" aria-hidden />
      </button>

      {dia !== hoy && (
        <button
          type="button"
          onClick={() => ir(hoy)}
          className="h-10 rounded-md px-3 text-sm text-steel-600 underline hover:text-ink"
        >
          Volver a hoy
        </button>
      )}

      <span className="ml-auto text-sm text-steel-500">
        Pasando lista del <strong className="text-ink">{formatDate(dia)}</strong>
      </span>
    </div>
  );
}
