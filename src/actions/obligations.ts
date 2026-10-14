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
  installmentAmountSchema, obligationSchema, payInstallmentSchema, renegotiationSchema, scheduleSchema,
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

/**
 * Cuando el usuario indica cuándo vence la primera cuota de un servicio, esa fecha manda:
 * de ella sale el día de pago mensual, para que no haya dos datos que puedan contradecirse.
 */
function conDiaDePago<T extends { type: string; firstDueDate: string | null; billingDay: number | null }>(data: T): T {
  if (data.type === "PRESTAMO" || !data.firstDueDate) return data;
  return { ...data, billingDay: Number(data.firstDueDate.slice(8, 10)) };
}

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
    const data = conDiaDePago(obligationSchema.parse(formToObject(formData)));

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
    const data = conDiaDePago(obligationSchema.parse(formToObject(formData)));
    const before = await loadObligation(id);
    if (before.status === "ANULADA") throw new BusinessError("La obligación está anulada.");
    // Entre los tipos periódicos el tipo sí se corrige —una cochera que se cargó como
    // servicio, una línea que quedó suelta—, porque todos llevan el mismo calendario
    // mensual y lo único que cambia es en qué tabla se lista. Con un préstamo no: su
    // cronograma trae capital, tasa e intereses que ningún otro tipo sabe leer.
    if (before.type !== data.type && (before.type === "PRESTAMO" || data.type === "PRESTAMO")) {
      throw new BusinessError("Un préstamo no se puede convertir en otra cosa, ni al revés. Anula esta obligación y registra una nueva.");
    }

    // Cambiar cuándo vence un servicio no sirve de nada si los vencimientos ya creados se
    // quedan donde estaban: el dato se guardaba y el calendario seguía mostrando las fechas
    // viejas. Si no hay ningún pago registrado, se rehacen desde cero con los datos nuevos.
    const calendarioCambio = before.type !== "PRESTAMO" && (
      (before.firstDueDate ?? "") !== (data.firstDueDate ?? "")
      || before.billingDay !== data.billingDay
      || (before.endsAt ?? "") !== (data.endsAt ?? "")
      || before.variableAmount !== data.variableAmount
      || (before.fixedAmount ?? "") !== (data.fixedAmount ?? "")
    );

    const { row: after, rehecho, conPagos } = await db.transaction(async (tx) => {
      const [row] = await tx.update(obligations).set(data).where(eq(obligations.id, id)).returning();

      let rehecho = 0;
      let conPagos = false;
      if (calendarioCambio) {
        const [{ pagadas }] = await tx
          .select({ pagadas: sql<number>`count(*) filter (where ${obligationInstallments.status} = 'PAGADA')::int` })
          .from(obligationInstallments)
          .where(eq(obligationInstallments.obligationId, id));

        // Con pagos registrados no se toca nada: mover las fechas bajo un pago ya hecho
        // dejaría la historia sin sentido. Los vencimientos nuevos salen al extender.
        conPagos = pagadas > 0;
        if (!conPagos) {
          await tx.delete(obligationInstallments).where(eq(obligationInstallments.obligationId, id));
          rehecho = await generateMonths(tx, row, MONTHS_AHEAD);
        }
      }

      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} modificó "${row.name}".`
          + (rehecho ? ` Se rehizo su calendario: ${rehecho} vencimiento(s).` : ""),
        oldData: before, newData: row,
      }, tx);
      return { row, rehecho, conPagos };
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: rehecho
        ? `"${after.name}" actualizado. Su calendario se rehízo con ${rehecho} vencimiento(s).`
        : conPagos
          ? `"${after.name}" actualizado, pero su calendario no se tocó: ya tiene cuotas pagadas y mover las fechas dejaría esos pagos sin sentido.`
          : `"${after.name}" actualizado correctamente.`,
    };
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
  // Se arranca del mes siguiente al último vencimiento. Si no hay ninguno, manda la fecha
  // de la primera cuota; sin ella, este mes en el día de pago, que es lo de siempre.
  const start = last
    ? monthlyDueDates(last.dueDate, 2)[1]
    : obligation.firstDueDate ?? `${y}-${String(m).padStart(2, "0")}-${day}`;

  // Nada más allá de la vigencia: un contrato a plazo fijo deja de generar vencimientos
  // cuando termina, en vez de seguir acumulando cuotas que nadie va a pagar.
  const fechas = monthlyDueDates(start, months)
    .filter((d) => d >= hoy || !last)
    .filter((d) => !obligation.endsAt || d <= obligation.endsAt);
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

/**
 * Renegociación: cambia el importe mensual a partir de una fecha.
 *
 * Una cochera que costaba 300 se renegocia a 350. Lo de antes se pagó a 300 y así tiene
 * que quedar: cambiar el importe hacia atrás borraría lo que de verdad pasó y dejaría los
 * totales del año sin cuadrar con los pagos hechos.
 *
 * Por eso solo se tocan las cuotas pendientes que vencen desde el mes indicado. Las
 * pagadas no se tocan nunca, y las pendientes anteriores tampoco: si una de agosto quedó
 * debiendo a 300, se sigue debiendo 300.
 *
 * El histórico queda en el propio cronograma —cada mes con el importe que le tocó— y el
 * cambio queda registrado en auditoría con quién, cuándo y desde cuándo rige.
 */
export async function renegotiateAmount(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const data = renegotiationSchema.parse(formToObject(formData));
    const obligation = await loadObligation(id);

    if (obligation.type === "PRESTAMO") {
      throw new BusinessError("Un préstamo no se renegocia por aquí: carga de nuevo el cronograma del banco.");
    }
    if (obligation.status !== "ACTIVA") throw new BusinessError("La obligación no está activa.");

    // Desde el primer día del mes elegido: se renegocia por meses, no por días sueltos.
    const desde = `${data.from.slice(0, 7)}-01`;

    const { cambiadas, intactas } = await db.transaction(async (tx) => {
      const afectadas = await tx.update(obligationInstallments)
        .set({ total: data.amount, updatedAt: new Date() })
        .where(and(
          eq(obligationInstallments.obligationId, id),
          eq(obligationInstallments.status, "PENDIENTE"),
          sql`${obligationInstallments.dueDate} >= ${desde}`,
        ))
        .returning({ id: obligationInstallments.id });

      // Las que quedan con el precio viejo, para decirlo en el mensaje: es la garantía de
      // que no se borró nada hacia atrás.
      const [{ previas }] = await tx
        .select({ previas: sql<number>`count(*)::int` })
        .from(obligationInstallments)
        .where(and(
          eq(obligationInstallments.obligationId, id),
          sql`${obligationInstallments.dueDate} < ${desde}`,
        ));

      // El importe de la obligación se actualiza para que los meses que se generen más
      // adelante salgan ya con el precio nuevo.
      await tx.update(obligations)
        .set({ fixedAmount: data.amount, variableAmount: false, updatedAt: new Date() })
        .where(eq(obligations.id, id));

      await logAudit({
        user, action: "EDITAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} renegoció "${obligation.name}": ${formatMoney(obligation.fixedAmount, obligation.currency)}`
          + ` → ${formatMoney(data.amount, obligation.currency)} desde ${desde.slice(0, 7)}.`
          + ` Se actualizaron ${afectadas.length} vencimiento(s); ${previas} anterior(es) conservan el importe de antes.`,
        oldData: { importe: obligation.fixedAmount },
        newData: { importe: data.amount, desde, motivo: data.reason },
      }, tx);

      return { cambiadas: afectadas.length, intactas: previas };
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: cambiadas === 0
        ? `No había vencimientos pendientes desde ${desde.slice(0, 7)}. El importe nuevo regirá para los que se generen.`
        : `${cambiadas} vencimiento(s) quedaron en ${formatMoney(data.amount, obligation.currency)}.`
          + (intactas > 0 ? ` Los ${intactas} anteriores conservan su importe.` : ""),
    };
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
/**
 * Borra una obligación registrada por error, con su cronograma.
 *
 * Solo se permite mientras no haya ni una cuota pagada. Un préstamo con pagos registrados
 * es historial de caja: si estaba mal, se anula, que lo deja a la vista y explica por qué.
 * Borrarlo dejaría pagos huérfanos y un hueco que nadie podría reconstruir.
 *
 * Lo borrado queda íntegro en auditoría, así que siempre se puede ver qué se eliminó,
 * quién lo hizo y volver a cargarlo si hizo falta.
 */
export async function deleteObligation(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("obligations.manage");
    const before = await loadObligation(id);

    const [{ pagadas }] = await db
      .select({ pagadas: sql<number>`count(*) filter (where ${obligationInstallments.status} = 'PAGADA')::int` })
      .from(obligationInstallments)
      .where(eq(obligationInstallments.obligationId, id));

    if (pagadas > 0) {
      throw new BusinessError(
        `"${before.name}" tiene ${pagadas} cuota(s) pagada(s), así que no se puede eliminar. ` +
        "Anúlala: deja de contar en el calendario y conserva el historial de pagos.",
      );
    }

    await db.transaction(async (tx) => {
      const cuotas = await tx.select().from(obligationInstallments)
        .where(eq(obligationInstallments.obligationId, id));
      await tx.delete(obligationInstallments).where(eq(obligationInstallments.obligationId, id));
      await tx.delete(obligations).where(eq(obligations.id, id));

      await logAudit({
        user, action: "ELIMINAR", module: "OBLIGACIONES", recordId: id,
        description: `${user.name} eliminó ${OBLIGATION_TYPE_LABEL[before.type].toLowerCase()} "${before.name}"`
          + ` de ${before.creditor}${cuotas.length ? ` con sus ${cuotas.length} cuota(s)` : ""}, sin pagos registrados.`,
        oldData: { ...before, cuotas },
      }, tx);
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `"${before.name}" fue eliminada.` };
  } catch (e) {
    return toActionError(e);
  }
}

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
