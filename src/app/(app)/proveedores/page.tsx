import { Power } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { toggleSupplier } from "@/actions/suppliers";
import { SupplierFormModal } from "@/components/suppliers/supplier-form-modal";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { first, pageParams, type SearchParams } from "@/lib/utils";
import { listSuppliers } from "@/server/invoice-queries";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("suppliers.manage");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const estado = first(sp.estado);
  const { rows, total } = await listSuppliers(
    { q: first(sp.q)?.trim() || undefined, active: estado === "ACTIVO" ? true : estado === "INACTIVO" ? false : undefined },
    pageSize, offset,
  );

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Empresas de transporte que emiten facturas a Transjer."
        actions={<SupplierFormModal />}
      />
      <FilterBar
        searchPlaceholder="Buscar razón social o RUC"
        filters={[{ type: "select", name: "estado", label: "Estado", allLabel: "Todos", options: [{ value: "ACTIVO", label: "Activos" }, { value: "INACTIVO", label: "Inactivos" }] }]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>RUC</Th>
            <Th>Razón social</Th>
            <Th className="hidden 2xl:table-cell">Contacto</Th>
            <Th className="text-right">Facturas</Th>
            <Th className="text-right">Pendientes</Th>
            <Th>Estado</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow colSpan={7} title="No hay proveedores para mostrar" hint="Regístralos con Nuevo proveedor, o se crean solos al leer el XML de una factura." />
          )}
          {rows.map((s) => (
            <Tr key={s.id}>
              <Td className="whitespace-nowrap tabular">{s.ruc}</Td>
              <Td>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.businessName}</span>
                  {s.isDemo && <DemoBadge />}
                </div>
                {s.tradeName && <p className="text-xs text-steel-500">{s.tradeName}</p>}
                <p className="text-xs text-steel-500 2xl:hidden">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "Sin contacto registrado"}</p>
              </Td>
              <Td className="hidden text-steel-600 2xl:table-cell">
                {s.contactName ?? "—"}
                {(s.email || s.phone) && <p className="text-xs text-steel-500">{[s.email, s.phone].filter(Boolean).join(" · ")}</p>}
              </Td>
              <Td className="text-right tabular text-steel-600">
                {s.invoiceCount > 0 ? <Link href={`/facturas?proveedor=${s.id}`} className="hover:underline">{s.invoiceCount}</Link> : "0"}
              </Td>
              <Td className="text-right font-display text-base font-bold tabular">
                {s.pendingCount > 0
                  ? <Link href={`/facturas?proveedor=${s.id}&estado=PENDIENTE`} className="text-[#7A5A00] hover:underline">{s.pendingCount}</Link>
                  : <span className="text-steel-400">0</span>}
              </Td>
              <Td>{s.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
              <Td>
                <div className="flex items-center justify-end gap-1">
                  <SupplierFormModal supplier={s} />
                  <ConfirmButton
                    action={toggleSupplier.bind(null, s.id)}
                    title={s.active ? "Desactivar proveedor" : "Activar proveedor"}
                    message={s.active
                      ? `${s.businessName} dejará de aparecer al registrar facturas nuevas. Su historial se conserva.`
                      : `${s.businessName} volverá a estar disponible para registrar facturas.`}
                    confirmLabel={s.active ? "Desactivar" : "Activar"}
                    confirmVariant={s.active ? "danger" : "primary"}
                    triggerLabel={<Power className="h-4 w-4" />}
                    triggerTitle={s.active ? "Desactivar" : "Activar"}
                    size="icon"
                  />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination basePath="/proveedores" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
