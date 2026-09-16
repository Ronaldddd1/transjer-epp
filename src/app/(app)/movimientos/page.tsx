import type { Metadata } from "next";
import { MovementModal } from "@/components/inventory/movement-modal";
import { MovementBadge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, first, formatDateTime, MOVEMENT_LABEL, pageParams, type SearchParams } from "@/lib/utils";
import { getProductOptions, getUserOptions, listMovements, readFilters } from "@/server/queries";

export const metadata: Metadata = { title: "Movimientos" };

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("movements.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const f = readFilters(sp);
  const canMove = can(user.role, "movements.create");
  const canAdjust = can(user.role, "movements.adjust");
  const openType = first(sp.nuevo);

  const [{ rows, total }, products, users] = await Promise.all([
    listMovements(f, pageSize, offset),
    getProductOptions(),
    getUserOptions(),
  ]);
  const filteredProduct = f.productId ? products.find((p) => p.id === f.productId) : undefined;

  return (
    <>
      <PageHeader
        title="Movimientos"
        description={filteredProduct
          ? `Historial de ${filteredProduct.code} · ${filteredProduct.name} (stock actual: ${filteredProduct.stock}).`
          : "Historial de entradas, salidas y ajustes. Cada registro guarda el stock antes y después."}
        actions={
          <>
            {canMove && <MovementModal products={products} type="ENTRADA" variant="primary" defaultOpen={openType === "ENTRADA"} productId={filteredProduct?.id} />}
            {canMove && <MovementModal products={products} type="SALIDA" defaultOpen={openType === "SALIDA"} productId={filteredProduct?.id} />}
            {canAdjust && <MovementModal products={products} type="AJUSTE" variant="ghost" defaultOpen={openType === "AJUSTE"} productId={filteredProduct?.id} />}
          </>
        }
      />
      <FilterBar
        searchPlaceholder="Buscar producto o motivo"
        filters={[
          { type: "select", name: "type", label: "Tipo", options: Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "product", label: "Producto", options: products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
          { type: "select", name: "user", label: "Usuario", options: users.map((u) => ({ value: u.id, label: u.name })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th className="text-right">Cantidad</Th>
            <Th className="text-right">Stock</Th><Th>Motivo</Th><Th>Trabajador</Th><Th>Usuario</Th><Th>Observaciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={9} title="No hay movimientos para mostrar" hint="Cambia los filtros o registra una entrada." />}
          {rows.map((m) => {
            const signed = m.type === "SALIDA" ? -m.quantity : m.quantity;
            return (
              <Tr key={m.id}>
                <Td className="whitespace-nowrap text-steel-600 tabular">{formatDateTime(m.createdAt)}</Td>
                <Td><MovementBadge type={m.type} /></Td>
                <Td>
                  <p className="font-semibold">{m.productName}</p>
                  <p className="text-xs text-steel-500">{m.productCode} · {m.categoryName}</p>
                </Td>
                <Td className={cn("text-right font-display text-lg font-bold tabular", signed < 0 ? "text-ink" : "text-emerald-700")}>
                  {signed > 0 ? "+" : "−"}{Math.abs(signed)}
                </Td>
                <Td className="text-right text-steel-500 tabular">{m.stockBefore} → <span className="font-semibold text-ink">{m.stockAfter}</span></Td>
                <Td>{m.reason}</Td>
                <Td className="text-steel-600">{m.employeeName ?? "—"}</Td>
                <Td className="text-steel-600">{m.userName}</Td>
                <Td className="max-w-[16rem] truncate text-steel-500" title={m.notes ?? undefined}>{m.notes ?? "—"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
      <Pagination basePath="/movimientos" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
