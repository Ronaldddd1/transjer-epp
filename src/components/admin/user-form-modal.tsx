"use client";

import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { changeUserPassword, createUser, updateUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { Role } from "@/db/schema";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/permissions";

type UserData = { id: string; name: string; username: string; email: string; role: Role };

export function UserFormModal({ user }: { user?: UserData }) {
  const editing = !!user;
  // Se explica en el momento qué puede hacer el rol elegido.
  const [role, setRole] = useState<Role>(user?.role ?? "USUARIO");
  return (
    <FormModal
      title={editing ? `Editar ${user.username}` : "Nuevo usuario"}
      submitLabel={editing ? "Guardar cambios" : "Crear usuario"}
      action={(fd) => (editing ? updateUser(user.id, fd) : createUser(fd))}
      trigger={(open) => editing
        ? <Button variant="ghost" size="sm" onClick={open} title="Editar"><Pencil className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Editar</span></Button>
        : <Button onClick={open}><UserPlus className="h-4 w-4" /> Nuevo usuario</Button>}
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre completo" name="name" required error={errors.name} className="sm:col-span-2">
            <Input name="name" defaultValue={user?.name} invalid={!!errors.name} />
          </Field>
          <Field label="Usuario" name="username" required error={errors.username} hint="Para iniciar sesión. Ej.: rsantos">
            <Input name="username" defaultValue={user?.username} autoCapitalize="none" invalid={!!errors.username} />
          </Field>
          <Field label="Correo" name="email" required error={errors.email}>
            <Input name="email" type="email" defaultValue={user?.email} invalid={!!errors.email} />
          </Field>
          <Field label="Rol" name="role" required error={errors.role} className={editing ? "sm:col-span-2" : ""}>
            <Select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm text-steel-600 sm:col-span-2">
            <strong className="text-ink">{ROLE_LABELS[role]}:</strong> {ROLE_DESCRIPTIONS[role]}
          </p>
          {!editing && (
            <Field label="Contraseña" name="password" required error={errors.password} hint="Mínimo 8 caracteres.">
              <Input name="password" type="password" autoComplete="new-password" invalid={!!errors.password} />
            </Field>
          )}
        </div>
      )}
    </FormModal>
  );
}

export function PasswordModal({ user }: { user: { id: string; username: string } }) {
  return (
    <FormModal
      title="Cambiar contraseña"
      description={`Nueva contraseña para ${user.username}.`}
      submitLabel="Cambiar contraseña"
      size="sm"
      action={(fd) => changeUserPassword(user.id, fd)}
      trigger={(open) => (
        <Button variant="ghost" size="sm" onClick={open} title="Cambiar contraseña" aria-label="Cambiar contraseña">
          <KeyRound className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Contraseña</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <Field label="Nueva contraseña" name="password" required error={errors.password} hint="Mínimo 8 caracteres.">
          <Input name="password" type="password" autoComplete="new-password" invalid={!!errors.password} />
        </Field>
      )}
    </FormModal>
  );
}
