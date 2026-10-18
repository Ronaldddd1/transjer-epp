import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db";
import { invoiceAttachments, invoiceEmails, type InvoiceEmail } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { computePayDueDate, invoiceNumber, type PaymentTermKey } from "@/lib/utils";
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
  const termDays = overrides.termDays ?? supplier.defaultTermDays;
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
    grtNumber: parsed.grtNumber,
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
