"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { products } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { productBaseSchema, productCreateSchema } from "@/lib/validations";
import { applyMovement } from "@/server/inventory";

export async function createProduct(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("products.manage");
    const { initialStock, ...data } = productCreateSchema.parse(formToObject(formData));

    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.code, data.code));
      if (existing) throw new BusinessError(`El código ${data.code} ya está registrado.`);

      const [product] = await tx.insert(products).values({ ...data, stock: 0 }).returning();
      await logAudit({
        user, action: "CREAR", module: "PRODUCTOS", recordId: product.id,
        description: `${user.name} creó el producto ${product.code} (${product.name}).`,
        newData: { ...product, initialStock },
      }, tx);

      // El stock inicial queda registrado como una entrada, para mantener la trazabilidad.
      if (initialStock > 0) {
        await applyMovement(tx, { productId: product.id, type: "ENTRADA", quantity: initialStock, reason: "Stock inicial", user });
      }
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Producto registrado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateProduct(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("products.manage");
    const data = productBaseSchema.parse(formToObject(formData));

    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, id));
      if (!before || !before.active) throw new BusinessError("El producto no existe o fue eliminado.");
      const [after] = await tx.update(products).set(data).where(eq(products.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "PRODUCTOS", recordId: id,
        description: `${user.name} modificó el producto ${before.code}.`,
        oldData: before, newData: after,
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Producto actualizado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Eliminación lógica: el producto deja de mostrarse pero su historial se conserva. */
export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("products.manage");
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(products).where(eq(products.id, id));
      if (!before || !before.active) throw new BusinessError("El producto ya fue eliminado.");
      await tx.update(products).set({ active: false }).where(eq(products.id, id));
      await logAudit({
        user, action: "ELIMINAR", module: "PRODUCTOS", recordId: id,
        description: `${user.name} eliminó el producto ${before.code} (${before.name}).`,
        oldData: before, newData: { active: false },
      }, tx);
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Producto eliminado correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}
