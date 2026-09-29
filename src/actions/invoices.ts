"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invoiceAttachments, supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { computePayDueDate, formatDate, invoiceNumber, limaDayStart, todayLima } from "@/lib/utils";
import { guideReceivedSchema, invoiceSchema, observeInvoiceSchema, payInvoiceSchema } from "@/lib/validations";
import {
  assertNoDuplicate, customerWarning, deleteAttachment, findDuplicate, findOrCreateSupplier,
  insertInvoice, parseFirstXml, saveAttachment, type ReadFile,
} from "@/server/invoice-service";
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
    const reception = receivedDate ?? todayLima();
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
      const [row] = await tx.update(supplierInvoices)
        .set({
          ...data,
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

    const after = await db.transaction(async (tx) => {
      // Bloqueo de la fila: si dos personas la pagan a la vez, solo una lo consigue.
      const [before] = await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)).for("update");
      if (!before) throw new BusinessError("La factura no existe.");
      if (before.status === "PAGADA") throw new BusinessError("Esta factura ya figura como pagada.");
      if (before.status === "ANULADA") throw new BusinessError("La factura está anulada.");

      const [row] = await tx.update(supplierInvoices).set({
        status: "PAGADA",
        paidAt: data.paidAt,
        paymentReference: data.paymentReference,
        paymentNotes: data.paymentNotes,
        paidBy: user.id,
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

/** Deshace un pago registrado por error. */
export async function reopenInvoice(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.pay");
    const { statusReason } = observeInvoiceSchema.parse(formToObject(formData));
    const before = await loadInvoice(id);
    if (before.status !== "PAGADA") throw new BusinessError("Solo se puede reabrir una factura pagada.");

    const after = await db.transaction(async (tx) => {
      const [row] = await tx.update(supplierInvoices).set({
        status: "PENDIENTE", paidAt: null, paidBy: null, paymentReference: null, paymentNotes: null, statusReason,
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
