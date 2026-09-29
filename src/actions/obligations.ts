"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { obligationInstallments, obligations } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { monthlyDueDates } from "@/lib/amortization";
import { formatMoney, OBLIGATION_TYPE_LABEL, todayLima } from "@/lib/utils";
import {
  installmentAmountSchema, obligationSchema, payInstallmentSchema, scheduleSchema,
} from "@/lib/validations";

/**
 * Préstamos, servicios y demás pagos que se repiten.
 *
 * El cronograma es el corazón: un préstamo trae el del banco, fila por fila, y un servicio
 * de monto variable genera meses sin importe que se completan cuando llega el recibo.
 * Una cuota pagada no se toca: para corregirla hay que reabrirla primero, y eso queda en
 * auditoría igual que en las facturas.
 */

const MONTHS_AHEAD = 12;

async function loadObligation(id: string) {
  const [row] = await db.select().from(obligations).where(eq(obligations.id, id)).limit(1);
  if (!row) throw new BusinessError("La obligación no existe.");
  return row;
}

async function loadInstallment(id: string) {
  const [row] = await db.select().from(obligationInstallments).where(eq(obligationInstallments.id, id)).limit(1);
  if (!row) throw new BusinessError("La cuota no existe.");
  return row;
}

export async function createObligation(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const data = obligationSchema.parse(formToObject(formData));

    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(obligations).values({ ...data, createdBy: user.id }).returning();

      // Los servicios y alquileres arrancan con un año de vencimientos por delante, para que
      // aparezcan en el calendario desde el primer día. Un préstamo espera su cronograma.
      if (row.type !== "PRESTAMO" && row.billingDay) {
        await generateMonths(tx, row, MONTHS_AHEAD);
      }

      await logAudit({
        user, action: "CREAR", module: "OBLIGACIONES", recordId: row.id,
        description: `${user.name} registró ${OBLIGATION_TYPE_LABEL[row.type].toLowerCase()} "${row.name}" con ${row.creditor}.`,
        newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: created.type === "PRESTAMO"
        ? `${created.name} registrado. Ahora carga su cronograma de cuotas.`
        : `${created.name} registrado con sus vencimientos del próximo año.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateObligation(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const data = obligationSchema.parse(formToObject(formData));
    const before = await loadObligation(id);
    if (before.status === "ANULADA") throw new BusinessError("La obligación está anulada.");
    if (before.type !== data.type) {
      throw new BusinessError("No se puede cambiar el tipo. Anula esta obligación y registra una nueva.");
    }

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(obligations).set(data).where(eq(obligations.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} modificó "${row.name}".`, oldData: before, newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `"${after.name}" actualizado correctamente.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Guarda el cronograma completo de un préstamo, reemplazando el anterior.
 * Se niega si ya hay cuotas pagadas: reescribir el cronograma bajo un pago registrado
 * dejaría la historia sin sentido.
 */
export async function saveSchedule(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const raw = formToObject(formData).rows ?? "[]";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BusinessError("No se pudo leer el cronograma. Vuelve a pegarlo.");
    }
    const { rows } = scheduleSchema.parse({ rows: parsed });

    const before = await loadObligation(id);
    if (before.status === "ANULADA") throw new BusinessError("La obligación está anulada.");

    const after = await db.transaction(async (tx) => {
      const [{ pagadas }] = await tx.select({ pagadas: sql<number>`count(*)::int` })
        .from(obligationInstallments)
        .where(and(eq(obligationInstallments.obligationId, id), eq(obligationInstallments.status, "PAGADA")));
      if (pagadas > 0) {
        throw new BusinessError(
          `No se puede reemplazar el cronograma porque ya hay ${pagadas} cuota(s) pagada(s). Reábrelas primero si de verdad quieres rehacerlo.`,
        );
      }

      await tx.delete(obligationInstallments).where(eq(obligationInstallments.obligationId, id));

      // El saldo que imprime el banco manda: se guarda tal cual para que la ficha cuadre
      // con el papel. Solo cuando el cronograma no lo trae se recalcula restando el capital,
      // y entonces puede diferir del banco en algún céntimo por los redondeos de cada uno.
      let calculado = before.principal ? Number(before.principal) : null;
      const values = rows.map((r) => {
        if (calculado !== null && r.principal !== null) calculado = Math.round((calculado - r.principal) * 100) / 100;
        const balance = r.balanceAfter ?? (r.principal === null ? null : calculado);
        return {
          obligationId: id,
          number: r.number,
          dueDate: r.dueDate,
          principal: r.principal === null ? null : r.principal.toFixed(2),
          interest: r.interest === null ? null : r.interest.toFixed(2),
          insurance: r.insurance === null ? null : r.insurance.toFixed(2),
          total: r.total.toFixed(2),
          balanceAfter: balance === null ? null : balance.toFixed(2),
        };
      });
      await tx.insert(obligationInstallments).values(values);

      const [row] = await tx.update(obligations)
        .set({ installmentsCount: rows.length })
        .where(eq(obligations.id, id)).returning();

      const suma = rows.reduce((s, r) => s + r.total, 0);
      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} cargó el cronograma de "${row.name}": ${rows.length} cuotas por ${formatMoney(suma.toFixed(2), row.currency)}.`,
        oldData: before, newData: { cuotas: rows.length, total: suma },
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Cronograma guardado: ${rows.length} cuotas.` };
  } catch (e) {
    return toActionError(e);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Crea los vencimientos mensuales que falten de un servicio, hasta `months` meses adelante. */
async function generateMonths(tx: Tx, obligation: typeof obligations.$inferSelect, months: number) {
  if (!obligation.billingDay) return 0;

  const [last] = await tx.select({ number: obligationInstallments.number, dueDate: obligationInstallments.dueDate })
    .from(obligationInstallments)
    .where(eq(obligationInstallments.obligationId, obligation.id))
    .orderBy(sql`${obligationInstallments.number} desc`).limit(1);

  const hoy = todayLima();
  const [y, m] = hoy.split("-").map(Number);
  const day = String(obligation.billingDay).padStart(2, "0");
  // Se arranca del mes siguiente al último vencimiento, o de este mes si no hay ninguno.
  const start = last
    ? monthlyDueDates(last.dueDate, 2)[1]
    : `${y}-${String(m).padStart(2, "0")}-${day}`;

  const fechas = monthlyDueDates(start, months).filter((d) => d >= hoy || !last);
  if (fechas.length === 0) return 0;

  const importe = obligation.variableAmount ? null : obligation.fixedAmount;
  await tx.insert(obligationInstallments).values(
    fechas.map((dueDate, i) => ({
      obligationId: obligation.id,
      number: (last?.number ?? 0) + i + 1,
      dueDate,
      total: importe,
    })),
  ).onConflictDoNothing();
  return fechas.length;
}

/** Extiende el calendario de un servicio otro año más. */
export async function extendSchedule(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const obligation = await loadObligation(id);
    if (obligation.type === "PRESTAMO") throw new BusinessError("Un préstamo tiene cronograma cerrado: no se extiende.");
    if (obligation.status !== "ACTIVA") throw new BusinessError("La obligación no está activa.");

    const creadas = await db.transaction(async (tx) => {
      const n = await generateMonths(tx, obligation, MONTHS_AHEAD);
      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} extendió el calendario de "${obligation.name}" en ${n} mes(es).`,
      }, tx);
      return n;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Se agregaron ${creadas} vencimiento(s).` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Anota el importe del recibo de un servicio de monto variable. */
export async function setInstallmentAmount(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const data = installmentAmountSchema.parse(formToObject(formData));
    const before = await loadInstallment(id);
    if (before.status === "PAGADA") throw new BusinessError("La cuota ya está pagada. Reábrela para corregir el importe.");
    if (before.status === "ANULADA") throw new BusinessError("La cuota está anulada.");

    const obligation = await loadObligation(before.obligationId);

    await db.transaction(async (tx) => {
      const [row] = await tx.update(obligationInstallments)
        .set({ total: data.total, notes: data.notes ?? before.notes })
        .where(eq(obligationInstallments.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: before.obligationId,
        description: `${user.name} anotó el importe de la cuota ${row.number} de "${obligation.name}": ${formatMoney(row.total, obligation.currency)}.`,
        oldData: before, newData: row,
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Importe anotado: ${formatMoney(data.total, obligation.currency)}.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Marca una cuota como pagada. */
export async function payInstallment(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.pay");
    const data = payInstallmentSchema.parse(formToObject(formData));
    if (data.paidAt > todayLima()) throw new BusinessError("La fecha de pago no puede ser futura.");

    const result = await db.transaction(async (tx) => {
      // Bloqueo de la fila: si dos personas registran el mismo pago a la vez, solo una gana.
      const [before] = await tx.select().from(obligationInstallments)
        .where(eq(obligationInstallments.id, id)).for("update");
      if (!before) throw new BusinessError("La cuota no existe.");
      if (before.status === "PAGADA") throw new BusinessError("Esta cuota ya figura como pagada.");
      if (before.status === "ANULADA") throw new BusinessError("La cuota está anulada.");

      const [row] = await tx.update(obligationInstallments).set({
        status: "PAGADA",
        paidAt: data.paidAt,
        paidAmount: data.paidAmount,
        // Si la cuota no tenía importe (servicio variable), lo pagado pasa a ser el importe.
        total: before.total ?? data.paidAmount,
        paymentReference: data.paymentReference,
        notes: data.notes ?? before.notes,
        paidBy: user.id,
      }).where(eq(obligationInstallments.id, id)).returning();

      const [obligation] = await tx.select().from(obligations).where(eq(obligations.id, row.obligationId)).limit(1);

      await logAudit({
        user, action: "PAGAR", module: "OBLIGACIONES", recordId: row.obligationId,
        description: `${user.name} registró el pago de la cuota ${row.number} de "${obligation.name}" por ${formatMoney(row.paidAmount, obligation.currency)}${data.paymentReference ? ` (${data.paymentReference})` : ""}.`,
        oldData: before, newData: row,
      }, tx);

      // Un préstamo con todas sus cuotas pagadas se cierra solo.
      const [{ quedan }] = await tx.select({ quedan: sql<number>`count(*)::int` })
        .from(obligationInstallments)
        .where(and(eq(obligationInstallments.obligationId, row.obligationId), eq(obligationInstallments.status, "PENDIENTE")));
      if (quedan === 0 && obligation.type === "PRESTAMO" && obligation.status === "ACTIVA") {
        await tx.update(obligations).set({ status: "CERRADA" }).where(eq(obligations.id, obligation.id));
        await logAudit({
          user, action: "EDITAR", module: "OBLIGACIONES", recordId: obligation.id,
          description: `"${obligation.name}" quedó cancelado: se pagó la última cuota.`,
        }, tx);
      }

      return { row, obligation, quedan };
    });

    revalidatePath("/", "layout");
    const extra = result.quedan === 0 && result.obligation.type === "PRESTAMO"
      ? ` Era la última: "${result.obligation.name}" queda cancelado.`
      : ` Quedan ${result.quedan} cuota(s).`;
    return { ok: true, message: `Cuota ${result.row.number} marcada como pagada.${extra}` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Deshace el pago de una cuota registrado por error. */
export async function reopenInstallment(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.pay");
    const before = await loadInstallment(id);
    if (before.status !== "PAGADA") throw new BusinessError("Solo se puede reabrir una cuota pagada.");
    const obligation = await loadObligation(before.obligationId);

    await db.transaction(async (tx) => {
      const [row] = await tx.update(obligationInstallments).set({
        status: "PENDIENTE", paidAt: null, paidAmount: null, paymentReference: null, paidBy: null,
      }).where(eq(obligationInstallments.id, id)).returning();
      // Si la obligación se había cerrado sola con este pago, vuelve a estar activa.
      if (obligation.status === "CERRADA") {
        await tx.update(obligations).set({ status: "ACTIVA" }).where(eq(obligations.id, obligation.id));
      }
      await logAudit({
        user, action: "REABRIR", module: "OBLIGACIONES", recordId: before.obligationId,
        description: `${user.name} reabrió la cuota ${row.number} de "${obligation.name}": el pago quedó sin efecto.`,
        oldData: before, newData: row,
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Cuota ${before.number} pendiente de pago nuevamente.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Cierra una obligación que ya no corre, o la reactiva. */
export async function setObligationStatus(id: string, status: "ACTIVA" | "CERRADA" | "ANULADA"): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const before = await loadObligation(id);
    if (before.status === status) return { ok: true, message: "No hubo cambios." };

    await db.transaction(async (tx) => {
      const [row] = await tx.update(obligations).set({ status }).where(eq(obligations.id, id)).returning();
      const verbo = status === "ACTIVA" ? "reactivó" : status === "CERRADA" ? "cerró" : "anuló";
      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} ${verbo} "${row.name}".`, oldData: before, newData: row,
      }, tx);
    });

    revalidatePath("/", "layout");
    const mensaje = status === "ACTIVA" ? "reactivada" : status === "CERRADA" ? "cerrada" : "anulada";
    return { ok: true, message: `"${before.name}" ${mensaje}.` };
  } catch (e) {
    return toActionError(e);
  }
}
