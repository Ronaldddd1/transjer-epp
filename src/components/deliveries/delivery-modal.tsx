"use client";

import { HardHat } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createDelivery } from "@/actions/deliveries";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { ProductOption } from "@/components/inventory/movement-modal";

export type EmployeeOption = { id: string; dni: string; firstName: string; lastName: string; position: string; area: string };

export const DELIVERY_REASONS = ["Entrega inicial", "Renovación", "Cambio por deterioro", "Reposición por pérdida", "Cambio de talla", "Otro"];

type Props = {
  employees: EmployeeOption[];
  products: ProductOption[];
  today: string;
  userName: string;
  employeeId?: string;
  defaultOpen?: boolean;
  variant?: ButtonVariant;
};

export function DeliveryModal({ employees, products, today, userName, employeeId, defaultOpen, variant = "primary" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [empId, setEmpId] = useState(employeeId ?? "");
  const [prodId, setProdId] = useState("");
  const emp = employees.find((e) => e.id === empId);
  const prod = products.find((p) => p.id === prodId);

  return (
    <FormModal
      title="Registrar entrega"
      description="Se descontará el stock automáticamente y quedará en el historial del trabajador."
      submitLabel="Registrar entrega"
      size="lg"
      defaultOpen={defaultOpen}
      onClosed={() => { setProdId(""); if (defaultOpen) router.replace(pathname, { scroll: false }); }}
      action={createDelivery}
      trigger={(open) => (
        <Button variant={variant} onClick={open}><HardHat className="h-4 w-4" /> Registrar entrega</Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trabajador" name="employeeId" required error={errors.employeeId} className="sm:col-span-2">
            <Select name="employeeId" value={empId} onChange={(e) => setEmpId(e.target.value)} invalid={!!errors.employeeId} disabled={!!employeeId}>
              <option value="" disabled>{employees.length ? "Selecciona un trabajador…" : "No hay trabajadores activos"}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} — DNI {e.dni}</option>)}
            </Select>
            {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
          </Field>
          <dl className="grid grid-cols-3 gap-2 rounded-md bg-steel-100 px-3 py-2.5 text-sm sm:col-span-2">
            {[["DNI", emp?.dni], ["Cargo", emp?.position], ["Área", emp?.area]].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-steel-500">{k}</dt>
                <dd className="truncate font-medium">{v ?? "—"}</dd>
              </div>
            ))}
          </dl>

          <Field label="EPP" name="productId" required error={errors.productId} className="sm:col-span-2">
            <Select name="productId" value={prodId} onChange={(e) => setProdId(e.target.value)} invalid={!!errors.productId}>
              <option value="" disabled>Selecciona un EPP…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id} disabled={p.stock === 0}>
                  {p.name}{p.size ? ` · Talla ${p.size}` : ""} — {p.stock === 0 ? "agotado" : `stock ${p.stock}`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Talla" name="size-display">
            <Input id="size-display" value={prod?.size ?? "—"} readOnly disabled />
          </Field>
          <Field label="Cantidad" name="quantity" required error={errors.quantity} hint={prod ? `Disponible: ${prod.stock}` : undefined}>
            <Input name="quantity" type="number" inputMode="numeric" min={1} max={prod?.stock} step={1} defaultValue={1} invalid={!!errors.quantity} />
          </Field>
          <Field label="Fecha de entrega" name="deliveryDate" required error={errors.deliveryDate}>
            <Input name="deliveryDate" type="date" defaultValue={today} max={today} invalid={!!errors.deliveryDate} />
          </Field>
          <Field label="Motivo de entrega" name="reason" required error={errors.reason}>
            <Select name="reason" defaultValue={DELIVERY_REASONS[0]}>
              {DELIVERY_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" rows={2} maxLength={1000} />
          </Field>
          <p className="text-sm text-steel-500 sm:col-span-2">Responsable: <strong className="text-ink">{userName}</strong></p>
        </div>
      )}
    </FormModal>
  );
}
