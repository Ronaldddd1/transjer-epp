import { MapPin, Phone, Users } from "lucide-react";
import type { Metadata } from "next";
import { toggleProvinceClient } from "@/actions/province-clients";
import { ProvinceClientModal } from "@/components/province/province-client-modal";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney, pageParams, type SearchParams } from "@/lib/utils";
import { listProvinceClients, provinceCounts, provinceOptions, readProvinceFilters } from "@/server/province-queries";

export const metadata: Metadata = { title: "Clientes de provincia" };
export const dynamic = "force-dynamic";

/**
 * El directorio de clientes de provincia.
 *
 * Se entra con una pregunta concreta —"el viaje es para Comercial Jaén, ¿a quién llamo y
 * cuánto cobra la estiba?"— así que la pantalla es una búsqueda y una tabla, sin pestañas
 * ni resúmenes de por medio. Lo que antes vivía en conversaciones de WhatsApp queda aquí
 * escrito, y lo puede consultar cualquiera que esté coordinando ese día.
 */
export default async function ProvinceClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("provinceClients.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 25);
  const f = readProvinceFilters(sp);
  const canManage = can(user, "provinceClients.manage");

  const [{ rows, total }, provincias, cuentas] = await Promise.all([
    listProvinceClients(f, pageSize, offset),
    provinceOptions(),
    provinceCounts(),
  ]);

  return (
    <>
      <PageHeader
        title="Clientes de provincia"
        description="A quién se entrega en cada provincia, dónde queda, a qué número se llama y qué cobra la estiba."
        actions={
          <>
            <ExportTable tabla="clientes-provincia" />
            {canManage && <ProvinceClientModal provincias={provincias} />}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-steel-200 bg-white px-4 py-3 text-sm">
        <span className="flex items-center gap-1.5">
          <Users className="h-4 w-4 text-steel-400" aria-hidden />
          <strong>{cuentas.clientes}</strong> cliente(s) registrados
        </span>
        <span className="flex items-center gap-1.5">
          <MapPin className="h-4 w-4 text-steel-400" aria-hidden />
          <strong>{cuentas.provincias}</strong> provincia(s)
        </span>
        <span className={cuentas.conPrecio < cuentas.clientes ? "text-steel-600" : "text-steel-500"}>
          <strong>{cuentas.clientes - cuentas.conPrecio}</strong> sin costo por tonelada anotado
        </span>
      </div>

      <FilterBar
        searchPlaceholder="Buscar por cliente, provincia, ubicación o teléfono"
        filters={[
          { type: "select", name: "provincia", label: "Provincia", allLabel: "Todas", options: provincias.map((p) => ({ value: p, label: p })) },
          { type: "select", name: "inactivos", label: "Estado", allLabel: "Vigentes", options: [{ value: "1", label: "Incluir dados de baja" }] },
        ]}
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Cliente destinatario</Th>
            <Th>Provincia</Th>
            <Th className="hidden lg:table-cell">Ubicación</Th>
            <Th>Contacto</Th>
            <Th>Estibas</Th>
            <Th className="text-right">Costo por tonelada</Th>
            <Th className="hidden 2xl:table-cell">Observaciones</Th>
            {canManage && <Th className="text-right">Acciones</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow
              colSpan={canManage ? 8 : 7}
              title="No hay clientes con esos filtros"
              hint={canManage ? "Registra el primero con Nuevo cliente." : undefined}
            />
          )}
          {rows.map((c) => (
            <Tr key={c.id} tone={c.active ? undefined : "bg-steel-50/60 [&>td]:text-steel-400"}>
              <Td>
                <span className="font-semibold">{c.clientName}</span>
                {!c.active && <Badge tone="neutral" className="ml-2">Dado de baja</Badge>}
              </Td>
              <Td className="whitespace-nowrap">{c.province}</Td>
              <Td className="hidden max-w-[20rem] lg:table-cell">
                <span className="line-clamp-2 text-sm text-steel-600">{c.location ?? "—"}</span>
              </Td>
              <Td className="whitespace-nowrap">
                {c.clientPhone ? (
                  <a href={`tel:${c.clientPhone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 hover:underline">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-steel-400" aria-hidden /> {c.clientPhone}
                  </a>
                ) : <span className="text-steel-400">sin número</span>}
              </Td>
              <Td>
                {c.estibas.length ? (
                  <ul className="grid gap-1.5">
                    {c.estibas.map((e) => {
                      const barata = c.estibas.length > 1 && e.costPerTon !== null && e.costPerTon === masBarata(c.estibas);
                      return (
                        <li key={e.id} className="text-sm leading-tight">
                          <span className={barata ? "font-semibold" : undefined}>{e.name ?? "Sin nombre"}</span>
                          {e.costPerTon && <span className="tabular text-steel-600"> · {formatMoney(e.costPerTon, "PEN")}/t</span>}
                          {barata && <Badge tone="green" className="ml-1.5">La más barata</Badge>}
                          {e.phone && (
                            <a href={`tel:${e.phone.replace(/\s/g, "")}`} className="block text-xs text-steel-500 hover:underline">{e.phone}</a>
                          )}
                          {e.notes && <span className="block text-xs text-steel-500">{e.notes}</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : <span className="text-steel-400">sin estibador</span>}
              </Td>
              <Td className="whitespace-nowrap text-right font-medium tabular">
                {rangoPrecio(c.estibas) ?? <span className="font-normal text-brand-ink">falta el precio</span>}
              </Td>
              <Td className="hidden max-w-[22rem] 2xl:table-cell">
                <span className="line-clamp-2 text-xs text-steel-500">{c.notes ?? "—"}</span>
              </Td>
              {canManage && (
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <ProvinceClientModal
                      cliente={{
                        id: c.id, province: c.province, clientName: c.clientName, location: c.location,
                        clientPhone: c.clientPhone, stevedoreName: c.stevedoreName,
                        stevedorePhone: c.stevedorePhone, costPerTon: c.costPerTon, notes: c.notes,
                        estibas: c.estibas,
                      }}
                      provincias={provincias}
                      variant="icon"
                    />
                    <ConfirmButton
                      /* .bind y no una flecha: esta página es de servidor, y una función
                         creada aquí no puede cruzar al componente de cliente. */
                      action={toggleProvinceClient.bind(null, c.id)}
                      title={c.active ? "Dar de baja" : "Reactivar"}
                      message={c.active
                        ? `${c.clientName} dejará de figurar en el directorio. No se borra: se puede reactivar cuando vuelva a haber viajes.`
                        : `${c.clientName} volverá a figurar en el directorio.`}
                      confirmLabel={c.active ? "Dar de baja" : "Reactivar"}
                      confirmVariant={c.active ? "danger" : "primary"}
                      triggerVariant="ghost"
                      triggerLabel={c.active ? "Dar de baja" : "Reactivar"}
                      triggerTitle={c.active ? "Dar de baja" : "Reactivar"}
                      size="sm"
                    />
                  </div>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <p className="mt-3 text-xs text-steel-500">
        Se busca por el nombre del destinatario, que es como se pregunta: &ldquo;el viaje es para
        Comercial Jaén&rdquo;. Los dados de baja no se borran, siguen en el historial y se pueden reactivar.
      </p>

      <Pagination basePath="/clientes-provincia" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}

/** El precio más bajo entre las estibas que tienen precio. */
function masBarata(estibas: { costPerTon: string | null }[]) {
  const precios = estibas.map((e) => e.costPerTon).filter((p): p is string => p !== null);
  return precios.length ? precios.reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null;
}

/** "S/ 35.00", o "S/ 30.00 – S/ 45.00" cuando hay varias con precios distintos. */
function rangoPrecio(estibas: { costPerTon: string | null }[]) {
  const precios = estibas.map((e) => e.costPerTon).filter((p): p is string => p !== null).map(Number);
  if (!precios.length) return null;
  const min = Math.min(...precios), max = Math.max(...precios);
  return min === max
    ? formatMoney(min.toFixed(2), "PEN")
    : `${formatMoney(min.toFixed(2), "PEN")} – ${formatMoney(max.toFixed(2), "PEN")}`;
}
