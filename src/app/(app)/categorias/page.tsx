import type { Metadata } from "next";
import { toggleCategory } from "@/actions/categories";
import { CategoryFormModal } from "@/components/admin/category-form-modal";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { listCategories } from "@/server/queries";

export const metadata: Metadata = { title: "Categorías de EPP" };

export default async function CategoriesPage() {
  await requirePageUser("categories.manage");
  const rows = await listCategories();
  return (
    <>
      <PageHeader
        title="Categorías de EPP"
        description="Agrupan los productos del inventario. Una categoría desactivada no aparece al registrar nuevos EPP."
        actions={<CategoryFormModal />}
      />
      <TableShell>
        <thead>
          <tr><Th>Categoría</Th><Th>Descripción</Th><Th className="text-right">Productos</Th><Th>Estado</Th><Th>Creada</Th><Th className="text-right">Acciones</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={6} title="No hay categorías" hint="Crea la primera para empezar a registrar EPP." />}
          {rows.map((c) => (
            <Tr key={c.id}>
              <Td><span className="font-semibold">{c.name}</span> {c.isDemo && <DemoBadge />}</Td>
              <Td className="max-w-md text-steel-600">{c.description ?? "—"}</Td>
              <Td className="text-right font-display text-lg font-bold tabular">{c.productCount}</Td>
              <Td>{c.active ? <Badge tone="green">Activa</Badge> : <Badge>Inactiva</Badge>}</Td>
              <Td className="whitespace-nowrap text-steel-500">{formatDate(c.createdAt)}</Td>
              <Td>
                <div className="flex justify-end gap-1">
                  <CategoryFormModal category={c} />
                  <ConfirmButton
                    action={toggleCategory.bind(null, c.id)}
                    title={c.active ? "Desactivar categoría" : "Activar categoría"}
                    message={c.active
                      ? `"${c.name}" dejará de aparecer al crear productos. Los ${c.productCount} producto(s) actuales no cambian.`
                      : `"${c.name}" volverá a estar disponible al crear productos.`}
                    confirmLabel={c.active ? "Desactivar" : "Activar"}
                    confirmVariant={c.active ? "danger" : "primary"}
                    triggerLabel={c.active ? "Desactivar" : "Activar"}
                  />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
