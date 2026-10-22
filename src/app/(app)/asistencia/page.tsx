import { CalendarCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AttendanceSheet } from "@/components/attendance/attendance-sheet";
import { DateJump } from "@/components/attendance/date-jump";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { first, formatDate, todayLima, type SearchParams } from "@/lib/utils";
import {
  areaOptions, attendanceMonth, listAttendanceDay, readAttendanceFilters,
} from "@/server/attendance-queries";

export const metadata: Metadata = { title: "Asistencia" };

/**
 * Pasar lista.
 *
 * Arriba, el día: quién vino y quién no. Abajo, el acumulado del mes, que es lo que se
 * mira a fin de mes y lo que nadie quiere volver a contar a mano.
 *
 * Solo se registra si se presentó o no. Ni horas, ni tardanzas: eso necesitaría un reloj
 * en la puerta, y lo que hay es una persona con una lista.
 */
export default async function AsistenciaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("attendance.view");
  const sp = await searchParams;
  const puedeMarcar = can(user.role, "attendance.manage");

  const f = readAttendanceFilters(sp);
  const dia = f.day ?? todayLima();
  const mes = first(sp.mes) && /^\d{4}-\d{2}$/.test(first(sp.mes)!) ? first(sp.mes)! : dia.slice(0, 7);

  const [filas, areas, resumen] = await Promise.all([
    listAttendanceDay(f),
    areaOptions(),
    attendanceMonth(mes, { q: f.q, area: f.area }),
  ]);

  const esHoy = dia === todayLima();

  return (
    <>
      <PageHeader
        title="Asistencia"
        description="Quién vino a trabajar cada día. Solo eso: ni horas ni tardanzas."
        actions={<ExportTable tabla="asistencia" label="Descargar" extra={{ dia, mes }} />}
      />

      <DateJump dia={dia} hoy={todayLima()} />

      <FilterBar
        searchPlaceholder="Buscar por nombre o DNI"
        filters={[{
          type: "select", name: "area", label: "Área", allLabel: "Todas",
          options: areas.map((a) => ({ value: a, label: a })),
        }]}
      />

      {filas.length === 0 ? (
        <p className="rounded-lg border border-steel-200 bg-white px-4 py-6 text-center text-sm text-steel-500">
          No hay trabajadores activos con esos filtros.
        </p>
      ) : (
        <AttendanceSheet dia={dia} filas={filas} puedeMarcar={puedeMarcar} />
      )}

      {!esHoy && (
        <p className="mt-3 text-sm text-steel-500">
          Estás viendo el {formatDate(dia)}.{" "}
          <Link href="/asistencia" className="underline">Ir a hoy</Link>
        </p>
      )}

      {/* ---------- El acumulado del mes ---------- */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              Resumen de {formatDate(resumen.desde).slice(3)}
            </h2>
            <p className="text-sm text-steel-500">
              {resumen.diasRegistrados === 0
                ? "Todavía no se pasó lista ningún día de este mes."
                : `Se pasó lista ${resumen.diasRegistrados} día(s) de este mes. Los días sin registrar no cuentan ni como falta ni como asistencia.`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/asistencia?dia=${dia}&mes=${mesAnterior(mes)}`}
              className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink"
            >
              ← Mes anterior
            </Link>
            <Link
              href={`/asistencia?dia=${dia}&mes=${mesSiguiente(mes)}`}
              className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink"
            >
              Mes siguiente →
            </Link>
          </div>
        </div>

        <TableShell>
          <thead>
            <tr>
              <Th>Trabajador</Th>
              <Th className="hidden lg:table-cell">Área</Th>
              <Th className="text-right">Vino</Th>
              <Th className="text-right">Faltó</Th>
              <Th className="text-right">Justificado</Th>
              <Th className="text-right">Días con registro</Th>
            </tr>
          </thead>
          <tbody>
            {resumen.filas.length === 0 && (
              <EmptyRow colSpan={6} title="No hay trabajadores con esos filtros" />
            )}
            {resumen.filas.map((r) => (
              <Tr key={r.employeeId} tone={r.faltas > 0 ? "bg-red-50 hover:bg-red-100/70" : ""}>
                <Td>
                  <Link href={`/trabajadores/${r.employeeId}`} className="font-medium hover:underline">
                    {r.nombre}
                  </Link>
                  <p className="text-xs text-steel-500">DNI {r.dni}</p>
                </Td>
                <Td className="hidden text-sm text-steel-600 lg:table-cell">{r.area}</Td>
                <Td className="text-right tabular font-semibold text-emerald-700">{r.presentes}</Td>
                <Td className={`text-right tabular ${r.faltas > 0 ? "font-semibold text-red-700" : "text-steel-400"}`}>
                  {r.faltas}
                </Td>
                <Td className="text-right tabular text-[#7A5A00]">{r.justificados}</Td>
                <Td className="text-right tabular text-steel-500">{r.registrados}</Td>
              </Tr>
            ))}
          </tbody>
        </TableShell>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-steel-500">
          <CalendarCheck className="h-4 w-4" aria-hidden />
          Un trabajador con cero faltas en un mes donde solo se pasó lista un día no dice lo
          mismo que uno con cero faltas en un mes entero: por eso está la última columna.
        </p>
      </section>
    </>
  );
}

function mesAnterior(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function mesSiguiente(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
