import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { deleteUser, toggleUser } from "@/actions/users";
import { PasswordModal, UserFormModal } from "@/components/admin/user-form-modal";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/ui/page-header";
import { ExportTable } from "@/components/ui/export-table";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { MODULOS, ROLE_LABELS, type ModuleAccess } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { listUsers } from "@/server/queries";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsersPage() {
  const me = await requirePageUser("users.manage");
  const rows = await listUsers();
  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Personas con acceso al sistema. El administrador entra a todo; a los demás se les marca módulo por módulo si no entran, si solo miran o si también editan."
        actions={<><ExportTable tabla="usuarios" /><UserFormModal /></>}
      />
      <TableShell>
        <thead>
          <tr><Th>Nombre</Th><Th>Usuario</Th><Th>Correo</Th><Th>Accesos</Th><Th>Estado</Th><Th>Creado</Th><Th className="text-right">Acciones</Th></tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const self = u.id === me.id;
            return (
              <Tr key={u.id}>
                <Td className="font-semibold">{u.name}{self && <span className="ml-2 text-xs font-normal text-steel-500">(tú)</span>}</Td>
                <Td className="tabular">{u.username}</Td>
                <Td className="text-steel-600">{u.email}</Td>
                <Td>
                  {u.role === "ADMIN" ? (
                    <Badge tone="dark">Administrador</Badge>
                  ) : u.moduleAccess ? (
                    <span className="text-sm text-steel-600" title={resumenAccesos(u.moduleAccess)}>
                      {MODULOS.filter((m) => (u.moduleAccess?.[m.key] ?? "none") !== "none").length} módulo(s)
                      <span className="block max-w-[16rem] truncate text-xs text-steel-500">{resumenAccesos(u.moduleAccess)}</span>
                    </span>
                  ) : (
                    <span title="Creado con rol: al editarlo pasa a accesos por módulo">
                      <Badge tone="neutral">{ROLE_LABELS[u.role]}</Badge>
                    </span>
                  )}
                </Td>
                <Td>{u.active ? <Badge tone="green">Activo</Badge> : <Badge tone="red">Inactivo</Badge>}</Td>
                <Td className="whitespace-nowrap text-steel-500">{formatDate(u.createdAt)}</Td>
                <Td>
                  <div className="flex justify-end gap-0.5">
                    <UserFormModal user={u} />
                    <PasswordModal user={u} />
                    {!self && (
                      <>
                        <ConfirmButton
                          action={toggleUser.bind(null, u.id)}
                          title={u.active ? "Desactivar usuario" : "Activar usuario"}
                          message={u.active ? `${u.name} no podrá iniciar sesión. Su historial se conserva.` : `${u.name} podrá volver a iniciar sesión.`}
                          confirmLabel={u.active ? "Desactivar" : "Activar"}
                          confirmVariant={u.active ? "danger" : "primary"}
                          triggerLabel={u.active ? "Desactivar" : "Activar"}
                        />
                        <ConfirmButton
                          action={deleteUser.bind(null, u.id)}
                          title="Eliminar usuario"
                          message={`¿Estás seguro de eliminar a ${u.name}? Solo es posible si no ha registrado movimientos; en ese caso, desactívalo.`}
                          confirmLabel="Eliminar"
                          triggerTitle="Eliminar"
                          triggerLabel={<Trash2 className="h-4 w-4 text-red-600" />}
                        />
                      </>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>
    </>
  );
}

/** "Inventario (editar), Asistencia (ver)…" para la columna de accesos. */
function resumenAccesos(accesos: ModuleAccess) {
  return MODULOS.filter((m) => (accesos[m.key] ?? "none") !== "none")
    .map((m) => `${m.label} (${accesos[m.key] === "edit" ? "editar" : "ver"})`).join(", ");
}
