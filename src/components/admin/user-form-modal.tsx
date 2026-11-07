"use client";

import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { useState } from "react";
import { changeUserPassword, createUser, updateUser } from "@/actions/users";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { Role } from "@/db/schema";
import {
  accesosDesdeRol, MODULOS, nivelesDe, ROLE_LABELS, type ModuleAccess, type Nivel,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

type UserData = {
  id: string; name: string; username: string; email: string; role: Role;
  moduleAccess: ModuleAccess | null;
};

const NIVEL_LABEL: Record<Nivel, string> = { none: "Sin acceso", view: "Solo ver", edit: "Ver y editar" };

/**
 * Crear o editar un usuario.
 *
 * Ya no se elige un rol armado: o es administrador, que entra a todo, o se marca módulo
 * por módulo si no entra, si solo mira, o si mira y edita. Al editar a alguien creado con
 * rol, la grilla aparece con lo que ese rol le daba, para que no pierda nada sin querer.
 */
export function UserFormModal({ user }: { user?: UserData }) {
  const editing = !!user;
  return (
    <FormModal
      title={editing ? `Editar ${user.username}` : "Nuevo usuario"}
      submitLabel={editing ? "Guardar cambios" : "Crear usuario"}
      size="lg"
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
          {!editing && (
            <Field label="Contraseña" name="password" required error={errors.password} hint="Mínimo 8 caracteres." className="sm:col-span-2">
              <Input name="password" type="password" autoComplete="new-password" invalid={!!errors.password} />
            </Field>
          )}

          <AccesosUsuario user={user} />
        </div>
      )}
    </FormModal>
  );
}

/**
 * Administrador o módulo por módulo. Va aparte para que su estado se reinicie cada vez
 * que se abre la ventana: si alguien cambia accesos y cancela, al volver a abrir no deben
 * seguir ahí los cambios descartados.
 */
function AccesosUsuario({ user }: { user?: UserData }) {
  const editing = !!user;
  const [admin, setAdmin] = useState(user?.role === "ADMIN");
  const [accesos, setAccesos] = useState<ModuleAccess>(() =>
    user?.moduleAccess ?? (user && user.role !== "ADMIN" ? accesosDesdeRol(user.role) : {}));

  const secciones = Array.from(new Set(MODULOS.map((m) => m.seccion)));
  const marcados = MODULOS.filter((m) => (accesos[m.key] ?? "none") !== "none").length;

  return (
    <>
          <input type="hidden" name="role" value={admin ? "ADMIN" : "USUARIO"} />
      <label className="flex items-start gap-3 rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={admin}
          onChange={(e) => setAdmin(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-ink"
        />
        <span>
          <strong className="text-ink">Administrador</strong>
          <span className="block text-steel-600">Entra a todos los módulos y puede crear usuarios.</span>
        </span>
      </label>

      {!admin && (
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink">
            Módulos a los que entra <span className="font-normal text-steel-500">({marcados} con acceso)</span>
          </legend>
          <div className="overflow-hidden rounded-md border border-steel-200">
            {secciones.map((seccion) => (
              <div key={seccion}>
                <p className="bg-steel-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-steel-500">{seccion}</p>
                {MODULOS.filter((m) => m.seccion === seccion).map((m) => {
                  const actual = accesos[m.key] ?? "none";
                  return (
                    <div key={m.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-steel-100 px-3 py-2">
                      <span className="text-sm text-ink">{m.label}</span>
                      <div role="radiogroup" aria-label={m.label} className="flex gap-1">
                        {(["none", "view", "edit"] as Nivel[]).map((n) => {
                          const posible = nivelesDe(m).includes(n);
                          const elegido = actual === n;
                          return (
                            <label
                              key={n}
                              className={cn(
                                "cursor-pointer rounded border px-2 py-1 text-xs",
                                !posible && "pointer-events-none invisible",
                                elegido
                                  ? n === "none" ? "border-steel-400 bg-steel-200 text-ink" : n === "view" ? "border-sky-600 bg-sky-600 text-white" : "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-steel-300 bg-white text-steel-600 hover:border-steel-500",
                              )}
                            >
                              <input
                                type="radio"
                                name={`acceso_${m.key}`}
                                value={n}
                                checked={elegido}
                                disabled={!posible}
                                onChange={() => setAccesos((a) => ({ ...a, [m.key]: n }))}
                                className="sr-only"
                              />
                              {NIVEL_LABEL[n]}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {editing && !user.moduleAccess && user.role !== "ADMIN" && (
            <p className="mt-2 text-xs text-steel-500">
              Este usuario se creó con el rol <strong>{ROLE_LABELS[user.role]}</strong>. La grilla muestra lo que ese rol le daba;
              al guardar pasa a tener estos accesos.
            </p>
          )}
        </fieldset>
      )}
    </>
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
