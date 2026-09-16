"use client";

import { Pencil, Plus } from "lucide-react";
import { createCategory, updateCategory } from "@/actions/categories";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";

export function CategoryFormModal({ category }: { category?: { id: string; name: string; description: string | null } }) {
  const editing = !!category;
  return (
    <FormModal
      title={editing ? "Editar categoría" : "Nueva categoría"}
      submitLabel={editing ? "Guardar cambios" : "Registrar categoría"}
      size="sm"
      action={(fd) => (editing ? updateCategory(category.id, fd) : createCategory(fd))}
      trigger={(open) => editing
        ? <Button variant="ghost" size="sm" onClick={open}><Pencil className="h-4 w-4" /> Editar</Button>
        : <Button onClick={open}><Plus className="h-4 w-4" /> Nueva categoría</Button>}
    >
      {({ errors }) => (
        <>
          <Field label="Nombre" name="name" required error={errors.name}>
            <Input name="name" defaultValue={category?.name} invalid={!!errors.name} maxLength={80} />
          </Field>
          <Field label="Descripción" name="description" error={errors.description}>
            <Textarea name="description" defaultValue={category?.description ?? ""} maxLength={500} />
          </Field>
        </>
      )}
    </FormModal>
  );
}
