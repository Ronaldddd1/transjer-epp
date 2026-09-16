import "server-only";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { inventoryMovements, products, type MovementType } from "@/db/schema";
import { BusinessError } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";

type MovementInput = {
  productId: string;
  type: MovementType;
  /** ENTRADA/SALIDA: cantidad a mover. AJUSTE: stock físico contado. */
  quantity: number;
  reason: string;
  notes?: string | null;
  employeeId?: string | null;
  user: CurrentUser;
  auditDescription?: string;
};

/**
 * Único punto donde cambia el stock. Bloquea la fila del producto (SELECT … FOR UPDATE)
 * para que dos usuarios registrando a la vez no descuadren el inventario.
 */
export async function applyMovement(tx: Tx, input: MovementInput) {
  const [product] = await tx
    .select({ id: products.id, code: products.code, name: products.name, size: products.size, stock: products.stock, active: products.active })
    .from(products)
    .where(eq(products.id, input.productId))
    .for("update");

  if (!product || !product.active) throw new BusinessError("El producto no existe o fue eliminado.");

  let delta: number;
  if (input.type === "ENTRADA") delta = input.quantity;
  else if (input.type === "SALIDA") delta = -input.quantity;
  else delta = input.quantity - product.stock;

  if (input.type === "AJUSTE" && delta === 0) {
    throw new BusinessError("El stock contado es igual al stock actual; no hay nada que ajustar.");
  }

  const newStock = product.stock + delta;
  if (newStock < 0) {
    throw new BusinessError(`No hay suficiente stock disponible. Stock actual de ${product.name}: ${product.stock}.`);
  }

  await tx.update(products).set({ stock: newStock }).where(eq(products.id, product.id));

  const [movement] = await tx
    .insert(inventoryMovements)
    .values({
      productId: product.id,
      type: input.type,
      quantity: input.type === "AJUSTE" ? delta : input.quantity,
      stockBefore: product.stock,
      stockAfter: newStock,
      reason: input.reason,
      notes: input.notes ?? null,
      employeeId: input.employeeId ?? null,
      userId: input.user.id,
    })
    .returning();

  const verb = { ENTRADA: "registró una entrada de", SALIDA: "registró una salida de", AJUSTE: "ajustó en" }[input.type];
  const qtyText = input.type === "AJUSTE" ? `${delta > 0 ? "+" : ""}${delta}` : `${input.quantity}`;
  await logAudit(
    {
      user: input.user,
      action: input.type,
      module: "MOVIMIENTOS",
      recordId: movement.id,
      description:
        input.auditDescription ??
        `${input.user.name} ${verb} ${qtyText} unidad(es) de ${product.code} (${product.name}). Motivo: ${input.reason}.`,
      oldData: { code: product.code, stock: product.stock },
      newData: { code: product.code, stock: newStock, type: input.type, quantity: movement.quantity, reason: input.reason },
    },
    tx,
  );

  return { movement, product: { ...product, stock: newStock } };
}
