"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "./button";
import { Modal } from "./modal";
import { useToast } from "./toast";

type RenderProps = { errors: Record<string, string>; pending: boolean };

type Props = {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  action: (formData: FormData) => Promise<ActionResult>;
  children: (props: RenderProps) => ReactNode;
  size?: "sm" | "md" | "lg";
  defaultOpen?: boolean;
  onClosed?: () => void;
};

/** Modal con formulario conectado a una server action: valida, muestra errores por campo y refresca los datos. */
export function FormModal({ trigger, title, description, submitLabel, action, children, size, defaultOpen = false, onClosed }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();
  const formId = useId();

  const close = () => {
    if (pending) return;
    setOpen(false);
    setErrors({});
    setFormKey((k) => k + 1);
    onClosed?.();
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await action(fd);
      if (res.ok) {
        notify("success", res.message);
        setOpen(false);
        setErrors({});
        setFormKey((k) => k + 1);
        onClosed?.();
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        notify("error", res.message);
      }
    });
  };

  return (
    <>
      {trigger(() => setOpen(true))}
      <Modal
        open={open}
        onClose={close}
        title={title}
        description={description}
        size={size}
        footer={
          <>
            <Button variant="outline" onClick={close} disabled={pending}>Cancelar</Button>
            <Button type="submit" form={formId} loading={pending}>{submitLabel}</Button>
          </>
        }
      >
        <form key={formKey} id={formId} onSubmit={onSubmit} noValidate className="grid gap-4">
          {children({ errors, pending })}
        </form>
      </Modal>
    </>
  );
}
