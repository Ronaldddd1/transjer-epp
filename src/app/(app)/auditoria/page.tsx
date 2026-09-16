import type { Metadata } from "next";
import { AuditDetail } from "@/components/admin/audit-detail";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { AUDIT_MODULES } from "@/lib/audit";
import { requirePageUser } from "@/lib/auth";
import { first, formatDateTime, isYmd, pageParams, type SearchParams } from "@/lib/utils";
import { getUserOptions, listAudit } from "@/server/queries";

export const metadata: Metadata = { title: "Auditoría" };

const MODULE_LABEL: Record<string, string> = {
  PRODUCTOS: "Productos", CATEGORIAS: "Categorías", TRABAJADORES: "Trabajadores", MOVIMIENTOS: "Movimientos",
  ENTREGAS: "Entregas", USUARIOS: "Usuarios", SESION: "Sesión",
};

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("audit.view");
  const sp = await searchParams;
  const { page, pageSize, offset } = pageParams(sp, 25);
  const from = first(sp.from);
  const to = first(sp.to);
  const [{ rows, total }, users] = await Promise.all([
    listAudit({
      module: first(sp.module), userId: first(sp.user), q: first(sp.q),
      from: isYmd(from) ? from : undefined, to: isYmd(to) ? to : undefined, limit: pageSize, offset,
    }),
    getUserOptions(),
  ]);

  return (
    <>
      <PageHeader title="Auditoría" description="Registro automático de quién hizo cada cambio, cuándo y qué información se modificó." />
      <FilterBar
        searchPlaceholder="Buscar en la descripción"
        filters={[
          { type: "select", name: "module", label: "Módulo", options: AUDIT_MODULES.map((m) => ({ value: m, label: MODULE_LABEL[m] })) },
          { type: "select", name: "user", label: "Usuario", options: users.map((u) => ({ value: u.id, label: u.name })) },
          { type: "date", name: "from", label: "Desde" },
          { type: "date", name: "to", label: "Hasta" },
        ]}
      />
      <TableShell>
        <thead>
          <tr><Th>Fecha y hora</Th><Th>Usuario</Th><Th>Módulo</Th><Th>Acción</Th><Th>Descripción</Th><Th>Registro</Th><Th>Cambios</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={7} title="No hay registros de auditoría con estos filtros" />}
          {rows.map((a) => (
            <Tr key={a.id}>
              <Td className="whitespace-nowrap tabular text-steel-600">{formatDateTime(a.createdAt)}</Td>
              <Td className="font-medium">{a.userName ?? "Sistema"}</Td>
              <Td><Badge>{MODULE_LABEL[a.module] ?? a.module}</Badge></Td>
              <Td className="text-steel-600">{a.action.charAt(0) + a.action.slice(1).toLowerCase()}</Td>
              <Td className="min-w-[18rem] max-w-xl whitespace-normal">{a.description}</Td>
              <Td className="font-mono text-[11px] text-steel-400" title={a.recordId ?? undefined}>{a.recordId?.slice(0, 8) ?? "—"}</Td>
              <Td><AuditDetail description={a.description} oldData={a.oldData} newData={a.newData} /></Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
      <Pagination basePath="/auditoria" searchParams={sp} page={page} pageSize={pageSize} total={total} />
    </>
  );
}
