"use client";

import { Pencil, Plus } from "lucide-react";
import { createProduct, updateProduct } from "@/actions/products";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import type { ProductRow } from "@/server/queries";

export const UNITS = ["Unidad", "Par", "Caja", "Paquete", "Juego", "Rollo"];
export const SIZES = ["Única", "XS", "S", "M", "L", "XL", "XXL", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45"];

type Option = { id: string; name: string };

export function ProductFormModal({ categories, product }: { categories: Option[]; product?: ProductRow }) {
  const editing = !!product;
  return (
    <FormModal
      title={editing ? `Editar ${product.code}` : "Nuevo EPP"}
      description={editing ? "El stock no se edita aquí: usa Registrar entrada, salida o ajuste." : "Los campos con * son obligatorios."}
      submitLabel={editing ? "Guardar cambios" : "Registrar EPP"}
      size="lg"
      action={(fd) => (editing ? updateProduct(product.id, fd) : createProduct(fd))}
      trigger={(open) =>
        editing ? (
          <Button variant="ghost" size="sm" onClick={open} title="Editar"><Pencil className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Editar</span></Button>
        ) : (
          <Button onClick={open}><Plus className="h-4 w-4" /> Nuevo EPP</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" name="code" required error={errors.code} hint={editing ? "El código no se puede cambiar." : "Ejemplo: EPP-010"}>
            <Input name="code" defaultValue={product?.code} disabled={editing} invalid={!!errors.code} className="uppercase" maxLength={30} />
          </Field>
          <Field label="Nombre del producto" name="name" required error={errors.name}>
            <Input name="name" defaultValue={product?.name} invalid={!!errors.name} maxLength={150} />
          </Field>
          <Field label="Categoría" name="categoryId" required error={errors.categoryId}>
            <Select name="categoryId" defaultValue={product?.categoryId ?? ""} invalid={!!errors.categoryId}>
              <option value="" disabled>Selecciona…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Marca" name="brand" error={errors.brand}>
            <Input name="brand" defaultValue={product?.brand ?? ""} maxLength={80} />
          </Field>
          <Field label="Talla" name="size" error={errors.size}>
            <Input name="size" list="size-options" defaultValue={product?.size ?? ""} maxLength={20} />
            <datalist id="size-options">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Color" name="color" error={errors.color}>
            <Input name="color" defaultValue={product?.color ?? ""} maxLength={40} />
          </Field>
          <Field label="Unidad de medida" name="unit" required error={errors.unit}>
            <Select name="unit" defaultValue={product?.unit ?? "Unidad"}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </Select>
          </Field>
          {!editing && (
            <Field label="Stock inicial" name="initialStock" required error={errors.initialStock} hint="Se registra como una entrada.">
              <Input name="initialStock" type="number" min={0} step={1} inputMode="numeric" defaultValue={0} invalid={!!errors.initialStock} />
            </Field>
          )}
          <Field label="Stock mínimo" name="minimumStock" required error={errors.minimumStock} hint="Bajo este nivel se marca como Stock bajo.">
            <Input name="minimumStock" type="number" min={0} step={1} inputMode="numeric" defaultValue={product?.minimumStock ?? 5} invalid={!!errors.minimumStock} />
          </Field>
          <Field label="Descripción" name="description" error={errors.description} className="sm:col-span-2">
            <Textarea name="description" defaultValue={product?.description ?? ""} maxLength={1000} />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-2">
            <Textarea name="notes" defaultValue={product?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}
