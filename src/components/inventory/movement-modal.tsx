"use client";

import { ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { createMovement } from "@/actions/movements";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { MovementType } from "@/db/schema";
import { cn } from "@/lib/utils";

export type ProductOption = { id: string; code: string; name: string; size: string | null; stock: number; unit: string };

const REASONS: Record<MovementType, string[]> = {
  ENTRADA: ["Compra", "Devolución", "Donación", "Traslado desde otra sede", "Otro"],
  SALIDA: ["Entrega a personal", "Merma / deterioro", "Traslado a otra sede", "Vencimiento", "Otro"],
  AJUSTE: ["Inventario físico", "Corrección de registro", "Otro"],
};
const TITLES: Record<MovementType, string> = { ENTRADA: "Registrar entrada", SALIDA: "Registrar salida", AJUSTE: "Registrar ajuste" };
const ICONS = { ENTRADA: ArrowDownToLine, SALIDA: ArrowUpFromLine, AJUSTE: SlidersHorizontal };

type Props = {
  products: ProductOption[];
  type: MovementType;
  productId?: string;
  defaultOpen?: boolean;
  trigger?: "button" | "compact";
  variant?: ButtonVariant;
  label?: ReactNode;
};

export function MovementModal({ products, type, productId, defaultOpen, trigger = "button", variant = "outline", label }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [selected, setSelected] = useState(productId ?? "");
  // Al cerrar vuelve a su estado inicial: si no, el siguiente movimiento abre con el
  // producto del anterior ya elegido y es fácil registrarlo sobre el que no era.
  const limpiar = () => setSelected(productId ?? "");
  const product = products.find((p) => p.id === selected);
  const Icon = ICONS[type];

  return (
    <FormModal
      title={TITLES[type]}
      description={
        type === "AJUSTE"
          ? "Ingresa el stock físico contado. El sistema calcula la diferencia."
          : type === "SALIDA" ? "Para entregas a un trabajador usa el módulo Entregas." : undefined
      }
      submitLabel={TITLES[type]}
      defaultOpen={defaultOpen}
      action={createMovement}
      onClosed={() => {
        limpiar();
        if (defaultOpen) router.replace(pathname, { scroll: false });
      }}
      trigger={(open) => (
        <Button variant={variant} size={trigger === "compact" ? "sm" : "md"} onClick={open} title={TITLES[type]} aria-label={trigger === "compact" ? TITLES[type] : undefined}>
          <Icon className="h-4 w-4" />
          {trigger === "compact" ? <span className="sr-only 2xl:not-sr-only">{label ?? TITLES[type].replace("Registrar ", "")}</span> : (label ?? TITLES[type])}
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <input type="hidden" name="type" value={type} />
          <Field label="Producto" name="productId" required error={errors.productId}>
            <Select name="productId" value={selected} onChange={(e) => setSelected(e.target.value)} invalid={!!errors.productId} disabled={!!productId}>
              <option value="" disabled>Selecciona un EPP…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.name}{p.size ? ` (${p.size})` : ""} — stock {p.stock}</option>
              ))}
            </Select>
            {productId && <input type="hidden" name="productId" value={productId} />}
          </Field>
          {product && (
            <p className={cn("rounded-md px-3 py-2 text-sm", product.stock === 0 ? "bg-red-50 text-red-700" : "bg-steel-100 text-steel-600")}>
              Stock actual: <strong className="text-ink">{product.stock}</strong> {product.unit.toLowerCase()}(s)
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={type === "AJUSTE" ? "Stock contado" : "Cantidad"}
              name="quantity" required error={errors.quantity}
              hint={type === "SALIDA" && product ? `Máximo ${product.stock}` : undefined}
            >
              <Input
                name="quantity" type="number" inputMode="numeric" step={1}
                min={type === "AJUSTE" ? 0 : 1}
                max={type === "SALIDA" && product ? product.stock : undefined}
                defaultValue={type === "AJUSTE" ? product?.stock : undefined}
                key={type === "AJUSTE" ? selected : "qty"}
                invalid={!!errors.quantity}
              />
            </Field>
            <Field label="Motivo" name="reason" required error={errors.reason}>
              <Select name="reason" defaultValue={REASONS[type][0]}>
                {REASONS[type].map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Observaciones" name="notes" error={errors.notes} hint="Ej.: número de guía, proveedor, detalle del conteo.">
            <Textarea name="notes" rows={2} maxLength={1000} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
