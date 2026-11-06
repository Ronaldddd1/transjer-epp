import Link from "next/link";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import type { attendanceWeek, DiaSemana } from "@/server/attendance-queries";

/**
 * La semana de lunes a sábado, completa: una fila por trabajador y una columna por día.
 *
 * Es la vista que se pide para cerrar la semana: de un vistazo, quién faltó qué día y qué
 * días quedaron sin marcar. Lo que hizo cada uno se lee debajo de su marca, recortado; el
 * texto entero sale al pasar el mouse.
 */

const NOMBRE_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function Marca({ dia, hayLista, futuro }: { dia: DiaSemana | undefined; hayLista: boolean; futuro: boolean }) {
  if (!dia) {
    if (futuro) return <span className="text-xs text-steel-300">·</span>;
    // Si ese día se pasó lista a otros, a este se le olvidó marcar; si no, no hubo lista.
    return hayLista
      ? <span className="text-xs font-medium text-amber-700">sin marcar</span>
      : <span className="text-steel-300">—</span>;
  }

  const detalle = dia.status === "PRESENTE" ? dia.activity : dia.reason;
  const chip = {
    PRESENTE: { texto: "Vino", clase: "bg-emerald-100 text-emerald-800" },
    FALTA: { texto: "Faltó", clase: "bg-red-100 text-red-800" },
    JUSTIFICADO: { texto: "Justificado", clase: "bg-brand-soft text-[#7A5A00]" },
  }[dia.status];

  return (
    <span className="block" title={detalle ?? undefined}>
      <span className={cn("inline-block rounded px-1.5 py-0.5 text-xs font-semibold", chip.clase)}>{chip.texto}</span>
      {detalle && <span className="mx-auto mt-0.5 block max-w-[7.5rem] truncate text-[11px] text-steel-500">{detalle}</span>}
    </span>
  );
}

export function AttendanceWeek({ semana, hoy, anterior, siguiente, actual }: {
  semana: Awaited<ReturnType<typeof attendanceWeek>>;
  hoy: string;
  /** Enlaces para moverse de semana, con los filtros ya puestos. */
  anterior: string;
  siguiente: string;
  /** Enlace a la semana en curso; null si ya se está en ella. */
  actual: string | null;
}) {
  const { dias, filas, conLista } = semana;

  return (
    <section className="mt-8" aria-labelledby="titulo-semana">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titulo-semana" className="font-display text-lg font-semibold text-ink">
            Semana del {formatDate(semana.lunes)} al {formatDate(semana.sabado)}
          </h2>
          <p className="text-sm text-steel-500">
            De lunes a sábado. &ldquo;Sin marcar&rdquo; es un día en que se pasó lista y a esa
            persona no se la anotó.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={anterior} className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink">
            ← Semana anterior
          </Link>
          {actual && (
            <Link href={actual} className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink">
              Esta semana
            </Link>
          )}
          <Link href={siguiente} className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink">
            Semana siguiente →
          </Link>
        </div>
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Trabajador</Th>
            {dias.map((d, i) => (
              <Th key={d} className={cn("text-center", d === hoy && "bg-brand-soft")}>
                <span className="block">{NOMBRE_DIA[i]}</span>
                <span className="block text-xs font-normal normal-case text-steel-500">{formatDate(d).slice(0, 5)}</span>
              </Th>
            ))}
            <Th className="text-right">Vino</Th>
            <Th className="text-right">Faltó</Th>
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && <EmptyRow colSpan={9} title="No hay trabajadores con esos filtros" />}
          {filas.map((r) => (
            <Tr key={r.employeeId} tone={r.faltas > 0 ? "bg-red-50 hover:bg-red-100/70" : ""}>
              <Td className="whitespace-nowrap">
                <Link href={`/trabajadores/${r.employeeId}`} className="font-medium hover:underline">{r.nombre}</Link>
                <p className="text-xs text-steel-500">{r.area}</p>
              </Td>
              {dias.map((d) => (
                <Td key={d} className={cn("text-center align-top", d === hoy && "bg-brand-soft/50")}>
                  <Marca dia={r.semana[d]} hayLista={conLista.has(d)} futuro={d > hoy} />
                </Td>
              ))}
              <Td className="text-right tabular font-semibold text-emerald-700">{r.presentes}</Td>
              <Td className={cn("text-right tabular", r.faltas > 0 ? "font-semibold text-red-700" : "text-steel-400")}>{r.faltas}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </section>
  );
}
