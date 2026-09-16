import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { deleteUser, toggleUser } from "@/actions/users";
import { PasswordModal, UserFormModal } from "@/components/admin/user-form-modal";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { PageHeader } from "@/components/ui/page-header";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/permissions";
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
        description="Personas con acceso al sistema. Administrador gestiona todo; Usuario consulta y registra movimientos y entregas."
        actions={<UserFormModal />}
      />
      <TableShell>
        <thead>
          <tr><Th>Nombre</Th><Th>Usuario</Th><Th>Correo</Th><Th>Rol</Th><Th>Estado</Th><Th>Creado</Th><Th className="text-right">Acciones</Th></tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const self = u.id === me.id;
            return (
              <Tr key={u.id}>
                <Td className="font-semibold">{u.name}{self && <span className="ml-2 text-xs font-normal text-steel-500">(tú)</span>}</Td>
                <Td className="tabular">{u.username}</Td>
                <Td className="text-steel-600">{u.email}</Td>
                <Td><Badge tone={u.role === "ADMIN" ? "dark" : "neutral"}>{ROLE_LABELS[u.role]}</Badge></Td>
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
