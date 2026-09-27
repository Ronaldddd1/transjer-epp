"use client";

import { Mail, PlugZap, RefreshCw, Power, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { activateMailbox, deactivateMailbox, renewMailbox, syncMailboxNow, testMailbox } from "@/actions/mailbox";
import { Badge } from "@/components/ui/badge";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/action-result";
import { formatDateTime } from "@/lib/utils";

function ActionButton({ action, label, icon, variant = "outline" }: {
  action: () => Promise<ActionResult>; label: string; icon: ReactNode; variant?: ButtonVariant;
}) {
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size="sm"
      loading={pending}
      onClick={() => start(async () => {
        const res = await action();
        notify(res.ok ? "success" : "error", res.message);
        if (res.ok) router.refresh();
      })}
    >
      {!pending && icon} {label}
    </Button>
  );
}

export type MailboxStatus = {
  configured: boolean;
  missing: string[];
  mailbox: string | null;
  notificationUrl: string | null;
  active: boolean;
  expiresAt: string | null;
  minutesToExpiry: number | null;
  lastSyncAt: string | null;
  lastMessageAt: string | null;
  lastError: string | null;
};

export function MailboxPanel({ status, canConfigure }: { status: MailboxStatus; canConfigure: boolean }) {
  const horasRestantes = status.minutesToExpiry !== null ? Math.round(status.minutesToExpiry / 60) : null;
  const porCaducar = horasRestantes !== null && horasRestantes < 24;

  return (
    <section className="mb-6 rounded-lg border border-steel-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-steel-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Mail className="h-5 w-5 text-steel-400" aria-hidden />
          <h2 className="font-display text-lg font-semibold text-ink">Lectura automática del correo</h2>
          {status.active ? <Badge tone="green">Activa</Badge> : status.configured ? <Badge tone="yellow">Inactiva</Badge> : <Badge>Sin configurar</Badge>}
        </div>
        {/* Sin credenciales no se ofrecen acciones: solo fallarían. */}
        <div className="flex flex-wrap gap-2">
          {status.configured && <ActionButton action={syncMailboxNow} label="Revisar ahora" icon={<RefreshCw className="h-4 w-4" />} />}
          {status.configured && canConfigure && <ActionButton action={testMailbox} label="Probar conexión" icon={<PlugZap className="h-4 w-4" />} />}
          {status.configured && canConfigure && !status.active && <ActionButton action={activateMailbox} label="Activar avisos" icon={<Zap className="h-4 w-4" />} variant="primary" />}
          {status.configured && canConfigure && status.active && <ActionButton action={renewMailbox} label="Renovar" icon={<RefreshCw className="h-4 w-4" />} />}
          {status.configured && canConfigure && status.active && (
            <ConfirmButton
              action={deactivateMailbox}
              title="Desactivar lectura automática"
              message="Las facturas que lleguen al buzón dejarán de registrarse solas y habrá que hacerlo a mano."
              confirmLabel="Desactivar"
              triggerVariant="ghost"
              triggerLabel={<><Power className="h-4 w-4" /> Desactivar</>}
              triggerTitle="Desactivar"
            />
          )}
        </div>
      </header>

      <div className="px-4 py-3 text-sm">
        {!status.configured ? (
          <div className="text-steel-600">
            <p>
              Todavía no está conectada con el buzón. Para activarla, un administrador debe registrar la aplicación
              en Microsoft 365 y cargar estas variables de entorno en Vercel:
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {status.missing.map((m) => <li key={m}><code className="rounded bg-steel-100 px-1.5 py-0.5 text-xs">{m}</code></li>)}
            </ul>
            <p className="mt-2">Mientras tanto, las facturas se registran con <strong>Cargar XML</strong> o <strong>Nueva factura</strong>.</p>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-steel-500">Buzón</dt>
              <dd className="text-ink-800">{status.mailbox}</dd>
            </div>
            <div>
              <dt className="text-xs text-steel-500">Avisos vigentes hasta</dt>
              <dd className={porCaducar ? "font-semibold text-red-700" : "text-ink-800"}>
                {status.expiresAt ? formatDateTime(status.expiresAt) : "—"}
                {horasRestantes !== null && <span className="ml-1 text-xs text-steel-500">({horasRestantes} h)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-steel-500">Última revisión</dt>
              <dd className="text-ink-800">{status.lastSyncAt ? formatDateTime(status.lastSyncAt) : "Nunca"}</dd>
            </div>
            <div>
              <dt className="text-xs text-steel-500">Último correo leído</dt>
              <dd className="text-ink-800">{status.lastMessageAt ? formatDateTime(status.lastMessageAt) : "—"}</dd>
            </div>
          </dl>
        )}

        {status.lastError && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <strong>Último error:</strong> {status.lastError}
          </p>
        )}
        {status.configured && !status.active && (
          <p className="mt-3 rounded-md border border-brand/60 bg-brand-soft px-3 py-2 text-sm text-[#7A5A00]">
            Las credenciales están cargadas, pero los avisos no están activos. Pulsa <strong>Activar avisos</strong> para
            que cada correo que llegue se registre solo. La revisión diaria seguirá funcionando igualmente.
          </p>
        )}
      </div>
    </section>
  );
}
