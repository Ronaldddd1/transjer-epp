"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, type Tx } from "@/db";
import { employees, eppDeliveries, eppReturns, products } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser, type CurrentUser } from "@/lib/auth";
import { formatDate, RETURN_CONDITION_LABEL } from "@/lib/utils";
import { bulkReturnSchema, eppReturnSchema, terminationSchema } from "@/lib/validations";
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

    // Lo que tiene a su cargo hoy: lo entregado menos lo que ya devolvió.
    const [{ entregado }] = await db.select({
      entregado: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
    }).from(eppDeliveries).where(and(eq(eppDeliveries.employeeId, id), isNull(eppDeliveries.voidedAt)));
    const [{ devuelto }] = await db.select({
      devuelto: sql<number>`coalesce(sum(${eppReturns.quantity}), 0)::int`,
    }).from(eppReturns).where(eq(eppReturns.employeeId, id));
    const pendiente = Math.max(0, entregado - devuelto);

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

type Empleado = typeof employees.$inferSelect;
type Condicion = "REUTILIZABLE" | "DESCARTADO" | "NO_DEVUELTO";

/**
 * Registra la devolución de un EPP dentro de una transacción ya abierta.
 *
 * No anula la entrega: esa ocurrió y se queda en el historial. Lo que cambia es que el EPP
 * deja de estar a cargo del trabajador. Solo el que vuelve reutilizable suma stock otra vez,
 * con su movimiento de ENTRADA vinculado; el gastado y el que nunca volvió quedan
 * registrados sin tocar el inventario, porque no hay nada que volver a entregar.
 *
 * La cantidad se compara contra el pendiente real dentro de la transacción: así dos personas
 * registrando a la vez no pueden devolver más de lo que se entregó.
 */
async function devolverUno(tx: Tx, user: CurrentUser, employee: Empleado, d: {
  productId: string; quantity: number; condition: Condicion; returnDate: string; reason: string; notes: string | null; lote: string;
}) {
  const fullName = `${employee.firstName} ${employee.lastName}`;
  const [product] = await tx.select({ id: products.id, code: products.code, name: products.name, size: products.size, unitPrice: products.unitPrice })
    .from(products).where(eq(products.id, d.productId));
  if (!product) throw new BusinessError("El EPP no existe.");

  // Pendiente = entregado vigente − devuelto. Se recalcula aquí, nunca se confía en lo
  // que trae el formulario: entre que se abrió el modal y se envió pudo cambiar.
  const [{ entregado }] = await tx.select({
    entregado: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
  }).from(eppDeliveries)
    .where(and(eq(eppDeliveries.employeeId, employee.id), eq(eppDeliveries.productId, product.id), isNull(eppDeliveries.voidedAt)));
  const [{ devuelto }] = await tx.select({
    devuelto: sql<number>`coalesce(sum(${eppReturns.quantity}), 0)::int`,
  }).from(eppReturns)
    .where(and(eq(eppReturns.employeeId, employee.id), eq(eppReturns.productId, product.id)));

  const pendiente = entregado - devuelto;
  if (pendiente <= 0) {
    throw new BusinessError(`${fullName} no tiene ${product.name} pendiente de devolución.`);
  }
  if (d.quantity > pendiente) {
    throw new BusinessError(`Solo quedan ${pendiente} unidad(es) de ${product.name} por devolver.`);
  }

  // El precio del acta es el de la última entrega de ese EPP a esta persona (lo que firmó
  // al recibirlo); si se entregó antes de que hubiera precios, el precio actual.
  const [ultima] = await tx.select({ unitPrice: eppDeliveries.unitPrice }).from(eppDeliveries)
    .where(and(eq(eppDeliveries.employeeId, employee.id), eq(eppDeliveries.productId, product.id), isNull(eppDeliveries.voidedAt)))
    .orderBy(desc(eppDeliveries.deliveryDate), desc(eppDeliveries.createdAt)).limit(1);
  const unitPrice = ultima?.unitPrice ?? product.unitPrice;

  // Solo el EPP reutilizable regresa al stock. El descartado y el no devuelto se
  // registran sin movimiento: contarlos como entrada inflaría el inventario con
  // unidades que nadie puede volver a entregar.
  const movimiento = d.condition === "REUTILIZABLE"
    ? await applyMovement(tx, {
        productId: product.id,
        type: "ENTRADA",
        quantity: d.quantity,
        reason: `Devolución de personal: ${d.reason}`,
        notes: d.notes,
        employeeId: employee.id,
        user,
        allowInactive: true,
        auditDescription: `${user.name} ingresó ${d.quantity} unidad(es) de ${product.name} devueltas por ${fullName}.`,
      })
    : null;

  const [devolucion] = await tx.insert(eppReturns).values({
    employeeId: employee.id,
    productId: product.id,
    quantity: d.quantity,
    size: product.size,
    unitPrice,
    batchId: d.lote,
    returnDate: d.returnDate,
    condition: d.condition,
    movementId: movimiento?.movement.id ?? null,
    reason: d.reason,
    userId: user.id,
    notes: d.notes,
  }).returning();

  await logAudit({
    user, action: "ENTREGA", module: "ENTREGAS", recordId: devolucion.id,
    description: `${user.name} registró la devolución de ${d.quantity} ${product.name} (${product.code}) de ${fullName}`
      + ` como «${RETURN_CONDITION_LABEL[d.condition]}».`,
    newData: { ...devolucion, product: product.code, employee: fullName, volvioAlStock: d.condition === "REUTILIZABLE" },
  }, tx);

  return { restante: pendiente - d.quantity, product: product.name, volvioAlStock: d.condition === "REUTILIZABLE" };
}

/** Lo que el trabajador tiene a su cargo, en total, dentro de la transacción. */
async function pendienteTotal(tx: Tx, employeeId: string) {
  const [{ entregado }] = await tx.select({
    entregado: sql<number>`coalesce(sum(${eppDeliveries.quantity}), 0)::int`,
  }).from(eppDeliveries).where(and(eq(eppDeliveries.employeeId, employeeId), isNull(eppDeliveries.voidedAt)));
  const [{ devuelto }] = await tx.select({
    devuelto: sql<number>`coalesce(sum(${eppReturns.quantity}), 0)::int`,
  }).from(eppReturns).where(eq(eppReturns.employeeId, employeeId));
  return Math.max(0, entregado - devuelto);
}

function descargaActa(employeeId: string, lote: string) {
  return {
    href: `/api/epp/devolucion/${employeeId}?lote=${lote}`,
    label: "Descargar acta de devolución para firmar",
    detalle: "Qué EPP entrega, en qué estado, su precio y si la devolución es completa o parcial.",
  };
}

/** Registra la devolución de un EPP (un solo producto). */
export async function registerReturn(employeeId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("deliveries.create");
    const data = eppReturnSchema.parse(formToObject(formData));
    const lote = randomUUID();

    const resultado = await db.transaction(async (tx) => {
      const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
      if (!employee) throw new BusinessError("El trabajador no existe.");
      if (employee.hireDate && data.returnDate < employee.hireDate) {
        throw new BusinessError("La devolución no puede ser anterior al ingreso del trabajador.");
      }
      return devolverUno(tx, user, employee, { ...data, lote });
    });

    revalidatePath("/", "layout");
    const stock = resultado.volvioAlStock ? " El stock volvió al inventario." : "";
    return {
      ok: true,
      message: resultado.restante > 0
        ? `Devolución registrada. Quedan ${resultado.restante} unidad(es) de ${resultado.product}.${stock}`
        : `Devolución registrada. ${resultado.product} queda saldado.${stock}`,
      descargas: [descargaActa(employeeId, lote)],
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Devolución de varios EPP de una vez: la tabla del modal.
 *
 * Cada fila trae `cantidad_<productId>` y `estado_<productId>`. Todo va en una sola
 * transacción y con un mismo lote, que es lo que junta las filas en una sola acta.
 */
export async function registerReturns(employeeId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("deliveries.create");
    const data = bulkReturnSchema.parse(formToObject(formData));

    const filas: { productId: string; quantity: number; condition: Condicion }[] = [];
    for (const [campo, valor] of formData.entries()) {
      if (!campo.startsWith("cantidad_")) continue;
      const texto = String(valor).trim();
      if (!texto) continue;
      const cantidad = Number(texto);
      if (!Number.isFinite(cantidad) || cantidad < 0 || !Number.isInteger(cantidad)) {
        throw new BusinessError("Las cantidades tienen que ser números enteros.");
      }
      if (cantidad === 0) continue;
      const productId = campo.slice("cantidad_".length);
      const estado = String(formData.get(`estado_${productId}`) ?? "REUTILIZABLE");
      if (!["REUTILIZABLE", "DESCARTADO", "NO_DEVUELTO"].includes(estado)) throw new BusinessError("Estado de devolución inválido.");
      filas.push({ productId, quantity: cantidad, condition: estado as Condicion });
    }
    if (filas.length === 0) throw new BusinessError("Escribe la cantidad de al menos un EPP.");
    if (filas.some((f) => f.condition === "NO_DEVUELTO") && !data.notes) {
      return {
        ok: false,
        message: "Revisa los campos marcados.",
        fieldErrors: { notes: "Explica qué pasó con el EPP que no devolvió" },
      };
    }

    const lote = randomUUID();
    const { restante, unidades } = await db.transaction(async (tx) => {
      const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
      if (!employee) throw new BusinessError("El trabajador no existe.");
      if (employee.hireDate && data.returnDate < employee.hireDate) {
        throw new BusinessError("La devolución no puede ser anterior al ingreso del trabajador.");
      }
      for (const f of filas) {
        await devolverUno(tx, user, employee, { ...f, returnDate: data.returnDate, reason: data.reason, notes: data.notes, lote });
      }
      return { restante: await pendienteTotal(tx, employee.id), unidades: filas.reduce((s, f) => s + f.quantity, 0) };
    });

    revalidatePath("/", "layout");
    const noDevuelto = filas.some((f) => f.condition === "NO_DEVUELTO");
    return {
      ok: true,
      message: restante > 0
        ? `Devolución parcial registrada: ${unidades} unidad(es). Le quedan ${restante} a su cargo.`
        : noDevuelto
          ? `Devolución registrada: ${unidades} unidad(es). Ya no tiene EPP a su cargo, pero hay EPP que no devolvió.`
          : `Devolución completa registrada: ${unidades} unidad(es). Ya no tiene EPP a su cargo.`,
      descargas: [descargaActa(employeeId, lote)],
    };
  } catch (e) {
    return toActionError(e);
  }
}
