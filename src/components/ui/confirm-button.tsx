"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonVariant } from "./button";
import { Modal } from "./modal";
import { useToast } from "./toast";

type Props = {
  action: () => Promise<ActionResult>;
  title: string;
  message: string;
  confirmLabel: string;
  confirmVariant?: ButtonVariant;
  triggerVariant?: ButtonVariant;
  triggerLabel: ReactNode;
  triggerTitle?: string;
  size?: "sm" | "md" | "icon";
};

/** Botón que pide confirmación antes de ejecutar una acción crítica. */
export function ConfirmButton({ action, title, message, confirmLabel, confirmVariant = "danger", triggerVariant = "ghost", triggerLabel, triggerTitle, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();

  const run = () =>
    start(async () => {
      const res = await action();
      notify(res.ok ? "success" : "error", res.message);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button variant={triggerVariant} size={size} onClick={() => setOpen(true)} title={triggerTitle} aria-label={triggerTitle}>
        {triggerLabel}
      </Button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={title}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
            <Button variant={confirmVariant} onClick={run} loading={pending} data-autofocus>{confirmLabel}</Button>
          </>
        }
      >
        <p className="text-[15px] text-ink-700">{message}</p>
      </Modal>
    </>
  );
}
