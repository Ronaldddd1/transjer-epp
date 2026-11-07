import { CalendarCheck, CalendarRange, ClipboardCheck } from "lucide-react";
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
import { addDays, first, formatDate, todayLima, weekdayOf, type SearchParams } from "@/lib/utils";
import { AttendanceWeek } from "@/components/attendance/attendance-week";
import {
  areaOptions, attendanceMonth, attendanceWeek, listAttendanceDay, lunesDe, readAttendanceFilters,
} from "@/server/attendance-queries";

export const metadata: Metadata = { title: "Asistencia" };

/** weekdayOf: 0 es domingo. */
const DIA_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Pasar lista, dentro de Recursos Humanos.
 *
 * Dos botones arriba, uno por cada trabajo: registrar la asistencia del día, donde se marca
 * quién vino y qué hizo, y el cuadro de lunes a domingo, para ver y descargar la semana.
 * El acumulado del mes va plegado debajo del cuadro: se mira a fin de mes, no todos los días.
 *
 * Solo se registra si se presentó o no. Ni horas, ni tardanzas: eso necesitaría un reloj
 * en la puerta, y lo que hay es una persona con una lista.
 */
export default async function AsistenciaPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("attendance.view");
  const sp = await searchParams;
  const puedeMarcar = can(user, "attendance.manage");

  const f = readAttendanceFilters(sp);
  const vista: "dia" | "semana" = first(sp.vista) === "semana" ? "semana" : "dia";
  const dia = f.day ?? todayLima();
  const mes = first(sp.mes) && /^\d{4}-\d{2}$/.test(first(sp.mes)!) ? first(sp.mes)! : dia.slice(0, 7);

  // La semana que se mira: la que se pidió, o la del día elegido arriba.
  const pedida = first(sp.semana);
  const lunes = lunesDe(pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : dia);

  // Solo se consulta lo de la vista abierta.
  const [filas, areas, resumen, semana] = await Promise.all([
    vista === "dia" ? listAttendanceDay(f) : Promise.resolve([]),
    areaOptions(),
    vista === "semana" ? attendanceMonth(mes, { q: f.q, area: f.area }) : Promise.resolve(null),
    vista === "semana" ? attendanceWeek(lunes, { q: f.q, area: f.area }) : Promise.resolve(null),
  ]);

  const esHoy = dia === todayLima();

  /** Un enlace a otra semana que conserva el día, el mes y los filtros. */
  const aSemana = (l: string) => {
    const p = new URLSearchParams();
    if (f.day) p.set("dia", f.day);
    if (first(sp.mes)) p.set("mes", mes);
    if (f.q) p.set("q", f.q);
    if (f.area) p.set("area", f.area);
    p.set("vista", "semana");
    p.set("semana", l);
    return `/asistencia?${p.toString()}#titulo-semana`;
  };
  const lunesDeHoy = lunesDe(todayLima());

  /** Los dos botones de arriba. Conservan la búsqueda y el área elegidas. */
  const aVista = (v: "dia" | "semana") => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.area) p.set("area", f.area);
    if (v === "semana") {
      p.set("vista", "semana");
      if (pedida) p.set("semana", lunes);
    } else if (f.day) {
      p.set("dia", f.day);
    }
    const qs = p.toString();
    return qs ? `/asistencia?${qs}` : "/asistencia";
  };

  return (
    <>
      <PageHeader
        title="Asistencia"
        description="Quién vino a trabajar cada día. Solo eso: ni horas ni tardanzas."
      />

      <nav aria-label="Vistas de asistencia" className="mb-5 grid gap-3 sm:grid-cols-2">
        {([
          { v: "dia", titulo: "Registrar asistencia del día", texto: "Marcar quién vino y qué hizo.", icono: ClipboardCheck },
          { v: "semana", titulo: "Cuadro de lunes a domingo", texto: "Ver y descargar la semana completa.", icono: CalendarRange },
        ] as const).map(({ v, titulo, texto, icono: Icono }) => (
          <Link
            key={v}
            href={aVista(v)}
            aria-current={vista === v ? "page" : undefined}
            className={vista === v
              ? "flex items-center gap-3 rounded-lg border-2 border-ink bg-ink px-4 py-3 text-white"
              : "flex items-center gap-3 rounded-lg border-2 border-steel-200 bg-white px-4 py-3 text-ink hover:border-ink"}
          >
            <Icono className={vista === v ? "h-6 w-6 text-brand" : "h-6 w-6 text-steel-500"} aria-hidden />
            <span>
              <span className="block font-display text-base font-semibold">{titulo}</span>
              <span className={vista === v ? "block text-sm text-steel-300" : "block text-sm text-steel-500"}>{texto}</span>
            </span>
          </Link>
        ))}
      </nav>

      <FilterBar
        searchPlaceholder="Buscar por nombre o DNI"
        filters={[{
          type: "select", name: "area", label: "Área", allLabel: "Todas",
          options: areas.map((a) => ({ value: a, label: a })),
        }]}
      />

      {/* ---------- Registrar asistencia del día ---------- */}
      {vista === "dia" && (
      <section aria-labelledby="titulo-dia" className="min-w-0 rounded-lg border border-steel-200 bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-steel-200 px-4 py-3">
          <div>
            <h2 id="titulo-dia" className="font-display text-lg font-semibold text-ink">Registro diario</h2>
            <p className="text-sm text-steel-500">
              {esHoy ? "Hoy" : DIA_SEMANA[weekdayOf(dia)]}, {formatDate(dia)}.
              {!esHoy && <> <Link href="/asistencia" className="underline">Ir a hoy</Link></>}
            </p>
          </div>
          <ExportTable tabla="asistencia" label="Descargar día" extra={{ dia, mes }} />
        </header>
        <div className="p-4">
          <DateJump dia={dia} hoy={todayLima()} />
          {filas.length === 0 ? (
            <p className="rounded-lg border border-steel-200 bg-white px-4 py-6 text-center text-sm text-steel-500">
              No hay trabajadores activos con esos filtros.
            </p>
          ) : (
            // Una lista nueva por día y por filtro: reutilizar la anterior arrastraba sus marcas.
            <AttendanceSheet key={`${dia}|${f.q ?? ""}|${f.area ?? ""}`} dia={dia} filas={filas} puedeMarcar={puedeMarcar} />
          )}
        </div>
      </section>
      )}

      {/* ---------- Cuadro de lunes a domingo, con el mes plegado debajo ---------- */}
      {vista === "semana" && semana && resumen && (
      <>
      <div>
        <AttendanceWeek
          semana={semana}
          hoy={todayLima()}
          anterior={aSemana(addDays(lunes, -7))}
          siguiente={aSemana(addDays(lunes, 7))}
          actual={lunes === lunesDeHoy ? null : aSemana(lunesDeHoy)}
        />
      </div>

      {/* ---------- El acumulado del mes, plegado ---------- */}
      <details className="group mt-6 rounded-lg border border-steel-200 bg-white" open={!!first(sp.mes)}>
        <summary className="cursor-pointer list-none px-4 py-3 font-display text-base font-semibold text-ink">
          Resumen de {formatDate(resumen.desde).slice(3)}
          <span className="ml-2 text-sm font-normal text-steel-500 group-open:hidden">ver totales del mes</span>
        </summary>
      <section className="border-t border-steel-200 p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-steel-500">
              {resumen.diasRegistrados === 0
                ? "Todavía no se pasó lista ningún día de este mes."
                : `Se pasó lista ${resumen.diasRegistrados} día(s) de este mes. Los días sin registrar no cuentan ni como falta ni como asistencia.`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/asistencia?vista=semana&dia=${dia}&mes=${mesAnterior(mes)}`}
              className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-steel-600 hover:border-ink hover:text-ink"
            >
              ← Mes anterior
            </Link>
            <Link
              href={`/asistencia?vista=semana&dia=${dia}&mes=${mesSiguiente(mes)}`}
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
      </details>
      </>
      )}
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
