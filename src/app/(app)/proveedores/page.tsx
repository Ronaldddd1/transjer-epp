import { Power } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { toggleSupplier } from "@/actions/suppliers";
import { SupplierFormModal } from "@/components/suppliers/supplier-form-modal";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { first, formatMoney, isYmd, pageParams, type SearchParams } from "@/lib/utils";
import { getDestinationOptions, listSuppliers, supplierTotals } from "@/server/invoice-queries";

export const metadata: Metadata = { title: "Proveedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("suppliers.manage");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 20);
  const estado = first(sp.estado);
  const filtros = {
    q: first(sp.q)?.trim() || undefined,
    active: estado === "ACTIVO" ? true : estado === "INACTIVO" ? false : undefined,
    from: isYmd(first(sp.from)) ? first(sp.from) : undefined,
    to: isYmd(first(sp.to)) ? first(sp.to) : undefined,
    destino: first(sp.destino) || undefined,
  };
  const [{ rows, total }, totales, destinos] = await Promise.all([
    listSuppliers(filtros, pageSize, offset),
    supplierTotals(filtros),
    getDestinationOptions(),
  ]);

  /** Dos monedas en una línea, y solo las que tienen algo. */
  const plata = (pen: string, usd: string) => {
    const partes: string[] = [];
    if (Number(pen) > 0) partes.push(formatMoney(pen, "PEN"));
    if (Number(usd) > 0) partes.push(formatMoney(usd, "USD"));
    return partes.length ? partes.join(" + ") : "—";
  };

  return (
    <>
      <PageHeader
        title="Proveedores"
        description="Empresas de transporte que emiten facturas a Transjer."
        actions={<><ExportTable tabla="proveedores" /><SupplierFormModal /></>}
      />
      {/* Lo que se le debe a los proveedores y lo que ya se les pagó, acotado a lo que
          esté filtrado abajo: cambiar las fechas o el destino cambia estos dos números. */}
      <dl className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-amber-300 bg-white p-4">
          <dt className="text-sm text-steel-600">Pendiente de pago</dt>
          <dd className="font-display text-2xl font-bold text-[#7A5A00]">{plata(totales.pendingPen, totales.pendingUsd)}</dd>
          <p className="text-xs text-steel-500">{totales.pendientes} factura(s), sin la detracción</p>
        </div>
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <dt className="text-sm text-steel-600">Pagado</dt>
          <dd className="font-display text-2xl font-bold text-emerald-700">{plata(totales.paidPen, totales.paidUsd)}</dd>
          <p className="text-xs text-steel-500">{totales.pagadas} factura(s)</p>
        </div>
        <div className="rounded-lg border border-steel-200 bg-white p-4">
          <dt className="text-sm text-steel-600">Facturas en total</dt>
          <dd className="font-display text-2xl font-bold">{totales.facturas}</dd>
          <p className="text-xs text-steel-500">
            {filtros.from || filtros.to || filtros.destino ? "con los filtros puestos" : "de todos los proveedores"}
          </p>
        </div>
      </dl>

      <FilterBar
        searchPlaceholder="Buscar razón social o RUC"
        filters={[
          { type: "select", name: "estado", label: "Estado", allLabel: "Todos", options: [{ value: "ACTIVO", label: "Activos" }, { value: "INACTIVO", label: "Inactivos" }] },
          { type: "select", name: "destino", label: "Destino", allLabel: "Todos", options: destinos.map((d) => ({ value: d, label: d })) },
          { type: "date", name: "from", label: "Emitidas desde" },
          { type: "date", name: "to", label: "Emitidas hasta" },
        ]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>RUC</Th>
            <Th>Razón social</Th>
            <Th className="hidden 2xl:table-cell">Contacto</Th>
            <Th className="text-right">Facturas</Th>
            <Th className="text-right">Pendiente de pago</Th>
            <Th className="text-right">Pagado</Th>
            <Th>Estado</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow colSpan={8} title="No hay proveedores para mostrar" hint="Regístralos con Nuevo proveedor, o se crean solos al leer el XML de una factura." />
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
              <Td className="whitespace-nowrap text-right tabular">
                {s.pendingCount > 0 ? (
                  <Link href={`/facturas?proveedor=${s.id}&estado=PENDIENTE`} className="font-display text-base font-bold text-[#7A5A00] hover:underline">
                    {plata(s.pendingPen, s.pendingUsd)}
                  </Link>
                ) : <span className="text-steel-400">—</span>}
                {s.pendingCount > 0 && <p className="text-xs text-steel-500">{s.pendingCount} factura(s)</p>}
              </Td>
              <Td className="whitespace-nowrap text-right tabular text-steel-600">
                {s.paidCount > 0 ? (
                  <>
                    <span className="font-medium">{plata(s.paidPen, s.paidUsd)}</span>
                    <p className="text-xs text-steel-500">{s.paidCount} factura(s)</p>
                  </>
                ) : <span className="text-steel-400">—</span>}
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
