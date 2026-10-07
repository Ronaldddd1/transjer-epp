"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { employees, eppDeliveries, eppReturns, products } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { formatDate, RETURN_CONDITION_LABEL } from "@/lib/utils";
import { eppReturnSchema, terminationSchema } from "@/lib/validations";
import { applyMovement } from "@/server/inventory";

/**
 * Registra el cese de un trabajador.
 *
 * Desactivarlo y cesarlo no son lo mismo: el cese es lo que hace que el sistema empiece a
 * reclamarle el EPP que tiene a su cargo. Desactiva además al trabajador, porque un cesado
 * no debe poder recibir EPP nuevo.
 */
export async function terminateEmployee(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("employees.manage");
    const data = terminationSchema.parse(formToObject(formData));

    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    if (!before) throw new BusinessError("El trabajador no existe.");
    if (before.terminatedAt) throw new BusinessError("Este trabajador ya tiene su cese registrado.");
    if (before.hireDate && data.terminatedAt < before.hireDate) {
      throw new BusinessError(`El cese no puede ser anterior al ingreso (${formatDate(before.hireDate)}).`);
    }

    const [{ pendiente }] = await db.select({
      pendiente: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
    }).from(eppDeliveries).where(and(eq(eppDeliveries.employeeId, id), isNull(eppDeliveries.voidedAt)));

    const [after] = await db.update(employees)
      .set({ terminatedAt: data.terminatedAt, terminationReason: data.terminationReason, active: false })
      .where(eq(employees.id, id)).returning();

    await logAudit({
      user, action: "DESACTIVAR", module: "TRABAJADORES", recordId: id,
      description: `${user.name} registró el cese de ${before.firstName} ${before.lastName} con fecha ${formatDate(data.terminatedAt)}.`
        + (data.terminationReason ? ` Motivo: ${data.terminationReason}.` : ""),
      oldData: { active: before.active, terminatedAt: before.terminatedAt },
      newData: { active: after.active, terminatedAt: after.terminatedAt, terminationReason: after.terminationReason },
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: pendiente > 0
        ? `Cese registrado. Quedan ${pendiente} unidad(es) de EPP por devolver.`
        : "Cese registrado. No tiene EPP pendiente de devolución.",
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Deshace un cese registrado por error: el trabajador vuelve a estar activo. */
export async function reinstateEmployee(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("employees.manage");
    const [before] = await db.select().from(employees).where(eq(employees.id, id));
    if (!before) throw new BusinessError("El trabajador no existe.");
    if (!before.terminatedAt) throw new BusinessError("Este trabajador no tiene un cese registrado.");

    await db.update(employees)
      .set({ terminatedAt: null, terminationReason: null, active: true })
      .where(eq(employees.id, id));

    await logAudit({
      user, action: "ACTIVAR", module: "TRABAJADORES", recordId: id,
      description: `${user.name} anuló el cese de ${before.firstName} ${before.lastName} del ${formatDate(before.terminatedAt)} y lo reincorporó.`,
      oldData: { active: before.active, terminatedAt: before.terminatedAt, terminationReason: before.terminationReason },
      newData: { active: true, terminatedAt: null },
    });

    revalidatePath("/", "layout");
    return { ok: true, message: "Cese anulado. El trabajador está activo otra vez." };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Registra la devolución de un EPP.
 *
 * No anula la entrega: esa ocurrió y se queda en el historial. Lo que cambia es que el EPP
 * deja de estar a cargo del trabajador. Solo el que vuelve reutilizable suma stock otra vez,
 * con su movimiento de ENTRADA vinculado; el gastado y el que nunca volvió quedan
 * registrados sin tocar el inventario, porque no hay nada que volver a entregar.
 *
 * La cantidad se compara contra el pendiente real dentro de la transacción: así dos personas
 * registrando a la vez no pueden devolver más de lo que se entregó.
 */
export async function registerReturn(employeeId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("deliveries.create");
    const data = eppReturnSchema.parse(formToObject(formData));

    const resultado = await db.transaction(async (tx) => {
      const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
      if (!employee) throw new BusinessError("El trabajador no existe.");
      const fullName = `${employee.firstName} ${employee.lastName}`;

      const [product] = await tx.select({ id: products.id, code: products.code, name: products.name, size: products.size })
        .from(products).where(eq(products.id, data.productId));
      if (!product) throw new BusinessError("El EPP no existe.");

      // Pendiente = entregado vigente − devuelto. Se recalcula aquí, nunca se confía en lo
      // que trae el formulario: entre que se abrió el modal y se envió pudo cambiar.
      const [{ entregado }] = await tx.select({
        entregado: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
      }).from(eppDeliveries)
        .where(and(eq(eppDeliveries.employeeId, employeeId), eq(eppDeliveries.productId, product.id), isNull(eppDeliveries.voidedAt)));
      const [{ devuelto }] = await tx.select({
        devuelto: sql<number>`coalesce(sum(${eppReturns.quantity}), 0)::int`,
      }).from(eppReturns)
        .where(and(eq(eppReturns.employeeId, employeeId), eq(eppReturns.productId, product.id)));

      const pendiente = entregado - devuelto;
      if (pendiente <= 0) {
        throw new BusinessError(`${fullName} no tiene ${product.name} pendiente de devolución.`);
      }
      if (data.quantity > pendiente) {
        throw new BusinessError(`Solo quedan ${pendiente} unidad(es) de ${product.name} por devolver.`);
      }
      if (employee.hireDate && data.returnDate < employee.hireDate) {
        throw new BusinessError("La devolución no puede ser anterior al ingreso del trabajador.");
      }

      // Solo el EPP reutilizable regresa al stock. El descartado y el no devuelto se
      // registran sin movimiento: contarlos como entrada inflaría el inventario con
      // unidades que nadie puede volver a entregar.
      const movimiento = data.condition === "REUTILIZABLE"
        ? await applyMovement(tx, {
            productId: product.id,
            type: "ENTRADA",
            quantity: data.quantity,
            reason: `Devolución de personal: ${data.reason}`,
            notes: data.notes,
            employeeId: employee.id,
            user,
            allowInactive: true,
            auditDescription: `${user.name} ingresó ${data.quantity} unidad(es) de ${product.name} devueltas por ${fullName}.`,
          })
        : null;

      const [devolucion] = await tx.insert(eppReturns).values({
        employeeId: employee.id,
        productId: product.id,
        quantity: data.quantity,
        size: product.size,
        returnDate: data.returnDate,
        condition: data.condition,
        movementId: movimiento?.movement.id ?? null,
        reason: data.reason,
        userId: user.id,
        notes: data.notes,
      }).returning();

      await logAudit({
        user, action: "ENTREGA", module: "ENTREGAS", recordId: devolucion.id,
        description: `${user.name} registró la devolución de ${data.quantity} ${product.name} (${product.code}) de ${fullName}`
          + ` como «${RETURN_CONDITION_LABEL[data.condition]}».`,
        newData: { ...devolucion, product: product.code, employee: fullName, volvioAlStock: data.condition === "REUTILIZABLE" },
      }, tx);

      return { restante: pendiente - data.quantity, product: product.name, volvioAlStock: data.condition === "REUTILIZABLE" };
    });

    revalidatePath("/", "layout");
    const stock = resultado.volvioAlStock ? " El stock volvió al inventario." : "";
    return {
      ok: true,
      message: resultado.restante > 0
        ? `Devolución registrada. Quedan ${resultado.restante} unidad(es) de ${resultado.product}.${stock}`
        : `Devolución registrada. ${resultado.product} queda saldado.${stock}`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
