import { AlertTriangle, PackageCheck, Undo2, UserMinus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ReturnModal } from "@/components/deliveries/return-modal";
import { ReturnConditionBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader, Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  cn, first, formatDate, formatNumber, RETURN_CONDITION_LABEL, type SearchParams,
} from "@/lib/utils";
import {
  getCategoryOptions, getEmployeeOptions, getProductOptions, listPendingReturns, listReturns,
  pendingReturnItems, readFilters,
} from "@/server/queries";

export const metadata: Metadata = { title: "Devolución de EPP" };

/**
 * Devolución de EPP al cese.
 *
 * Mientras un trabajador cesado tenga EPP a su cargo aparece aquí. El pendiente es una
 * resta —entregas vigentes menos devoluciones—, así que nadie puede quedar reclamado por
 * algo que ya entregó, ni desaparecer de la lista sin que se registre la devolución.
 */
export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("deliveries.view");
  const sp = await searchParams;
  const f = readFilters(sp);
  const q = first(sp.q)?.trim() || undefined;
  const verTodos = first(sp.pendientes) === "todos";

  // Lo pendiente abierto por EPP alimenta el modal: solo ofrece lo que esa persona tiene
  // a su cargo, y viene en una sola consulta para todas las filas de la tabla.
  const [pendientes, porTrabajador, historial, employees, products, categories] = await Promise.all([
    listPendingReturns({ q, includeActive: verTodos }),
    pendingReturnItems({ includeActive: verTodos }),
    listReturns(f, 50, 0),
    getEmployeeOptions(),
    getProductOptions(),
    getCategoryOptions(),
  ]);

  const canReturn = can(user.role, "deliveries.create");
  const cesados = pendientes.filter((p) => p.terminatedAt);
  const unidadesCesados = cesados.reduce((s, p) => s + p.unidades, 0);
  const atrasados = cesados.filter((p) => p.dias > 7);

  const tarjetas = [
    {
      label: "Cesados con EPP pendiente",
      value: formatNumber(cesados.length),
      detail: `${formatNumber(unidadesCesados)} unidad(es) por devolver`,
      icon: UserMinus,
      alerta: cesados.length > 0,
    },
    {
      label: "Más de una semana",
      value: formatNumber(atrasados.length),
      detail: "desde el cese, sin devolver",
      icon: AlertTriangle,
      alerta: atrasados.length > 0,
    },
    {
      label: "Devoluciones registradas",
      value: formatNumber(historial.total),
      detail: "con los filtros actuales",
      icon: PackageCheck,
      alerta: false,
    },
  ];

  return (
    <>
      <PageHeader
        title="Devolución de EPP"
        description="Lo que cada trabajador cesado tiene a su cargo y todavía no ha entregado."
        actions={<ExportTable tabla="devoluciones" />}
      />

      {cesados.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            <strong>{cesados.length} trabajador(es) cesado(s)</strong> deben devolver {formatNumber(unidadesCesados)} unidad(es) de EPP.
            {atrasados.length > 0 && <> {atrasados.length} lleva(n) más de una semana desde el cese.</>}
          </span>
        </div>
      )}

      <dl className="mb-6 grid gap-3 sm:grid-cols-3">
        {tarjetas.map((t) => (
          <div key={t.label} className={cn("rounded-lg border bg-white p-4", t.alerta ? "border-red-300" : "border-steel-200")}>
            <dt className="flex items-center gap-2 text-sm text-steel-500">
              <t.icon className="h-4 w-4 text-steel-400" aria-hidden /> {t.label}
            </dt>
            <dd className={cn("mt-1 font-display text-2xl font-bold", t.alerta ? "text-red-700" : "text-ink")}>{t.value}</dd>
            <dd className="mt-0.5 text-sm text-steel-600">{t.detail}</dd>
          </div>
        ))}
      </dl>

      <Panel
        title={verTodos ? "EPP a cargo de todos los trabajadores" : "Pendiente de devolución"}
        action={
          <Link href={verTodos ? "/devoluciones" : "/devoluciones?pendientes=todos"} className="text-sm text-steel-600 underline hover:text-ink">
            {verTodos ? "Ver solo los cesados" : "Ver también a los activos"}
          </Link>
        }
      >
        <TableShell>
          <thead>
            <tr>
              <Th>Trabajador</Th>
              <Th>EPP pendiente</Th>
              <Th className="hidden 2xl:table-cell">Cese</Th>
              <Th className="text-right">Unidades</Th>
              {canReturn && <Th className="text-right">Acciones</Th>}
            </tr>
          </thead>
          <tbody>
            {pendientes.length === 0 && (
              <EmptyRow
                colSpan={canReturn ? 5 : 4}
                title={verTodos ? "Nadie tiene EPP a su cargo" : "Ningún cesado debe EPP"}
                hint={verTodos ? undefined : "Cuando registres el cese de un trabajador que tenga EPP, aparecerá aquí."}
              />
            )}
            {pendientes.map((p) => {
              const items = porTrabajador.get(p.employeeId) ?? [];
              const atrasado = !!p.terminatedAt && p.dias > 7;
              return (
                <Tr key={p.employeeId} className={cn(atrasado && "bg-red-50/40")}>
                  <Td>
                    <Link href={`/trabajadores/${p.employeeId}`} className="font-medium hover:underline">{p.employeeName}</Link>
                    <p className="text-xs text-steel-500">DNI {p.dni} · {p.position} · {p.area}</p>
                  </Td>
                  <Td className="text-sm">
                    {p.detalle}
                    <p className="text-xs text-steel-500">{p.tipos} tipo(s) · última entrega {formatDate(p.ultima)}</p>
                  </Td>
                  <Td className="hidden whitespace-nowrap tabular 2xl:table-cell">
                    {p.terminatedAt ? (
                      <>
                        <span className={cn(atrasado && "font-semibold text-red-700")}>{formatDate(p.terminatedAt)}</span>
                        <p className="text-xs text-steel-500">
                          {p.dias === 0 ? "hoy" : `hace ${p.dias} día(s)`}
                          {p.terminationReason && ` · ${p.terminationReason}`}
                        </p>
                      </>
                    ) : (
                      <span className="text-steel-500">Activo</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <span className={cn("font-display text-lg font-bold tabular", atrasado && "text-red-700")}>{p.unidades}</span>
                  </Td>
                  {canReturn && (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {items.length > 0 && (
                          <ReturnModal
                            employee={{ id: p.employeeId, name: p.employeeName, terminatedAt: p.terminatedAt }}
                            items={items}
                            variant="outline"
                            compact
                          />
                        )}
                        <ButtonLink href={`/trabajadores/${p.employeeId}`} variant="ghost" size="sm">Ver</ButtonLink>
                      </div>
                    </Td>
                  )}
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      </Panel>

      <h2 className="mb-3 mt-6 font-display text-xl font-semibold">Devoluciones registradas</h2>

      <FilterBar
        searchPlaceholder="Buscar trabajador, DNI o EPP"
        filters={[
          { type: "select", name: "condicion", label: "Estado en que volvió", allLabel: "Todos", options: Object.entries(RETURN_CONDITION_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "employee", label: "Trabajador", options: employees.map((e) => ({ value: e.id, label: `${e.lastName}, ${e.firstName}` })) },
          { type: "select", name: "product", label: "EPP", options: products.map((p) => ({ value: p.id, label: `${p.name}${p.size ? ` (${p.size})` : ""}` })) },
          { type: "select", name: "category", label: "Categoría", options: categories.map((c) => ({ value: c.id, label: c.name })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Fecha</Th>
            <Th>Trabajador</Th>
            <Th>EPP</Th>
            <Th className="text-right">Cantidad</Th>
            <Th>Volvió como</Th>
            <Th className="hidden 2xl:table-cell">Motivo</Th>
            <Th className="hidden 2xl:table-cell">Responsable</Th>
          </tr>
        </thead>
        <tbody>
          {historial.rows.length === 0 && <EmptyRow colSpan={7} title="No hay devoluciones con esos filtros" />}
          {historial.rows.map((d) => (
            <Tr key={d.id}>
              <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(d.returnDate)}</Td>
              <Td>
                <Link href={`/trabajadores/${d.employeeId}`} className="font-medium hover:underline">{d.employeeName}</Link>
                <p className="text-xs text-steel-500">DNI {d.dni}</p>
              </Td>
              <Td>
                {d.productName}{d.size && <span className="text-steel-500"> · {d.size}</span>}
                <p className="text-xs text-steel-500">{d.productCode} · {d.categoryName}</p>
              </Td>
              <Td className="text-right font-display text-lg font-bold tabular">{d.quantity}</Td>
              <Td><ReturnConditionBadge condition={d.condition} /></Td>
              <Td className="hidden text-sm 2xl:table-cell">
                {d.reason}
                {d.notes && <p className="text-xs text-steel-500">{d.notes}</p>}
              </Td>
              <Td className="hidden text-steel-600 2xl:table-cell">{d.userName}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <p className="mt-3 flex items-start gap-2 text-sm text-steel-500">
        <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" aria-hidden />
        <span>
          Solo el EPP que vuelve reutilizable regresa al stock, con su movimiento de entrada.
          El descartado y el que el trabajador no entregó quedan registrados sin tocar el inventario.
        </span>
      </p>
    </>
  );
}
