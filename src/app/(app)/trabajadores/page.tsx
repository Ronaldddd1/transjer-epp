import { Eye, UserCheck, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { toggleEmployee } from "@/actions/employees";
import { EmployeeFormModal } from "@/components/employees/employee-form-modal";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { first, formatDate, pageParams, type SearchParams } from "@/lib/utils";
import { getAreaOptions, listEmployees } from "@/server/queries";

export const metadata: Metadata = { title: "Trabajadores" };

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("employees.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp);
  const canManage = can(user.role, "employees.manage");
  const [{ rows, total }, areas] = await Promise.all([
    listEmployees({ q: first(sp.q), area: first(sp.area), state: first(sp.state), limit: pageSize, offset }),
    getAreaOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="Trabajadores"
        description="Personal que recibe EPP. Los trabajadores con historial se desactivan en lugar de eliminarse."
        actions={canManage && <EmployeeFormModal areas={areas} />}
      />
      <FilterBar
        searchPlaceholder="Buscar por nombre, DNI o cargo"
        filters={[
          { type: "select", name: "area", label: "Área", allLabel: "Todas", options: areas.map((a) => ({ value: a, label: a })) },
          { type: "select", name: "state", label: "Estado", allLabel: "Activos", options: [{ value: "inactivos", label: "Inactivos" }, { value: "todos", label: "Todos" }] },
        ]}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>DNI</Th><Th>Trabajador</Th><Th>Cargo</Th><Th>Área</Th><Th className="hidden 2xl:table-cell">Teléfono</Th><Th>Ingreso</Th>
            <Th className="text-right">EPP recibidos</Th><Th>Estado</Th><Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <EmptyRow colSpan={9} title="No hay trabajadores para mostrar" hint={canManage ? "Registra al personal con Nuevo trabajador." : undefined} />
          )}
          {rows.map((e) => (
            <Tr key={e.id}>
              <Td className="whitespace-nowrap tabular">{e.dni}</Td>
              <Td>
                <div className="flex items-center gap-2">
                  <Link href={`/trabajadores/${e.id}`} className="font-semibold hover:underline">{e.lastName}, {e.firstName}</Link>
                  {e.isDemo && <DemoBadge />}
                </div>
              </Td>
              <Td>{e.position}</Td>
              <Td className="text-steel-600">{e.area}</Td>
              <Td className="hidden text-steel-600 2xl:table-cell">{e.phone ?? "—"}</Td>
              <Td className="whitespace-nowrap text-steel-600 tabular">{formatDate(e.hireDate)}</Td>
              <Td className="text-right font-display text-lg font-bold tabular">{e.delivered}</Td>
              <Td>{e.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
              <Td>
                <div className="flex justify-end gap-0.5">
                  <ButtonLink href={`/trabajadores/${e.id}`} variant="ghost" size="sm" title="Ver historial">
                    <Eye className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Ver historial</span>
                  </ButtonLink>
                  {canManage && <EmployeeFormModal employee={e} areas={areas} variant="icon" />}
                  {canManage && (
                    <ConfirmButton
                      action={toggleEmployee.bind(null, e.id)}
                      title={e.active ? "Desactivar trabajador" : "Activar trabajador"}
                      message={e.active
                        ? `${e.firstName} ${e.lastName} ya no aparecerá al registrar entregas. Su historial se conserva.`
                        : `${e.firstName} ${e.lastName} volverá a estar disponible para registrar entregas.`}
                      confirmLabel={e.active ? "Desactivar" : "Activar"}
                      confirmVariant={e.active ? "danger" : "primary"}
                      triggerTitle={e.active ? "Desactivar" : "Activar"}
                      triggerLabel={e.active ? <UserX className="h-4 w-4 text-red-600" /> : <UserCheck className="h-4 w-4 text-emerald-700" />}
                    />
                  )}
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination basePath="/trabajadores" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
