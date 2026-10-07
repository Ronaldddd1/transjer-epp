import { ArrowLeft, HardHat, Package, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { StockBadge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { cn, formatDate, formatNumber, stockStatus, type SearchParams } from "@/lib/utils";
import {
  deliverySummary, getCategoryOptions, getEmployeeOptions, getProductOptions, readFilters,
} from "@/server/queries";

export const metadata: Metadata = { title: "Resumen de EPP entregados" };

/**
 * Qué EPP salió del almacén y a quién, sumado.
 *
 * El listado de entregas sigue existiendo para ver fila por fila, y la ficha de cada
 * trabajador sigue teniendo su historial. Esta pantalla es para la pregunta que antes
 * obligaba a entrar trabajador por trabajador: cuánto se entregó de cada cosa.
 */
export default async function DeliverySummaryPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("deliveries.view");
  const sp = await searchParams;
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
        title="Resumen de EPP entregados"
        description="Cuánto salió de cada EPP y quién lo recibió, sin entrar trabajador por trabajador."
        actions={<ExportTable tabla="resumen-epp" label="Exportar resumen" />}
      />

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
