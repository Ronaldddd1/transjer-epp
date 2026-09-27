import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceEmails } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { invoiceNumber } from "@/lib/utils";
import {
  getAttachments, getMessage, listMessagesSince, type GraphAttachment, type GraphMessage, type MailboxConfig,
} from "./graph";
import {
  customerWarning, findDuplicate, findOrCreateSupplier, insertInvoice, parseFirstXml, saveAttachment,
} from "./invoice-service";
import { getSyncState, setSyncState } from "./mailbox-state";

/**
 * Convierte un correo recibido en una factura registrada.
 *
 * Si el correo trae el XML del comprobante, la factura se crea sola y queda pendiente de pago.
 * Si no se puede leer (falta el XML, viene dañado o ya estaba registrado), el correo queda en la
 * bandeja "Por revisar" con sus archivos, para que la encargada decida. Nunca se pierde nada.
 */

/**
 * Acceso al buzón. En producción son las llamadas reales a Microsoft Graph; en las pruebas
 * se sustituye por correos de ejemplo, así se verifica todo el flujo sin depender del correo.
 */
export type MailReader = {
  getMessage(config: MailboxConfig, id: string): Promise<GraphMessage>;
  getAttachments(config: MailboxConfig, id: string): Promise<GraphAttachment[]>;
  listMessagesSince(config: MailboxConfig, since: Date): Promise<GraphMessage[]>;
};

const graphReader: MailReader = {
  getMessage,
  getAttachments,
  listMessagesSince: (config, since) => listMessagesSince(config, since),
};

export type IngestOutcome =
  | { result: "creada"; invoiceId: string; label: string }
  | { result: "revisar"; reason: string }
  | { result: "duplicado"; reason: string }
  | { result: "ya_registrado" }
  | { result: "error"; reason: string };

const MAX_ATTACHMENT_TOTAL = 40 * 1024 * 1024;

function sender(message: GraphMessage) {
  return {
    address: message.from?.emailAddress?.address?.slice(0, 250) ?? null,
    name: message.from?.emailAddress?.name?.slice(0, 250) ?? null,
  };
}

/** El usuario del sistema con el que se firman las acciones automáticas. */
const SYSTEM_USER: Pick<CurrentUser, "id" | "name"> | null = null;

export async function ingestMessage(config: MailboxConfig, messageId: string, reader: MailReader = graphReader): Promise<IngestOutcome> {
  const [already] = await db.select({ id: invoiceEmails.id }).from(invoiceEmails)
    .where(eq(invoiceEmails.messageId, messageId)).limit(1);
  if (already) return { result: "ya_registrado" };

  let message: GraphMessage;
  let attachments: GraphAttachment[] = [];
  try {
    message = await reader.getMessage(config, messageId);
    if (message.hasAttachments) attachments = await reader.getAttachments(config, messageId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "No se pudo leer el correo.";
    await recordEmail(messageId, null, "ERROR", reason, []);
    return { result: "error", reason };
  }

  const total = attachments.reduce((s, a) => s + a.size, 0);
  if (total > MAX_ATTACHMENT_TOTAL) {
    const reason = "El correo trae demasiados archivos adjuntos para procesarlo automáticamente.";
    await recordEmail(messageId, message, "REVISAR", reason, []);
    return { result: "revisar", reason };
  }

  const files = attachments.map((a) => ({ filename: a.name, contentType: a.contentType, data: a.data }));

  if (files.length === 0) {
    const reason = "El correo no trae archivos adjuntos.";
    await recordEmail(messageId, message, "REVISAR", reason, []);
    return { result: "revisar", reason };
  }

  const parsed = parseFirstXml(files);
  if ("error" in parsed) {
    await recordEmail(messageId, message, "REVISAR", parsed.error, files);
    return { result: "revisar", reason: parsed.error };
  }

  try {
    return await db.transaction(async (tx) => {
      const from = sender(message);
      // Reservar el correo: si llega dos veces el mismo aviso, solo una inserción gana.
      const [email] = await tx.insert(invoiceEmails).values({
        messageId,
        internetMessageId: message.internetMessageId?.slice(0, 400) ?? null,
        subject: message.subject?.slice(0, 400) ?? null,
        fromAddress: from.address,
        fromName: from.name,
        receivedAt: new Date(message.receivedDateTime),
        status: "REVISAR",
        attachmentCount: files.length,
        parsed: parsed.parsed,
      }).onConflictDoNothing({ target: invoiceEmails.messageId }).returning();
      if (!email) return { result: "ya_registrado" as const };

      const { supplier } = await findOrCreateSupplier(
        tx, { ruc: parsed.parsed.supplierRuc, businessName: parsed.parsed.supplierName }, SYSTEM_USER,
      );

      const docRef = {
        supplierId: supplier.id, docType: parsed.parsed.docType,
        series: parsed.parsed.series, number: parsed.parsed.number,
      };
      const duplicate = await findDuplicate(tx, docRef);
      if (duplicate) {
        const reason = `El comprobante ${invoiceNumber(docRef.series, docRef.number)} de ${supplier.businessName} ya estaba registrado.`;
        for (const file of files) await saveAttachment(tx, { emailId: email.id, ...file });
        await tx.update(invoiceEmails)
          .set({ status: "DESCARTADO", detail: reason, invoiceId: duplicate.id, processedAt: new Date() })
          .where(eq(invoiceEmails.id, email.id));
        return { result: "duplicado" as const, reason };
      }

      const invoice = await insertInvoice(tx, {
        ...docRef,
        issueDate: parsed.parsed.issueDate,
        dueDate: parsed.parsed.dueDate,
        currency: parsed.parsed.currency,
        subtotal: parsed.parsed.subtotal,
        igv: parsed.parsed.igv,
        total: parsed.parsed.total,
        description: parsed.parsed.description,
        grtNumber: parsed.parsed.grtNumber,
        source: "CORREO",
        receivedAt: new Date(message.receivedDateTime),
      }, SYSTEM_USER);

      for (const file of files) {
        await saveAttachment(tx, { invoiceId: invoice.id, ...file });
      }

      const aviso = customerWarning(parsed.parsed);
      await tx.update(invoiceEmails).set({
        status: "PROCESADO",
        invoiceId: invoice.id,
        detail: aviso,
        processedAt: new Date(),
      }).where(eq(invoiceEmails.id, email.id));

      const label = invoiceNumber(invoice.series, invoice.number);
      await logAudit({
        user: SYSTEM_USER,
        action: "IMPORTAR",
        module: "CORREO",
        recordId: invoice.id,
        description: `Se registró automáticamente la factura ${label} de ${supplier.businessName} recibida de ${from.address ?? "un remitente desconocido"}.${aviso ? ` Aviso: ${aviso}` : ""}`,
        newData: { factura: invoice, correo: { asunto: message.subject, de: from.address } },
      }, tx);

      return { result: "creada" as const, invoiceId: invoice.id, label };
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "No se pudo registrar la factura.";
    await recordEmail(messageId, message, "ERROR", reason, files);
    return { result: "error", reason };
  }
}

/** Deja constancia del correo cuando no se pudo crear la factura. */
async function recordEmail(
  messageId: string,
  message: GraphMessage | null,
  status: "REVISAR" | "ERROR",
  detail: string,
  files: { filename: string; contentType: string; data: Buffer }[],
) {
  try {
    await db.transaction(async (tx) => {
      const from = message ? sender(message) : { address: null, name: null };
      const [email] = await tx.insert(invoiceEmails).values({
        messageId,
        internetMessageId: message?.internetMessageId?.slice(0, 400) ?? null,
        subject: message?.subject?.slice(0, 400) ?? null,
        fromAddress: from.address,
        fromName: from.name,
        receivedAt: message ? new Date(message.receivedDateTime) : new Date(),
        status,
        attachmentCount: files.length,
        detail: detail.slice(0, 2000),
      }).onConflictDoNothing({ target: invoiceEmails.messageId }).returning();
      if (!email) return;
      for (const file of files) {
        await saveAttachment(tx, { emailId: email.id, ...file });
      }
    });
  } catch (error) {
    console.error("No se pudo registrar el correo en la bandeja:", error);
  }
}

export type SyncSummary = { revisados: number; creadas: number; revisar: number; duplicados: number; errores: number };

/**
 * Repasa el buzón desde la última revisión. Sirve como respaldo del aviso instantáneo:
 * si un aviso se perdió, aquí se recupera el correo.
 */
export async function syncMailbox(config: MailboxConfig, options: { sinceDays?: number; reader?: MailReader } = {}): Promise<SyncSummary> {
  const state = await getSyncState();
  const fallbackDays = options.sinceDays ?? 3;
  const since = state?.lastMessageAt
    ? new Date(Date.parse(state.lastMessageAt) - 5 * 60_000) // 5 minutos de margen
    : new Date(Date.now() - fallbackDays * 24 * 60 * 60 * 1000);

  const summary: SyncSummary = { revisados: 0, creadas: 0, revisar: 0, duplicados: 0, errores: 0 };
  let lastMessageAt = state?.lastMessageAt ?? null;

  try {
    const reader = options.reader ?? graphReader;
    const messages = await reader.listMessagesSince(config, since);
    for (const message of messages) {
      summary.revisados++;
      const outcome = await ingestMessage(config, message.id, reader);
      if (outcome.result === "creada") summary.creadas++;
      else if (outcome.result === "revisar") summary.revisar++;
      else if (outcome.result === "duplicado") summary.duplicados++;
      else if (outcome.result === "error") summary.errores++;
      if (!lastMessageAt || message.receivedDateTime > lastMessageAt) lastMessageAt = message.receivedDateTime;
    }
    await setSyncState({ at: new Date().toISOString(), lastMessageAt, lastError: null });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    await setSyncState({ at: new Date().toISOString(), lastMessageAt, lastError: reason });
    throw error;
  }
  return summary;
}
