"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employees, eppDeliveries } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { deliverySchema } from "@/lib/validations";
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
