"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employees, eppDeliveries, products } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { deliverySchema, voidDeliverySchema } from "@/lib/validations";
import { applyMovement } from "@/server/inventory";

/**
 * Registra una entrega: en una sola transacción crea la salida de inventario,
 * descuenta el stock y guarda la entrega con el usuario responsable.
 */
export async function createDelivery(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("deliveries.create");
    const data = deliverySchema.parse(formToObject(formData));

    await db.transaction(async (tx) => {
      const [employee] = await tx.select().from(employees).where(eq(employees.id, data.employeeId));
      if (!employee || !employee.active) throw new BusinessError("El trabajador no existe o está desactivado.");
      const fullName = `${employee.firstName} ${employee.lastName}`;

      const { movement, product } = await applyMovement(tx, {
        productId: data.productId,
        type: "SALIDA",
        quantity: data.quantity,
        reason: `Entrega a personal: ${data.reason}`,
        notes: data.notes,
        employeeId: employee.id,
        user,
        auditDescription: `${user.name} registró una salida de ${data.quantity} unidad(es) por entrega a ${fullName}.`,
      });

      const [delivery] = await tx.insert(eppDeliveries).values({
        employeeId: employee.id,
        productId: product.id,
        movementId: movement.id,
        quantity: data.quantity,
        size: product.size,
        deliveryDate: data.deliveryDate,
        reason: data.reason,
        notes: data.notes,
        userId: user.id,
      }).returning();

      await logAudit({
        user, action: "ENTREGA", module: "ENTREGAS", recordId: delivery.id,
        description: `${user.name} entregó ${data.quantity} ${product.name} a ${fullName} (DNI ${employee.dni}).`,
        newData: { ...delivery, product: product.code, employee: fullName },
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Entrega registrada correctamente." };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Anula una entrega registrada por error. No se borra: queda marcada como anulada,
 * su stock vuelve con una entrada vinculada y deja de contar en totales e historiales.
 */
export async function voidDelivery(deliveryId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("deliveries.void");
    const { voidReason } = voidDeliverySchema.parse(formToObject(formData));

    await db.transaction(async (tx) => {
      // Bloqueo de la fila: si dos administradores anulan a la vez, solo uno lo consigue.
      const [delivery] = await tx.select().from(eppDeliveries).where(eq(eppDeliveries.id, deliveryId)).for("update");
      if (!delivery) throw new BusinessError("La entrega no existe.");
      if (delivery.voidedAt) throw new BusinessError("Esta entrega ya fue anulada.");

      const [employee] = await tx.select().from(employees).where(eq(employees.id, delivery.employeeId));
      const [product] = await tx.select({ name: products.name, code: products.code }).from(products).where(eq(products.id, delivery.productId));
      const fullName = `${employee.firstName} ${employee.lastName}`;

      const { movement } = await applyMovement(tx, {
        productId: delivery.productId,
        type: "ENTRADA",
        quantity: delivery.quantity,
        reason: "Anulación de entrega",
        notes: `Entrega del ${formatDate(delivery.deliveryDate)} a ${fullName}. Motivo: ${voidReason}`,
        employeeId: delivery.employeeId,
        user,
        allowInactive: true,
        auditDescription: `${user.name} devolvió ${delivery.quantity} unidad(es) de ${product.name} al stock por anulación de una entrega a ${fullName}.`,
      });

      const [updated] = await tx.update(eppDeliveries).set({
        voidedAt: new Date(), voidedBy: user.id, voidReason, voidMovementId: movement.id,
      }).where(eq(eppDeliveries.id, delivery.id)).returning();

      await logAudit({
        user, action: "ANULAR", module: "ENTREGAS", recordId: delivery.id,
        description: `${user.name} anuló la entrega de ${delivery.quantity} ${product.name} (${product.code}) a ${fullName} del ${formatDate(delivery.deliveryDate)}. Motivo: ${voidReason}`,
        oldData: { ...delivery, employee: fullName, product: product.code },
        newData: { ...updated, employee: fullName, product: product.code },
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Entrega anulada. El stock fue devuelto al inventario." };
  } catch (e) {
    return toActionError(e);
  }
}
