"use client";

import { AlertCircle } from "lucide-react";
import { startTransition, useActionState } from "react";
import { loginAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form
      // Sin method, un formulario HTML se envía por GET. Mientras el JavaScript de la
      // página todavía no carga —o si falla—, el navegador manda el formulario igual, y
      // por GET la contraseña se va escrita en la URL: queda en el historial del
      // navegador y en los registros del servidor. Con POST no viaja en la dirección.
      method="post"
      className="mt-8 grid gap-4"
      onSubmit={(e) => {
        // Se evita el reinicio automático del formulario para no borrar el usuario tras un error.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      <input type="hidden" name="next" value={next} />
      {state?.error && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {state.error}
        </div>
      )}
      <Field label="Usuario o correo" name="identifier">
        <Input name="identifier" autoComplete="username" autoCapitalize="none" required autoFocus />
      </Field>
      <Field label="Contraseña" name="password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" loading={pending} className="mt-2 h-11 w-full justify-center text-base">
        Ingresar
      </Button>
    </form>
  );
}
