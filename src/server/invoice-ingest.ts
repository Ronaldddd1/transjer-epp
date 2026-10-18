import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoiceEmails, suppliers } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { CurrentUser } from "@/lib/auth";
import { invoiceNumber } from "@/lib/utils";
import {
  getAttachments, getMessage, listMessagesSince, type GraphAttachment, type GraphMessage,
} from "./graph";
import { imapReader } from "./imap";
import type { MailboxConfig } from "./mailbox-config";
import {
  customerWarning, findDuplicate, parseFirstXml, saveAttachment,
} from "./invoice-service";
import { getSyncState, setSyncState } from "./mailbox-state";

/**
 * Deja listo para decidir lo que llega al buzón.
 *
 * Lo que entra por correo es lo que el proveedor dice que se le debe, que no es lo mismo
 * que lo que la empresa reconoce. Por eso ningún correo crea una factura por su cuenta: si
 * el XML se puede leer, el comprobante queda "Por aprobar" con todos sus datos a la vista
 * y alguien de Finanzas lo acepta —ahí recién se registra la factura— o lo rechaza, y en
 * ese caso el sistema le responde al proveedor.
 *
 * Si el XML no se puede leer (no viene, está dañado), el correo cae en "Por revisar" con
 * sus archivos, para registrarlo a mano. Si el comprobante ya estaba registrado, se
 * descarta solo: eso no hay nada que decidirlo. Nunca se pierde nada.
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
  getMessage: (config, id) => getMessage(comoGraph(config), id),
  getAttachments: (config, id) => getAttachments(comoGraph(config), id),
  listMessagesSince: (config, since) => listMessagesSince(comoGraph(config), since),
};

/** El lector de Microsoft solo sabe trabajar con su propia configuración. */
function comoGraph(config: MailboxConfig) {
  if (config.kind !== "graph") throw new Error("Se esperaba un buzón de Microsoft 365.");
  return config;
}

const imapAdaptador: MailReader = {
  getMessage: (config, id) => imapReader.getMessage(comoImap(config), id),
  getAttachments: (config, id) => imapReader.getAttachments(comoImap(config), id),
  listMessagesSince: (config, since) => imapReader.listMessagesSince(comoImap(config), since),
};

function comoImap(config: MailboxConfig) {
  if (config.kind !== "imap") throw new Error("Se esperaba un buzón IMAP.");
  return config;
}

/**
 * El lector que corresponde al buzón configurado.
 *
 * Es el único punto del sistema que sabe de dónde salen los correos. Todo lo que viene
 * después —leer el XML, crear la factura, apartar lo que no se pudo— es igual venga de
 * Microsoft o de un buzón corriente.
 */
export function readerFor(config: MailboxConfig): MailReader {
  return config.kind === "imap" ? imapAdaptador : graphReader;
}

export type IngestOutcome =
  | { result: "por_aprobar"; emailId: string; label: string; aviso: string | null }
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

export async function ingestMessage(config: MailboxConfig, messageId: string, lector?: MailReader): Promise<IngestOutcome> {
  const reader = lector ?? readerFor(config);
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
        status: "POR_APROBAR",
        attachmentCount: files.length,
        parsed: parsed.parsed,
      }).onConflictDoNothing({ target: invoiceEmails.messageId }).returning();
      if (!email) return { result: "ya_registrado" as const };

      for (const file of files) await saveAttachment(tx, { emailId: email.id, ...file });

      const label = invoiceNumber(parsed.parsed.series, parsed.parsed.number);

      /**
       * El proveedor se busca, pero no se crea todavía.
       *
       * Antes se creaba al leer el correo, y así un comprobante que terminaba rechazado
       * dejaba igual un proveedor nuevo en la lista. Ahora el alta ocurre al aceptar, que
       * es cuando la empresa reconoce de verdad a ese proveedor.
       */
      const [proveedor] = await tx.select().from(suppliers)
        .where(eq(suppliers.ruc, parsed.parsed.supplierRuc)).limit(1);

      if (proveedor) {
        const duplicate = await findDuplicate(tx, {
          supplierId: proveedor.id, docType: parsed.parsed.docType,
          series: parsed.parsed.series, number: parsed.parsed.number,
        });
        if (duplicate) {
          // Un comprobante ya registrado no es algo que haya que decidir: se descarta solo
          // y queda el enlace a la factura que ya existe, por si alguien lo busca.
          const reason = `El comprobante ${label} de ${proveedor.businessName} ya estaba registrado.`;
          await tx.update(invoiceEmails)
            .set({ status: "DESCARTADO", detail: reason, invoiceId: duplicate.id, processedAt: new Date() })
            .where(eq(invoiceEmails.id, email.id));
          return { result: "duplicado" as const, reason };
        }
      }

      const aviso = customerWarning(parsed.parsed);
      if (aviso) {
        await tx.update(invoiceEmails).set({ detail: aviso }).where(eq(invoiceEmails.id, email.id));
      }

      await logAudit({
        user: SYSTEM_USER,
        action: "IMPORTAR",
        module: "CORREO",
        recordId: email.id,
        description: `Llegó el comprobante ${label} de ${parsed.parsed.supplierName} desde ${from.address ?? "un remitente desconocido"}. Queda pendiente de aprobación.${aviso ? ` Aviso: ${aviso}` : ""}`,
        newData: { comprobante: parsed.parsed, correo: { asunto: message.subject, de: from.address } },
      }, tx);

      return { result: "por_aprobar" as const, emailId: email.id, label, aviso };
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

export type SyncSummary = { revisados: number; porAprobar: number; revisar: number; duplicados: number; errores: number };

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

  const summary: SyncSummary = { revisados: 0, porAprobar: 0, revisar: 0, duplicados: 0, errores: 0 };
  let lastMessageAt = state?.lastMessageAt ?? null;

  try {
    const reader = options.reader ?? readerFor(config);
    const messages = await reader.listMessagesSince(config, since);
    for (const message of messages) {
      summary.revisados++;
      const outcome = await ingestMessage(config, message.id, reader);
      if (outcome.result === "por_aprobar") summary.porAprobar++;
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
