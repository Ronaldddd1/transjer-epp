import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { invoiceAttachments, invoiceEmails, supplierInvoices, type InvoiceEmail } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import {
  computePayDueDate, invoiceNumber, REJECT_REASON_LABEL, TERM_DAYS_BY_SERVICE_TYPE,
  type InvoiceServiceTypeKey, type PaymentTermKey, type RejectReasonKey,
} from "@/lib/utils";
import { findDuplicate, findOrCreateSupplier, insertInvoice } from "./invoice-service";
import type { ParsedInvoice } from "./sunat-xml";

/**
 * Aceptar un comprobante que llegó por correo.
 *
 * Esto es lo que antes hacía el buzón solo. Ahora pasa aquí, cuando una persona lo
 * aprueba: se da de alta al proveedor si hacía falta, se crea la factura con los datos
 * del XML y los archivos del correo pasan a colgar de la factura, que es donde se buscan
 * después.
 */

export type ApprovalOverrides = {
  paymentTerm?: PaymentTermKey;
  termDays?: number;
  description?: string | null;
  /** Transporte o servicio, lo que decide quien aprueba. */
  serviceType?: InvoiceServiceTypeKey;
  /** Datos del viaje, leídos del concepto y corregidos a mano si hacía falta. */
  viaje?: {
    serviceDate?: string | null;
    plate?: string | null;
    clientName?: string | null;
    originCity?: string | null;
    destinationCity?: string | null;
    grtNumber?: string | null;
    dispatchNote?: string | null;
  };
};

export type ApprovalResult =
  | { ok: true; invoiceId: string; label: string }
  | { ok: false; error: string };

/** Los datos del comprobante tal como se leyeron del XML. */
export function parsedOf(email: Pick<InvoiceEmail, "parsed">): ParsedInvoice | null {
  const p = email.parsed as ParsedInvoice | null;
  return p && typeof p === "object" && "series" in p ? p : null;
}

export async function registerApprovedEmail(
  tx: Tx,
  email: InvoiceEmail,
  user: Pick<CurrentUser, "id" | "name">,
  overrides: ApprovalOverrides = {},
): Promise<ApprovalResult> {
  const parsed = parsedOf(email);
  if (!parsed) return { ok: false, error: "Este correo no tiene los datos del comprobante leídos." };

  const { supplier } = await findOrCreateSupplier(
    tx, { ruc: parsed.supplierRuc, businessName: parsed.supplierName }, user,
  );

  const docRef = {
    supplierId: supplier.id, docType: parsed.docType,
    series: parsed.series, number: parsed.number,
  };
  const label = invoiceNumber(parsed.series, parsed.number);

  // Entre que llegó el correo y que alguien lo aprueba pudo registrarse la misma factura
  // a mano. Se comprueba otra vez aquí, no solo al recibir el correo.
  const duplicate = await findDuplicate(tx, docRef);
  if (duplicate) {
    await tx.update(invoiceEmails).set({
      status: "DESCARTADO",
      invoiceId: duplicate.id,
      detail: `El comprobante ${label} de ${supplier.businessName} ya estaba registrado.`,
      decidedBy: user.id,
      decidedAt: new Date(),
      processedAt: new Date(),
    }).where(eq(invoiceEmails.id, email.id));
    return { ok: false, error: `El comprobante ${label} ya estaba registrado. El correo quedó descartado.` };
  }

  /**
   * La condición de pago sale de lo pactado con el proveedor, salvo que quien aprueba
   * diga otra cosa. Si es a crédito, la factura entra sin fecha límite: el plazo arranca
   * cuando alguien anote la entrega física de la guía, que el sistema no puede saber.
   */
  const paymentTerm = overrides.paymentTerm ?? supplier.defaultPaymentTerm;
  /**
   * El plazo sale de lo que se compró: un flete se paga a 15 días de recibida la
   * factura y un servicio corriente al contado. Quien aprueba puede cambiarlo, pero el
   * número propuesto ya es el de la regla.
   */
  const termDays = overrides.termDays
    ?? (overrides.serviceType ? TERM_DAYS_BY_SERVICE_TYPE[overrides.serviceType] : supplier.defaultTermDays);
  const recepcion = email.receivedAt;
  const recepcionYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(recepcion);

  const invoice = await insertInvoice(tx, {
    ...docRef,
    issueDate: parsed.issueDate,
    dueDate: parsed.dueDate,
    currency: parsed.currency,
    subtotal: parsed.subtotal,
    igv: parsed.igv,
    total: parsed.total,
    description: overrides.description ?? parsed.description,
    serviceType: overrides.serviceType ?? null,
    // La guía del transportista puede venir en el XML o leerse del concepto; lo que
    // escribió quien aprueba manda sobre las dos.
    grtNumber: overrides.viaje?.grtNumber ?? parsed.grtNumber,
    dispatchNote: overrides.viaje?.dispatchNote ?? null,
    serviceDate: overrides.viaje?.serviceDate ?? null,
    plate: overrides.viaje?.plate ?? null,
    clientName: overrides.viaje?.clientName ?? null,
    originCity: overrides.viaje?.originCity ?? null,
    destinationCity: overrides.viaje?.destinationCity ?? null,
    source: "CORREO",
    receivedAt: recepcion,
    paymentTerm,
    termDays,
    payDueDate: computePayDueDate({ paymentTerm, termDays, receptionYmd: recepcionYmd }),
  }, user);

  // Los archivos ya estaban guardados colgando del correo: se les pone la factura, sin
  // volver a subirlos. Si se copiaran, el mismo PDF quedaría dos veces en el almacén.
  await tx.update(invoiceAttachments)
    .set({ invoiceId: invoice.id })
    .where(and(eq(invoiceAttachments.emailId, email.id), isNull(invoiceAttachments.invoiceId)));

  await tx.update(invoiceEmails).set({
    status: "PROCESADO",
    invoiceId: invoice.id,
    decidedBy: user.id,
    decidedAt: new Date(),
    processedAt: new Date(),
  }).where(eq(invoiceEmails.id, email.id));

  await logAudit({
    user,
    action: "IMPORTAR",
    module: "CORREO",
    recordId: invoice.id,
    description: `${user.name} aceptó el comprobante ${label} de ${supplier.businessName}`
      + ` y quedó registrado como factura por pagar.`,
    newData: { factura: invoice, correo: { asunto: email.subject, de: email.fromAddress } },
  }, tx);

  return { ok: true, invoiceId: invoice.id, label };
}

/**
 * Registra como factura ANULADA un comprobante que se le devolvió al proveedor.
 *
 * Parece contradictorio guardar lo que se acaba de rechazar, y no lo es: esa factura
 * existe ante SUNAT, el proveedor la declaró, y hasta que no emita la nota de crédito
 * sigue viva en su contabilidad. Si aquí no queda rastro, dentro de tres meses nadie sabe
 * por qué ese número de factura no está, ni que falta reclamarle la NC.
 *
 * Queda fuera de lo que hay que pagar y fuera de las detracciones, marcada como "espera
 * nota de crédito", y con el motivo del rechazo a la vista en su ficha.
 */
export async function registerRejectedEmail(
  tx: Tx,
  email: InvoiceEmail,
  user: Pick<CurrentUser, "id" | "name">,
  motivo: { reason: string; comment?: string | null },
): Promise<ApprovalResult> {
  const parsed = parsedOf(email);
  if (!parsed) return { ok: false, error: "Este correo no tiene los datos del comprobante leídos." };

  const { supplier } = await findOrCreateSupplier(
    tx, { ruc: parsed.supplierRuc, businessName: parsed.supplierName }, user,
  );

  const docRef = {
    supplierId: supplier.id, docType: parsed.docType,
    series: parsed.series, number: parsed.number,
  };
  const label = invoiceNumber(parsed.series, parsed.number);

  // Si ya estaba registrada, no se duplica: se anula la que hay y se marca que espera NC.
  const duplicate = await findDuplicate(tx, docRef);
  if (duplicate) {
    await tx.update(supplierInvoices).set({
      status: "ANULADA",
      awaitingCreditNote: !duplicate.creditNoteNumber,
      statusReason: razonDelRechazo(motivo),
      // Se le quita la fecha límite: si se la dejara, una factura que acabamos de
      // devolver seguiría saliendo en el calendario de pagos y en los avisos de
      // vencimiento, reclamando que se pague algo que ya no se va a pagar.
      payDueDate: null,
      ...(duplicate.detractionStatus === "PAGADA" ? {} : { detractionStatus: "NO_APLICA" as const }),
    }).where(eq(supplierInvoices.id, duplicate.id));
    await tx.update(invoiceEmails).set({ invoiceId: duplicate.id }).where(eq(invoiceEmails.id, email.id));
    return { ok: true, invoiceId: duplicate.id, label };
  }

  const invoice = await insertInvoice(tx, {
    ...docRef,
    issueDate: parsed.issueDate,
    dueDate: parsed.dueDate,
    currency: parsed.currency,
    subtotal: parsed.subtotal,
    igv: parsed.igv,
    total: parsed.total,
    description: parsed.description,
    serviceType: null,
    grtNumber: parsed.grtNumber,
    source: "CORREO",
    receivedAt: email.receivedAt,
    // Sin fecha límite: una factura anulada no se paga, y darle un vencimiento la metería
    // en los avisos de pago y en el calendario.
    payDueDate: null,
  }, user);

  const [anulada] = await tx.update(supplierInvoices).set({
    status: "ANULADA",
    awaitingCreditNote: true,
    statusReason: razonDelRechazo(motivo),
    detractionStatus: "NO_APLICA",
    detractionAmount: "0.00",
  }).where(eq(supplierInvoices.id, invoice.id)).returning();

  // Los archivos del correo pasan a colgar de la factura, igual que al aceptarla: el PDF
  // rechazado es justamente lo que hay que poder enseñar cuando el proveedor pregunte.
  await tx.update(invoiceAttachments)
    .set({ invoiceId: invoice.id })
    .where(and(eq(invoiceAttachments.emailId, email.id), isNull(invoiceAttachments.invoiceId)));

  await tx.update(invoiceEmails).set({ invoiceId: invoice.id }).where(eq(invoiceEmails.id, email.id));

  await logAudit({
    user,
    action: "ANULAR",
    module: "CORREO",
    recordId: invoice.id,
    description: `${user.name} rechazó el comprobante ${label} de ${supplier.businessName}`
      + ` y quedó registrado como factura anulada, a la espera de la nota de crédito.`,
    newData: { factura: anulada, motivo: razonDelRechazo(motivo) },
  }, tx);

  return { ok: true, invoiceId: invoice.id, label };
}

/** El motivo, en una línea, para que se lea en la ficha de la factura sin abrir el correo. */
function razonDelRechazo(motivo: { reason: string; comment?: string | null }): string {
  const texto = REJECT_REASON_LABEL[motivo.reason as RejectReasonKey] ?? motivo.reason;
  return `Rechazada: ${texto}${motivo.comment ? ` — ${motivo.comment}` : ""}`.slice(0, 250);
}
