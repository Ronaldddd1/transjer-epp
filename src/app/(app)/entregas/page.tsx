import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryModal } from "@/components/deliveries/delivery-modal";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { first, formatDate, pageParams, todayLima, type SearchParams } from "@/lib/utils";
import { getEmployeeOptions, getProductOptions, listDeliveries, readFilters } from "@/server/queries";

export const metadata: Metadata = { title: "Entrega de EPP" };

export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("deliveries.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readFilters(sp);
  const canCreate = can(user.role, "deliveries.create");

  const [{ rows, total }, employees, products] = await Promise.all([
    listDeliveries(f, pageSize, offset),
    getEmployeeOptions(),
    getProductOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="Entrega de EPP"
        description="Registro de los equipos entregados a trabajadores y conductores."
        actions={canCreate && (
          <DeliveryModal employees={employees} products={products} today={todayLima()} userName={user.name} defaultOpen={first(sp.nuevo) === "1"} />
        )}
      />
      <FilterBar
        searchPlaceholder="Buscar trabajador, DNI o EPP"
        filters={[
          { type: "select", name: "employee", label: "Trabajador", options: employees.map((e) => ({ value: e.id, label: `${e.lastName}, ${e.firstName}` })) },
          { type: "select", name: "product", label: "EPP", options: products.map((p) => ({ value: p.id, label: `${p.name}${p.size ? ` (${p.size})` : ""}` })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>Fecha</Th><Th>Trabajador</Th><Th>Cargo / Área</Th><Th>EPP</Th><Th>Talla</Th>
            <Th className="text-right">Cantidad</Th><Th>Motivo</Th><Th>Responsable</Th><Th>Observaciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={9} title="No hay entregas para mostrar" hint={canCreate ? "Usa Registrar entrega para anotar la primera." : undefined} />}
          {rows.map((d) => (
            <Tr key={d.id}>
              <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(d.deliveryDate)}</Td>
              <Td>
                <Link href={`/trabajadores/${d.employeeId}`} className="font-semibold hover:underline">{d.employeeName}</Link>
                <p className="text-xs text-steel-500">DNI {d.dni}</p>
              </Td>
              <Td className="text-steel-600">{d.position}<p className="text-xs text-steel-500">{d.area}</p></Td>
              <Td><p className="font-medium">{d.productName}</p><p className="text-xs text-steel-500">{d.productCode}</p></Td>
              <Td>{d.size ?? "—"}</Td>
              <Td className="text-right font-display text-lg font-bold tabular">{d.quantity}</Td>
              <Td>{d.reason}</Td>
              <Td className="text-steel-600">{d.userName}</Td>
              <Td className="max-w-[14rem] truncate text-steel-500" title={d.notes ?? undefined}>{d.notes ?? "—"}</Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination basePath="/entregas" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
