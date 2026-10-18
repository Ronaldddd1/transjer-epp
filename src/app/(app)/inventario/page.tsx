import { History, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteProduct } from "@/actions/products";
import { MovementModal } from "@/components/inventory/movement-modal";
import { ProductFormModal } from "@/components/inventory/product-form-modal";
import { DemoBadge, StockBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { SortHeader } from "@/components/ui/sort-header";
import { StockMeter } from "@/components/ui/stock-meter";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { first, formatDateTime, formatNumber, pageParams, STOCK_STATUS_LABEL, stockStatus, type SearchParams } from "@/lib/utils";
import { getCategoryOptions, getProductOptions, getSizeOptions, listProducts, readFilters } from "@/server/queries";

export const metadata: Metadata = { title: "Inventario de EPP" };

export default async function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("products.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp);
  const f = readFilters(sp);
  const canManage = can(user.role, "products.manage");
  const canMove = can(user.role, "movements.create");
  const canAdjust = can(user.role, "movements.adjust");

  const [{ rows, total }, categories, sizes, productOptions] = await Promise.all([
    listProducts({ q: f.q, categoryId: f.categoryId, status: f.status, size: first(sp.size), sort: first(sp.sort), dir: first(sp.dir), limit: pageSize, offset }),
    getCategoryOptions(),
    getSizeOptions(),
    canMove ? getProductOptions() : Promise.resolve([]),
  ]);
  const hasFilters = !!(f.q || f.categoryId || f.status || first(sp.size));

  return (
    <>
      <PageHeader
        title="Inventario de EPP"
        description="Stock actual de cada equipo. El stock solo cambia con entradas, salidas, ajustes o entregas."
        actions={
          <>
            <ExportTable tabla="inventario" />
            {canAdjust && <MovementModal products={productOptions} type="AJUSTE" />}
            {canMove && <MovementModal products={productOptions} type="ENTRADA" />}
            {canMove && <MovementModal products={productOptions} type="SALIDA" />}
            {canManage && <ProductFormModal categories={categories} />}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Buscar por código, nombre o marca"
        filters={[
          { type: "select", name: "category", label: "Categoría", allLabel: "Todas", options: categories.map((c) => ({ value: c.id, label: c.name })) },
          { type: "select", name: "status", label: "Estado", options: Object.entries(STOCK_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
          { type: "select", name: "size", label: "Talla", allLabel: "Todas", options: sizes.map((s) => ({ value: s, label: s })) },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <SortHeader label="Código" field="code" basePath="/inventario" sp={sp} />
            <SortHeader label="Producto" field="name" basePath="/inventario" sp={sp} />
            <SortHeader label="Categoría" field="category" basePath="/inventario" sp={sp} />
            <Th className="hidden 2xl:table-cell">Marca</Th>
            <Th>Talla</Th>
            <Th className="hidden 2xl:table-cell">Unidad</Th>
            {/* Ingresado y entregado a la vista: la resta de los dos es el stock, y así
                se ve de dónde sale el número sin entrar al historial de cada EPP. */}
            <Th className="text-right">Ingresado</Th>
            <Th className="text-right">Entregado</Th>
            <SortHeader label="Stock" field="stock" basePath="/inventario" sp={sp} className="text-right" />
            <Th className="hidden text-right 2xl:table-cell">Mínimo</Th>
            <Th>Estado</Th>
            <SortHeader label="Actualizado" field="updated" basePath="/inventario" sp={sp} className="hidden 2xl:table-cell" />
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={13}
              title={hasFilters ? "Ningún EPP coincide con los filtros" : "Todavía no hay EPP registrados"}
              hint={hasFilters ? "Prueba con otra búsqueda o limpia los filtros." : canManage ? "Registra el primer equipo con el botón Nuevo EPP." : "Un administrador debe registrar los productos."}
              action={!hasFilters && canManage ? <ProductFormModal categories={categories} /> : undefined}
            />
          )}
          {rows.map((p) => {
            const status = stockStatus(p.stock, p.minimumStock);
            return (
              <Tr key={p.id}>
                <Td className="whitespace-nowrap font-medium tabular">{p.code}</Td>
                <Td className="min-w-[10rem]">
                  <span className="font-semibold">{p.name}</span>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-steel-500">
                    {p.brand && <span className="2xl:hidden">{p.brand}</span>}
                    {p.brand && p.color && <span className="2xl:hidden" aria-hidden>·</span>}
                    {p.color && <span>{p.color}</span>}
                    {p.isDemo && <DemoBadge />}
                  </p>
                </Td>
                <Td className="text-steel-600">{p.categoryName}</Td>
                <Td className="hidden text-steel-600 2xl:table-cell">{p.brand ?? "—"}</Td>
                <Td>{p.size ?? "—"}</Td>
                <Td className="hidden text-steel-600 2xl:table-cell">{p.unit}</Td>
                <Td className="text-right tabular text-steel-600">{formatNumber(p.ingresado)}</Td>
                <Td className="text-right tabular text-steel-600">{formatNumber(p.entregado)}</Td>
                <Td className="text-right">
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-display text-lg font-bold leading-none tabular">{p.stock}</span>
                    <StockMeter stock={p.stock} minimum={p.minimumStock} className="w-16" />
                    <span className="whitespace-nowrap text-[11px] text-steel-500 2xl:hidden">mín. {p.minimumStock}</span>
                    {/* Mermas, traslados y ajustes hacen que ingresado − entregado no dé
                        el stock. Se dice en la fila, para que el número no parezca mal. */}
                    {p.stock !== p.ingresado - p.entregado && (
                      <span
                        className="whitespace-nowrap text-[11px] text-steel-500"
                        title="Diferencia por mermas, traslados o ajustes de inventario"
                      >
                        {p.stock - (p.ingresado - p.entregado) > 0 ? "+" : ""}
                        {formatNumber(p.stock - (p.ingresado - p.entregado))} otros
                      </span>
                    )}
                  </div>
                </Td>
                <Td className="hidden text-right tabular text-steel-600 2xl:table-cell">{p.minimumStock}</Td>
                <Td><StockBadge status={status} /></Td>
                <Td className="hidden text-steel-500 2xl:table-cell">{formatDateTime(p.updatedAt)}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-0.5">
                    {canMove && (
                      <>
                        <MovementModal products={productOptions.filter((o) => o.id === p.id)} type="ENTRADA" productId={p.id} trigger="compact" variant="ghost" />
                        <MovementModal products={productOptions.filter((o) => o.id === p.id)} type="SALIDA" productId={p.id} trigger="compact" variant="ghost" />
                      </>
                    )}
                    <ButtonLink href={`/movimientos?product=${p.id}`} variant="ghost" size="sm" title="Ver historial" aria-label="Ver historial">
                      <History className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Historial</span>
                    </ButtonLink>
                    {canManage && <ProductFormModal categories={categories} product={p} />}
                    {canManage && (
                      <ConfirmButton
                        action={deleteProduct.bind(null, p.id)}
                        title="Eliminar producto"
                        message={`¿Estás seguro de eliminar este producto? ${p.code} · ${p.name} dejará de aparecer en el inventario, pero su historial de movimientos y entregas se conservará.`}
                        confirmLabel="Eliminar"
                        triggerTitle="Eliminar"
                        triggerLabel={<Trash2 className="h-4 w-4 text-red-600" />}
                      />
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
      <Pagination basePath="/inventario" searchParams={sp} page={page} pageSize={pageSize} total={total} />
      {!canManage && (
        <p className="mt-4 text-sm text-steel-500">
          Para crear o editar productos, solicita acceso a un administrador. <Link href="/movimientos" className="underline">Ver movimientos</Link>
        </p>
      )}
    </>
  );
}
