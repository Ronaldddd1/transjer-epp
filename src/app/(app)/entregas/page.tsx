import type { Metadata } from "next";
import Link from "next/link";
import { DeliveryModal } from "@/components/deliveries/delivery-modal";
import { VoidDeliveryModal } from "@/components/deliveries/void-delivery-modal";
import { VoidedNote } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, first, formatDate, pageParams, todayLima, type SearchParams } from "@/lib/utils";
import { DELIVERY_STATE_LABEL, getEmployeeOptions, getProductOptions, listDeliveries, readFilters } from "@/server/queries";

export const metadata: Metadata = { title: "Entrega de EPP" };

export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("deliveries.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readFilters(sp);
  const canCreate = can(user.role, "deliveries.create");
  const canVoid = can(user.role, "deliveries.void");
  const cols = canVoid ? 10 : 9;

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
          { type: "select", name: "estado", label: "Estado", allLabel: "Todas", options: Object.entries(DELIVERY_STATE_LABEL).map(([value, label]) => ({ value, label })) },
        ]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>Fecha</Th><Th>Trabajador</Th><Th className="hidden 2xl:table-cell">Cargo / Área</Th><Th>EPP</Th><Th className="hidden 2xl:table-cell">Talla</Th>
            <Th className="text-right">Cantidad</Th><Th>Motivo</Th><Th>Responsable</Th><Th>Observaciones</Th>
            {canVoid && <Th className="text-right">Acciones</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={cols} title="No hay entregas para mostrar" hint={canCreate ? "Usa Registrar entrega para anotar la primera." : undefined} />}
          {rows.map((d) => (
            <Tr key={d.id} className={cn(d.voidedAt && "bg-steel-50/60 [&>td]:text-steel-400")}>
              <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(d.deliveryDate)}</Td>
              <Td>
                <Link href={`/trabajadores/${d.employeeId}`} className="font-semibold hover:underline">{d.employeeName}</Link>
                <p className="text-xs text-steel-500">DNI {d.dni}</p>
                <p className="text-xs text-steel-500 2xl:hidden">{d.position} · {d.area}</p>
              </Td>
              <Td className="hidden text-steel-600 2xl:table-cell">{d.position}<p className="text-xs text-steel-500">{d.area}</p></Td>
              <Td><p className="font-medium">{d.productName}</p><p className="text-xs text-steel-500">{d.productCode}{d.size && <span className="2xl:hidden"> · Talla {d.size}</span>}</p></Td>
              <Td className="hidden 2xl:table-cell">{d.size ?? "—"}</Td>
              <Td className={cn("text-right font-display text-lg font-bold tabular", d.voidedAt && "line-through")}>{d.quantity}</Td>
              <Td>
                {d.reason}
                {d.voidedAt && <VoidedNote voidedAt={d.voidedAt} voidedByName={d.voidedByName} voidReason={d.voidReason} />}
              </Td>
              <Td className="text-steel-600">{d.userName}</Td>
              <Td className="text-steel-500"><p className="line-clamp-2 w-36 xl:w-40 2xl:w-56" title={d.notes ?? undefined}>{d.notes ?? "—"}</p></Td>
              {canVoid && (
                <Td className="text-right">
                  {!d.voidedAt && <VoidDeliveryModal delivery={{ id: d.id, deliveryDate: d.deliveryDate, employeeName: d.employeeName, productName: d.productName, size: d.size, quantity: d.quantity }} dateLabel={formatDate(d.deliveryDate)} />}
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination basePath="/entregas" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
