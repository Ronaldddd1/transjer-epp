import { ArrowLeft, CalendarRange, HardHat, Package, Sheet, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CuadroEpp } from "@/components/deliveries/cuadro-epp";
import { StockBadge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { cn, first, formatDate, formatNumber, stockStatus, type SearchParams } from "@/lib/utils";
import {
  cuadroEpp, deliverySummary, getAreaOptions, getCategoryOptions, getEmployeeOptions, getProductOptions, readFilters,
} from "@/server/queries";

export const metadata: Metadata = { title: "Resumen de EPP" };

/**
 * El Resumen de EPP tiene dos vistas, cada una con su botón.
 *
 * La que abre es el cuadro tipo Excel: todos los trabajadores contra todos los EPP, con lo
 * que cada uno tiene hoy en su poder. Es lo que se pide para saber qué tiene cada quien sin
 * abrir ficha por ficha.
 *
 * La otra es la de siempre: qué EPP salió del almacén y a quién, sumado en un periodo.
 *
 * El listado de entregas sigue existiendo para ver fila por fila, y la ficha de cada
 * trabajador sigue teniendo su historial. Esta pantalla es para la pregunta que antes
 * obligaba a entrar trabajador por trabajador: cuánto se entregó de cada cosa.
 */
export default async function DeliverySummaryPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("deliveries.view");
  const sp = await searchParams;
  const vista: "cuadro" | "periodo" = first(sp.vista) === "periodo" ? "periodo" : "cuadro";

  if (vista === "cuadro") {
    const filtros = { q: first(sp.q), area: first(sp.area), categoryId: first(sp.category) };
    const [datos, areas, categorias] = await Promise.all([
      cuadroEpp(filtros), getAreaOptions(), getCategoryOptions(),
    ]);
    return (
      <>
        <Link href="/entregas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Volver al listado de entregas
        </Link>
        <PageHeader
          title="Resumen de EPP"
          description="Cuántos de cada EPP tiene hoy cada trabajador: lo entregado menos lo devuelto."
          actions={<ExportTable tabla="cuadro-epp" label="Descargar cuadro" />}
        />
        <VistasResumen vista="cuadro" />
        <FilterBar
          searchPlaceholder="Buscar trabajador o DNI"
          filters={[
            { type: "select", name: "area", label: "Área", allLabel: "Todas", options: areas.map((a) => ({ value: a, label: a })) },
            { type: "select", name: "category", label: "Categoría", options: categorias.map((c) => ({ value: c.id, label: c.name })) },
          ]}
        />
        <p className="mb-3 text-sm text-steel-500">
          {datos.filas.length} trabajador(es) · {datos.productos.length} EPP distinto(s) ·{" "}
          <strong className="text-ink">{formatNumber(datos.total)}</strong> unidad(es) en poder del personal.
          Las entregas anuladas no cuentan; las devoluciones, de cualquier tipo, descuentan.
        </p>
        <CuadroEpp datos={datos} />
      </>
    );
  }

  const f = readFilters(sp);

  const [resumen, employees, products, categories] = await Promise.all([
    deliverySummary(f),
    getEmployeeOptions(),
    getProductOptions(),
    getCategoryOptions(),
  ]);

  const paramsActuales = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v] as [string, string]] : [])),
  ).toString();
  const verDetalle = (extra: Record<string, string>) => {
    const p = new URLSearchParams(paramsActuales);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/entregas?${p.toString()}`;
  };

  const tarjetas = [
    { label: "EPP entregados", value: formatNumber(resumen.unidades), detail: `${resumen.entregas} entrega(s)`, icon: Package },
    { label: "Trabajadores con entregas", value: formatNumber(resumen.trabajadores), detail: "en el periodo filtrado", icon: Users },
    { label: "Tipos de EPP distintos", value: formatNumber(resumen.tiposEpp), detail: "productos entregados", icon: HardHat },
  ];

  return (
    <>
      <Link href="/entregas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver al listado de entregas
      </Link>

      <PageHeader
        title="Resumen de EPP"
        description="Cuánto salió de cada EPP y quién lo recibió, sin entrar trabajador por trabajador."
        actions={<ExportTable tabla="resumen-epp" label="Exportar resumen" />}
      />
      <VistasResumen vista="periodo" />

      <FilterBar
        searchPlaceholder="Buscar trabajador, DNI o EPP"
        filters={[
          { type: "select", name: "employee", label: "Trabajador", options: employees.map((e) => ({ value: e.id, label: `${e.lastName}, ${e.firstName}` })) },
          { type: "select", name: "product", label: "EPP", options: products.map((p) => ({ value: p.id, label: `${p.name}${p.size ? ` (${p.size})` : ""}` })) },
          { type: "select", name: "category", label: "Categoría", options: categories.map((c) => ({ value: c.id, label: c.name })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />

      <dl className="mb-4 grid gap-3 sm:grid-cols-3">
        {tarjetas.map((t) => (
          <div key={t.label} className="rounded-lg border border-steel-200 bg-white p-4">
            <dt className="flex items-center gap-2 text-sm text-steel-500">
              <t.icon className="h-4 w-4 text-steel-400" aria-hidden /> {t.label}
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold text-ink">{t.value}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{t.detail}</dd>
          </div>
        ))}
      </dl>

      <p className="mb-4 text-sm text-steel-500">
        Las entregas anuladas no se cuentan: devolvieron su stock, así que sumarlas mostraría
        unidades que nunca salieron del almacén.
      </p>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Por tipo de EPP" action={<span className="text-sm text-steel-500">{resumen.porProducto.length} producto(s)</span>}>
          <TableShell>
            <thead>
              <tr>
                <Th>EPP</Th>
                <Th className="text-right">Entregado</Th>
                <Th className="text-right">Stock actual</Th>
                <Th className="hidden text-right 2xl:table-cell">Última</Th>
              </tr>
            </thead>
            <tbody>
              {resumen.porProducto.length === 0 && <EmptyRow colSpan={4} title="No hay entregas con esos filtros" />}
              {resumen.porProducto.map((p) => (
                <Tr key={p.productId}>
                  <Td>
                    <Link href={verDetalle({ product: p.productId })} className="font-medium hover:underline">{p.productName}</Link>
                    <p className="text-xs text-steel-500">
                      {p.productCode} · {p.categoryName} · {p.trabajadores} trabajador(es)
                    </p>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className="font-display text-base font-bold tabular">{formatNumber(p.unidades)}</span>
                    <p className="text-xs text-steel-500">{p.unit.toLowerCase()}(s) · {p.entregas} entrega(s)</p>
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className="tabular">{formatNumber(p.stock)}</span>
                    <p className="mt-0.5"><StockBadge status={stockStatus(p.stock, p.minimumStock)} /></p>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 2xl:table-cell">{formatDate(p.ultima)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>

        <Panel title="Por trabajador" action={<span className="text-sm text-steel-500">{resumen.porTrabajador.length} trabajador(es)</span>}>
          <TableShell>
            <thead>
              <tr>
                <Th>Trabajador</Th>
                <Th className="text-right">Recibido</Th>
                <Th className="hidden text-right 2xl:table-cell">Última</Th>
              </tr>
            </thead>
            <tbody>
              {resumen.porTrabajador.length === 0 && <EmptyRow colSpan={3} title="No hay entregas con esos filtros" />}
              {resumen.porTrabajador.map((e) => (
                <Tr key={e.employeeId}>
                  <Td>
                    <Link href={`/trabajadores/${e.employeeId}`} className="font-medium hover:underline">{e.employeeName}</Link>
                    <p className="text-xs text-steel-500">DNI {e.dni} · {e.position}</p>
                    {/* Qué EPP tiene, no solo cuántas unidades: es lo que permite ver de un
                        vistazo si a alguien le falta el casco o las botas. */}
                    {e.epps.length > 0 && (
                      <ul className="mt-1.5 flex flex-wrap gap-1">
                        {e.epps.map((p) => (
                          <li
                            key={p.productId}
                            className="inline-flex items-baseline gap-1 rounded border border-steel-200 bg-steel-50 px-1.5 py-0.5 text-xs text-ink-700"
                            title={`Última entrega: ${formatDate(p.ultima)}`}
                          >
                            <span>{p.productName}{p.size && <span className="text-steel-500"> · {p.size}</span>}</span>
                            <span className="font-semibold tabular">×{p.unidades}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className="font-display text-base font-bold tabular">{formatNumber(e.unidades)}</span>
                    <p className="text-xs text-steel-500">{e.tiposEpp} tipo(s) · {e.entregas} entrega(s)</p>
                  </Td>
                  <Td className="hidden whitespace-nowrap text-right tabular text-steel-600 2xl:table-cell">{formatDate(e.ultima)}</Td>
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </Panel>
      </div>

      <p className={cn("mt-4 text-sm text-steel-500")}>
        Para ver las entregas una por una, con su motivo y su responsable,{" "}
        <Link href={`/entregas?${paramsActuales}`} className="underline">abre el listado con estos mismos filtros</Link>.
      </p>
    </>
  );
}

/** Los dos botones de arriba: el cuadro de lo que tiene cada uno, o lo entregado en un periodo. */
function VistasResumen({ vista }: { vista: "cuadro" | "periodo" }) {
  const opciones = [
    { v: "cuadro", href: "/entregas/resumen", titulo: "Cuadro por trabajador", texto: "Lo que cada uno tiene hoy de cada EPP.", icono: Sheet },
    { v: "periodo", href: "/entregas/resumen?vista=periodo", titulo: "Entregado por periodo", texto: "Cuánto salió de cada EPP entre dos fechas.", icono: CalendarRange },
  ] as const;
  return (
    <nav aria-label="Vistas del resumen" className="mb-5 grid gap-3 sm:grid-cols-2">
      {opciones.map(({ v, href, titulo, texto, icono: Icono }) => (
        <Link
          key={v}
          href={href}
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
  );
}
