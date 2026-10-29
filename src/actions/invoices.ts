"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invoiceAdvances, invoiceAttachments, supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { computePayDueDate, detractionFor, DETRACTION_STATUS_LABEL, DETRACTION_THRESHOLD, formatDate, formatMoney, invoiceNumber, limaDayStart, saldoAPagar, todayLima } from "@/lib/utils";
import { advanceSchema, creditNoteSchema, detractionSchema, guideReceivedSchema, invoiceSchema, observeInvoiceSchema, payInvoiceSchema } from "@/lib/validations";
import {
  assertNoDuplicate, customerWarning, deleteAttachment, detractionFields, findDuplicate,
  findOrCreateSupplier, insertInvoice, parseFirstXml, saveAttachment, type ReadFile,
} from "@/server/invoice-service";
import { guardarVoucher, leerVoucher } from "@/server/payment-proof";
import { activeDriver, maxBytesFor } from "@/server/storage";

const label = (i: { series: string; number: string }) => invoiceNumber(i.series, i.number);

async function loadInvoice(id: string) {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).limit(1);
  if (!row) throw new BusinessError("La factura no existe.");
  return row;
}

/** Fecha de llegada de una factura ya guardada, en horario de Lima. */
function receptionYmd(row: { receivedAt: Date | null; createdAt: Date }) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(row.receivedAt ?? row.createdAt);
}

/**
 * Anota la entrega física de la guía de remisión. Es lo que hace arrancar el plazo de una
 * factura a crédito: hasta que el proveedor entrega la guía en mano, no hay fecha de pago.
 */
export async function setGuideReceived(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { guideReceivedAt, notes } = guideReceivedSchema.parse(formToObject(formData));
    if (guideReceivedAt > todayLima()) throw new BusinessError("La fecha de entrega no puede ser futura.");

    const before = await loadInvoice(id);
    if (before.status === "PAGADA") throw new BusinessError("La factura ya está pagada.");
    if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");
    if (before.paymentTerm !== "CREDITO") {
      throw new BusinessError("Solo las facturas a crédito esperan la entrega de la guía. Esta es al contado.");
    }

    const after = await db.transaction(async (tx) => {
      const payDueDate = computePayDueDate({
        paymentTerm: "CREDITO",
        termDays: before.termDays,
        receptionYmd: receptionYmd(before),
        guideReceivedAt,
      });
      const [row] = await tx.update(supplierInvoices)
        .set({ guideReceivedAt, payDueDate, notes: notes ?? before.notes })
        .where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: id,
        description: `${user.name} anotó la entrega de la guía de la factura ${label(row)} el ${formatDate(guideReceivedAt)}. Vence el ${formatDate(payDueDate)}.`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Guía anotada. La factura ${label(after)} vence el ${formatDate(after.payDueDate)}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function createInvoice(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { receivedDate, ...data } = invoiceSchema.parse(formToObject(formData));
    // Sin esta fecha el plazo de pago se calculaba desde hoy sin decírselo a nadie: una
    // factura que llegó la semana pasada vencía una semana tarde. El formulario la pide
    // con asterisco, así que el servidor también la exige.
    if (!receivedDate) {
      throw new BusinessError("Indica cuándo llegó el correo con la factura: desde esa fecha corre el plazo de pago.");
    }
    const reception = receivedDate;
    const invoice = await db.transaction(async (tx) => {
      const created = await insertInvoice(tx, {
        ...data,
        receivedAt: limaDayStart(reception),
        payDueDate: computePayDueDate({
          paymentTerm: data.paymentTerm,
          termDays: data.termDays,
          receptionYmd: reception,
          guideReceivedAt: data.guideReceivedAt,
        }),
      }, user);
      await logAudit({
        user, action: "CREAR", module: "FACTURAS", recordId: created.id,
        description: `${user.name} registró la factura ${label(created)} por ${created.currency} ${created.total}.`,
        newData: created,
      }, tx);
      return created;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(invoice)} registrada correctamente.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function updateInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { receivedDate, ...data } = invoiceSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);
    if (before.status === "PAGADA") throw new BusinessError("La factura ya está pagada. Reábrela antes de modificarla.");
    if (before.status === "ANULADA") throw new BusinessError("La factura está anulada y no se puede modificar.");

    const changedDoc =
      before.supplierId !== data.supplierId || before.docType !== data.docType ||
      before.series !== data.series || before.number !== data.number;

    const after = await db.transaction(async (tx) => {
      if (changedDoc) {
        const dup = await findDuplicate(tx, data);
        if (dup && dup.id !== id) throw new BusinessError(`El comprobante ${label(data)} ya está registrado para ese proveedor.`);
      }
      // El plazo se recalcula en cada edición: cambiar la condición, los días o la fecha
      // de llegada mueve la fecha límite, y dejarla vieja llevaría a pagar tarde.
      const reception = receivedDate ?? receptionYmd(before);
      // Si el importe cambió, la detracción se recalcula. Pero una ya depositada no se
      // toca: el dinero está en el Banco de la Nación y reescribir la cifra haría que el
      // sistema dejara de cuadrar con la constancia.
      // También se recalcula al cambiar de transporte a servicio: un servicio no lleva
      // detracción, y dejar la vieja sería reclamar un depósito que no corresponde.
      const recalcular = before.detractionStatus !== "PAGADA"
        && (data.total !== before.total || data.serviceType !== before.serviceType);
      const [row] = await tx.update(supplierInvoices)
        .set({
          ...data,
          ...(recalcular ? detractionFields(data.total, data.currency, data.serviceType) : {}),
          ...(receivedDate ? { receivedAt: limaDayStart(receivedDate) } : {}),
          payDueDate: computePayDueDate({
            paymentTerm: data.paymentTerm,
            termDays: data.termDays,
            receptionYmd: reception,
            guideReceivedAt: data.guideReceivedAt,
          }),
        })
        .where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: id,
        description: `${user.name} modificó la factura ${label(row)}.`, oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(after)} actualizada correctamente.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Marca la factura como pagada: es la acción principal de la encargada. */
export async function payInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.pay");
    const data = payInvoiceSchema.parse(formToObject(formData));
    if (data.paidAt > todayLima()) throw new BusinessError("La fecha de pago no puede ser futura.");
    // El voucher se lee y se revisa antes de abrir la transacción: si no sirve, la factura
    // no tiene por qué haber empezado a marcarse como pagada.
    const voucher = await leerVoucher(formData, {
      requerido: true,
      falta: "Falta la imagen de la transferencia: sin el voucher el pago no se registra.",
    });

    const after = await db.transaction(async (tx) => {
      // Bloqueo de la fila: si dos personas la pagan a la vez, solo una lo consigue.
      const [before] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).for("update");
      if (!before) throw new BusinessError("La factura no existe.");
      if (before.status === "PAGADA") throw new BusinessError("Esta factura ya figura como pagada.");
      if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");

      const proofId = await guardarVoucher(tx, voucher!, { invoiceId: id, uploadedBy: user.id });

      const [row] = await tx.update(supplierInvoices).set({
        status: "PAGADA",
        paidAt: data.paidAt,
        paymentReference: data.paymentReference,
        paymentNotes: data.paymentNotes,
        paidBy: user.id,
        paymentProofId: proofId,
        statusReason: null,
      }).where(eq(supplierInvoices.id, id)).returning();

      await logAudit({
        user, action: "PAGAR", module: "FACTURAS", recordId: id,
        description: `${user.name} registró el pago de la factura ${label(row)} por ${row.currency} ${row.total}${data.paymentReference ? ` (${data.paymentReference})` : ""}.`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(after)} marcada como pagada.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Registra un adelanto entregado al proveedor a cuenta de una factura.
 *
 * Vive aparte del pago porque no cierra la factura: baja el saldo y la deja pendiente por
 * la diferencia. Cada adelanto queda con su fecha, su importe y su voucher.
 *
 * La columna `advances` de la factura —de donde salen el saldo a transferir y los reportes—
 * queda como la suma de los adelantos registrados MÁS lo que hubiera anotado a mano antes
 * de que existiera este registro. Las facturas que vinieron del control en Excel traen su
 * adelanto como un número suelto, y recalcular solo desde las filas lo haría desaparecer el
 * día en que se registre el primer adelanto nuevo de esa factura.
 */
export async function payAdvance(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.pay");
    const data = advanceSchema.parse(formToObject(formData));
    if (data.paidAt > todayLima()) throw new BusinessError("La fecha del adelanto no puede ser futura.");
    const voucher = await leerVoucher(formData, {
      requerido: true,
      falta: "Falta la imagen de la transferencia: sin el voucher el adelanto no se registra.",
    });

    const resultado = await db.transaction(async (tx) => {
      const [before] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).for("update");
      if (!before) throw new BusinessError("La factura no existe.");
      if (before.status === "PAGADA") {
        throw new BusinessError("Esta factura ya figura como pagada: no caben más adelantos.");
      }
      if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");

      // Lo que todavía se le debe al proveedor: el total menos la detracción y menos lo ya
      // adelantado. Un adelanto por encima de eso sería pagarle de más.
      const saldo = Number(saldoAPagar(before.total, before.detractionAmount, before.advances));
      const monto = Number(data.amount);
      if (monto > saldo + 0.004) {
        throw new BusinessError(
          `El adelanto es mayor que el saldo: quedan ${formatMoney(saldo, before.currency)} por transferirle.`,
        );
      }

      // Lo anotado a mano que no corresponde a ninguna fila: se conserva tal cual.
      const [{ suma: previas }] = await tx.select({ suma: sql<string>`coalesce(sum(${invoiceAdvances.amount}), 0)::text` })
        .from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id));
      const aMano = Math.max(0, Number(before.advances ?? 0) - Number(previas));

      const proofId = await guardarVoucher(tx, voucher!, { invoiceId: id, uploadedBy: user.id });

      const [adelanto] = await tx.insert(invoiceAdvances).values({
        invoiceId: id,
        amount: data.amount,
        paidAt: data.paidAt,
        paymentReference: data.paymentReference,
        notes: data.notes,
        proofId,
        paidBy: user.id,
      }).returning();

      // La suma se recalcula desde las filas, no se le suma al número que había: así un
      // adelanto borrado o corregido no deja la factura descuadrada.
      const [{ suma }] = await tx.select({ suma: sql<string>`coalesce(sum(${invoiceAdvances.amount}), 0)::text` })
        .from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, id));

      const [row] = await tx.update(supplierInvoices)
        .set({ advances: (aMano + Number(suma)).toFixed(2) })
        .where(eq(supplierInvoices.id, id)).returning();

      await logAudit({
        user, action: "PAGAR", module: "FACTURAS", recordId: id,
        description: `${user.name} registró un adelanto de ${formatMoney(adelanto.amount, row.currency)}`
          + ` a cuenta de la factura ${label(row)}${data.paymentReference ? ` (${data.paymentReference})` : ""}.`,
        oldData: { adelantos: before.advances, saldo: saldo.toFixed(2) },
        newData: { adelantos: row.advances, saldo: saldoAPagar(row.total, row.detractionAmount, row.advances) },
      }, tx);

      return { row, adelanto };
    });

    revalidatePath("/", "layout");
    const saldo = saldoAPagar(resultado.row.total, resultado.row.detractionAmount, resultado.row.advances);
    return {
      ok: true,
      message: `Adelanto de ${formatMoney(resultado.adelanto.amount, resultado.row.currency)} registrado.`
        + ` Quedan ${formatMoney(saldo, resultado.row.currency)} por transferirle.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Deshace un adelanto registrado por error. El voucher queda entre los archivos de la factura. */
export async function removeAdvance(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.pay");

    const resultado = await db.transaction(async (tx) => {
      const [adelanto] = await tx.select().from(invoiceAdvances).where(eq(invoiceAdvances.id, id)).limit(1);
      if (!adelanto) throw new BusinessError("El adelanto no existe.");

      const [invoice] = await tx.select().from(supplierInvoices)
        .where(eq(supplierInvoices.id, adelanto.invoiceId)).for("update");
      if (invoice.status === "PAGADA") {
        throw new BusinessError("La factura ya está pagada: reabre el pago antes de tocar los adelantos.");
      }

      // Lo anotado a mano se respeta igual que al registrar: quitar un adelanto no puede
      // llevarse por delante el número que traía la factura del control en Excel.
      const [{ suma: previas }] = await tx.select({ suma: sql<string>`coalesce(sum(${invoiceAdvances.amount}), 0)::text` })
        .from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, adelanto.invoiceId));
      const aMano = Math.max(0, Number(invoice.advances ?? 0) - Number(previas));

      await tx.delete(invoiceAdvances).where(eq(invoiceAdvances.id, id));
      const [{ suma }] = await tx.select({ suma: sql<string>`coalesce(sum(${invoiceAdvances.amount}), 0)::text` })
        .from(invoiceAdvances).where(eq(invoiceAdvances.invoiceId, adelanto.invoiceId));
      const total = aMano + Number(suma);
      const [row] = await tx.update(supplierInvoices)
        .set({ advances: total > 0 ? total.toFixed(2) : null })
        .where(eq(supplierInvoices.id, adelanto.invoiceId)).returning();

      await logAudit({
        user, action: "ELIMINAR", module: "FACTURAS", recordId: adelanto.invoiceId,
        description: `${user.name} quitó un adelanto de ${formatMoney(adelanto.amount, row.currency)}`
          + ` de la factura ${label(row)}.`,
        oldData: adelanto, newData: { adelantos: row.advances },
      }, tx);

      return row;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `El adelanto se quitó de la factura ${label(resultado)}.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Deshace un pago registrado por error. */
export async function reopenInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.pay");
    const { statusReason } = observeInvoiceSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);
    if (before.status !== "PAGADA") throw new BusinessError("Solo se puede reabrir una factura pagada.");

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({
        status: "PENDIENTE", paidAt: null, paidBy: null, paymentReference: null, paymentNotes: null,
        // El voucher se queda entre los archivos de la factura —el pago existió— pero deja
        // de respaldar un pago vigente.
        paymentProofId: null, statusReason,
      }).where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "REABRIR", module: "FACTURAS", recordId: id,
        description: `${user.name} reabrió la factura ${label(row)} (el pago quedó sin efecto). Motivo: ${statusReason}`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(after)} reabierta: vuelve a quedar pendiente de pago.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Devuelve la factura al proveedor por falta de documentos o datos que no coinciden. */
export async function observeInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { statusReason } = observeInvoiceSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);
    if (before.status === "PAGADA") throw new BusinessError("La factura ya está pagada. Reábrela antes de observarla.");
    if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({ status: "OBSERVADA", statusReason })
        .where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "OBSERVAR", module: "FACTURAS", recordId: id,
        description: `${user.name} observó la factura ${label(row)}. Motivo: ${statusReason}`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(after)} marcada como observada. Avisa al proveedor para que la corrija.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Una factura observada que el proveedor ya corrigió vuelve a la cola de pago. */
export async function restoreInvoice(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const before = await loadInvoice(id);
    if (before.status !== "OBSERVADA") throw new BusinessError("Solo se puede reactivar una factura observada.");

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({ status: "PENDIENTE", statusReason: null })
        .where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: id,
        description: `${user.name} reactivó la factura ${label(row)}: vuelve a estar pendiente de pago.`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${label(after)} pendiente de pago nuevamente.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Anula el registro. La factura no se borra: queda marcada y fuera de los totales. */
export async function voidInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { statusReason } = observeInvoiceSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);
    if (before.status === "ANULADA") throw new BusinessError("Esta factura ya está anulada.");
    if (before.status === "PAGADA") throw new BusinessError("La factura está pagada. Reábrela antes de anularla.");

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({ status: "ANULADA", statusReason })
        .where(eq(supplierInvoices.id, id)).returning();
      await logAudit({
        user, action: "ANULAR", module: "FACTURAS", recordId: id,
        description: `${user.name} anuló el registro de la factura ${label(row)}. Motivo: ${statusReason}`,
        oldData: before, newData: row,
      }, tx);
      return row;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Registro de la factura ${label(after)} anulado.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Registra la nota de crédito con la que el proveedor anula la factura.
 *
 * Una factura mal emitida no se borra ni se corrige: existe ante SUNAT y la única forma de
 * dejarla sin efecto es que el proveedor emita una nota de crédito por el mismo importe.
 * Por eso esto no es un campo más, sino la operación que anula: deja la factura anulada,
 * con la NC al lado, fuera de lo que hay que pagar y fuera de las detracciones.
 */
export async function registerCreditNote(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const data = creditNoteSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);

    if (before.status === "PAGADA") {
      throw new BusinessError(
        "La factura ya está pagada: el dinero salió. Si el proveedor la anuló, reabre el pago"
        + " primero y después registra la nota de crédito.",
      );
    }

    // La NC tiene que cubrir la factura entera. Una por menos sería una rebaja, no una
    // anulación, y dejaría la factura medio viva sin que nadie sepa cuánto se le debe.
    const total = Number(before.total);
    const monto = Number(data.creditNoteAmount);
    if (Math.abs(monto - total) > 0.009) {
      throw new BusinessError(
        `La nota de crédito es por ${formatMoney(monto, before.currency)} y la factura `
        + `${label(before)} es de ${formatMoney(total, before.currency)}. Para anularla, la nota `
        + "tiene que ser por el importe completo.",
      );
    }

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({
        status: "ANULADA",
        awaitingCreditNote: false,
        creditNoteNumber: data.creditNoteNumber,
        creditNoteDate: data.creditNoteDate,
        creditNoteAmount: monto.toFixed(2),
        creditNoteRegisteredBy: user.id,
        creditNoteRegisteredAt: new Date(),
        statusReason: data.notes ?? before.statusReason,
        // Lo que no se llegó a depositar ya no se deposita: la operación quedó sin efecto.
        // Si la detracción YA está depositada no se toca, porque el dinero está en el Banco
        // de la Nación y la constancia dice otra cosa.
        ...(before.detractionStatus === "PAGADA"
          ? {}
          : { detractionStatus: "NO_APLICA" as const }),
      }).where(eq(supplierInvoices.id, id)).returning();

      await logAudit({
        user, action: "ANULAR", module: "FACTURAS", recordId: id,
        description: `${user.name} anuló la factura ${label(row)} con la nota de crédito `
          + `${data.creditNoteNumber}, por ${formatMoney(monto, row.currency)}.`
          + (before.detractionStatus === "PAGADA"
            ? " La detracción ya estaba depositada y se dejó como estaba."
            : ""),
        oldData: before, newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Factura ${label(after)} anulada con la nota de crédito ${data.creditNoteNumber}.`
        + (before.detractionStatus === "PAGADA"
          ? " Su detracción ya estaba depositada: revísala con el proveedor."
          : ""),
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Marca una factura anulada como pendiente de que llegue la nota de crédito, o deja de
 * esperarla.
 *
 * Sirve para perseguir al proveedor. Sin esta marca, una anulada sin NC se ve igual que
 * una ya resuelta y nadie vuelve a reclamársela.
 */
export async function toggleAwaitingCreditNote(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const before = await loadInvoice(id);
    if (before.creditNoteNumber) {
      throw new BusinessError("Esta factura ya tiene su nota de crédito registrada.");
    }
    if (before.status !== "ANULADA") {
      throw new BusinessError("Solo una factura anulada puede estar esperando su nota de crédito.");
    }

    const esperando = !before.awaitingCreditNote;
    await db.update(supplierInvoices).set({ awaitingCreditNote: esperando })
      .where(eq(supplierInvoices.id, id));

    await logAudit({
      user, action: "EDITAR", module: "FACTURAS", recordId: id,
      description: esperando
        ? `${user.name} marcó la factura ${label(before)} como pendiente de nota de crédito.`
        : `${user.name} dejó de esperar la nota de crédito de la factura ${label(before)}.`,
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: esperando
        ? "Queda a la espera de la nota de crédito del proveedor."
        : "Ya no figura esperando nota de crédito.",
    };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Archivos adjuntos
// ---------------------------------------------------------------------------

const ALLOWED = /\.(pdf|xml|zip|png|jpg|jpeg)$/i;

async function readFiles(formData: FormData, field = "files"): Promise<ReadFile[]> {
  const limit = maxBytesFor();
  const out: ReadFile[] = [];
  for (const entry of formData.getAll(field)) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (!ALLOWED.test(entry.name)) throw new BusinessError(`El archivo ${entry.name} no es un PDF, XML, ZIP ni imagen.`);
    if (entry.size > limit) {
      throw new BusinessError(`${entry.name} pesa demasiado. El máximo es ${Math.floor(limit / 1024 / 1024)} MB por archivo.`);
    }
    out.push({
      filename: entry.name,
      contentType: entry.type || "application/octet-stream",
      data: Buffer.from(await entry.arrayBuffer()),
    });
  }
  return out;
}

export async function uploadInvoiceAttachments(invoiceId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const invoice = await loadInvoice(invoiceId);
    const files = await readFiles(formData);
    if (files.length === 0) throw new BusinessError("Selecciona al menos un archivo.");

    await db.transaction(async (tx) => {
      for (const file of files) {
        await saveAttachment(tx, { invoiceId, ...file, uploadedBy: user.id });
      }
      await logAudit({
        user, action: "ADJUNTAR", module: "FACTURAS", recordId: invoiceId,
        description: `${user.name} adjuntó ${files.length} archivo(s) a la factura ${label(invoice)}: ${files.map((f) => f.filename).join(", ")}.`,
        newData: { archivos: files.map((f) => ({ nombre: f.filename, bytes: f.data.byteLength })) },
      }, tx);
    });
    revalidatePath("/", "layout");
    return { ok: true, message: files.length === 1 ? "Archivo adjuntado correctamente." : `${files.length} archivos adjuntados.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function removeInvoiceAttachment(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const [row] = await db.select({ invoiceId: invoiceAttachments.invoiceId, filename: invoiceAttachments.filename })
      .from(invoiceAttachments).where(eq(invoiceAttachments.id, id)).limit(1);
    if (!row) throw new BusinessError("El archivo no existe.");
    await deleteAttachment(id);
    await logAudit({
      user, action: "ELIMINAR", module: "FACTURAS", recordId: row.invoiceId,
      description: `${user.name} eliminó el archivo ${row.filename} de una factura.`,
      oldData: { archivo: row.filename },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Archivo eliminado." };
  } catch (e) {
    return toActionError(e);
  }
}

// ---------------------------------------------------------------------------
// Registro a partir del XML del comprobante
// ---------------------------------------------------------------------------

/**
 * Crea la factura leyendo el XML de SUNAT y adjunta los archivos recibidos.
 * Es el mismo camino que usa la lectura automática del correo.
 */
export async function importInvoiceFromFiles(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const files = await readFiles(formData);
    if (files.length === 0) throw new BusinessError("Selecciona el XML del comprobante (y el PDF, si lo tienes).");

    const result = parseFirstXml(files);
    if ("error" in result) throw new BusinessError(result.error);
    const { parsed } = result;

    const aviso = customerWarning(parsed);

    const invoice = await db.transaction(async (tx) => {
      const { supplier, created } = await findOrCreateSupplier(
        tx, { ruc: parsed.supplierRuc, businessName: parsed.supplierName }, user,
      );
      const row = await insertInvoice(tx, {
        supplierId: supplier.id,
        docType: parsed.docType,
        series: parsed.series,
        number: parsed.number,
        issueDate: parsed.issueDate,
        dueDate: parsed.dueDate,
        currency: parsed.currency,
        subtotal: parsed.subtotal,
        igv: parsed.igv,
        total: parsed.total,
        description: parsed.description,
        grtNumber: parsed.grtNumber,
        source: "MANUAL",
      }, user);

      for (const file of files) {
        await saveAttachment(tx, { invoiceId: row.id, ...file, uploadedBy: user.id });
      }
      await logAudit({
        user, action: "IMPORTAR", module: "FACTURAS", recordId: row.id,
        description: `${user.name} registró la factura ${label(row)} de ${supplier.businessName} leyendo el XML del comprobante${created ? " (proveedor nuevo)" : ""}.`,
        newData: { factura: row, archivos: files.map((f) => f.filename) },
      }, tx);
      return { row, supplier, created };
    });

    revalidatePath("/", "layout");
    const extra = [
      invoice.created ? `Se registró al proveedor ${invoice.supplier.businessName}.` : null,
      aviso,
    ].filter(Boolean).join(" ");
    return { ok: true, message: `Factura ${label(invoice.row)} registrada desde el XML.${extra ? ` ${extra}` : ""}` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Información del modo de almacenamiento, para avisar en pantalla dónde se guardan los archivos. */
export async function storageInfo() {
  await requireActionUser("invoices.view");
  const driver = activeDriver();
  return { driver, maxBytes: maxBytesFor(driver) };
}

/** Proveedores activos para los selectores del formulario. */
export async function supplierOptions() {
  await requireActionUser("invoices.view");
  return db.select({ id: suppliers.id, ruc: suppliers.ruc, name: suppliers.businessName })
    .from(suppliers).where(eq(suppliers.active, true));
}

/**
 * Registra el estado y el depósito de la detracción.
 *
 * Es la única acción del rol de Detracciones: quien la ejerce no registra facturas ni paga
 * proveedores, solo da cuenta del 4 % que va al Banco de la Nación. El monto no se escribe
 * a mano: sale del importe de la factura, que es lo que evita las diferencias de un sol que
 * tenía el control en Excel.
 */
export async function setDetraction(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("detractions.manage");
    const data = detractionSchema.parse(formToObject(formData));
    if (data.detractionPaidAt && data.detractionPaidAt > todayLima()) {
      throw new BusinessError("La fecha del depósito no puede ser futura.");
    }

    const before = await loadInvoice(id);
    if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");

    const calculo = detractionFor(before.total, Number(before.detractionRate), before.currency);
    if (!calculo.applies && data.detractionStatus !== "NO_APLICA") {
      throw new BusinessError(
        `Esta operación es de ${formatMoney(before.total, before.currency)} y no supera los S/ ${DETRACTION_THRESHOLD}, así que no se detrae.`,
      );
    }
    if (calculo.applies && data.detractionStatus === "NO_APLICA") {
      throw new BusinessError("Esta operación sí supera el umbral: la detracción no se puede marcar como no aplicable.");
    }
    if (data.detractionStatus === "PAGADA" && !data.detractionReceipt) {
      throw new BusinessError("Para dar una detracción por pagada hace falta el número de constancia.");
    }

    // La imagen de la constancia se exige solo al darla por depositada, que es cuando sale
    // la plata. Si ya había una guardada, no hay que volver a subirla para corregir una nota.
    const exigeVoucher = data.detractionStatus === "PAGADA" && !before.detractionProofId;
    const voucher = await leerVoucher(formData, {
      requerido: exigeVoucher,
      falta: "Falta la imagen de la constancia del depósito: sin ella la detracción no se da por pagada.",
    });

    const after = await db.transaction(async (tx) => {
      const proofId = voucher
        ? await guardarVoucher(tx, voucher, { invoiceId: id, uploadedBy: user.id })
        : before.detractionProofId;

      const [row] = await tx.update(supplierInvoices).set({
        detractionProofId: data.detractionStatus === "PAGADA" ? proofId : before.detractionProofId,
        detractionStatus: data.detractionStatus,
        detractionAmount: calculo.amount.toFixed(2),
        detractionPaidAt: data.detractionPaidAt,
        detractionReceipt: data.detractionReceipt,
        detractionOperation: data.detractionOperation,
        detractionNotes: data.detractionNotes,
        detractionBy: user.id,
      }).where(eq(supplierInvoices.id, id)).returning();

      await logAudit({
        user, action: "EDITAR", module: "DETRACCIONES", recordId: id,
        description: `${user.name} dejó la detracción de la factura ${label(row)} como ${DETRACTION_STATUS_LABEL[data.detractionStatus].toLowerCase()}`
          + (data.detractionStatus === "PAGADA"
            ? `: ${formatMoney(row.detractionAmount, row.currency)} depositados el ${formatDate(data.detractionPaidAt)}, constancia ${data.detractionReceipt}.`
            : "."),
        oldData: before, newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Detracción de ${label(after)}: ${DETRACTION_STATUS_LABEL[data.detractionStatus].toLowerCase()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
