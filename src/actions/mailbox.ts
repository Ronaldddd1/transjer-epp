"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invoiceAttachments, invoiceEmails } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { invoiceNumber } from "@/lib/utils";
import { invoiceSchema, observeInvoiceSchema } from "@/lib/validations";
import {
  createSubscription, deleteSubscription, getSubscription, notificationUrl,
  renewSubscription, resetTokenCache, testConnection,
} from "@/server/graph";
import { testImapConnection } from "@/server/imap";
import { readMailboxConfig } from "@/server/mailbox-config";
import { ingestMessage, syncMailbox } from "@/server/invoice-ingest";
import { insertInvoice } from "@/server/invoice-service";
import { clearSubscriptionState, getSubscriptionState, setSubscriptionState } from "@/server/mailbox-state";

function requireConfig() {
  const config = readMailboxConfig();
  if (!config) {
    throw new BusinessError("Falta configurar la conexión con el correo. Revisa las variables de entorno en Vercel.");
  }
  return config;
}

/**
 * Las suscripciones de avisos son cosa de Microsoft: es él quien avisa cuando llega un
 * correo. Un buzón IMAP corriente no tiene nada parecido, se revisa cada pocos minutos
 * desde fuera, así que estos botones no le aplican.
 */
function requireGraph() {
  const config = requireConfig();
  if (config.kind !== "graph") {
    throw new BusinessError(
      "Los avisos automáticos son exclusivos de Microsoft 365. Este buzón se lee por IMAP, "
      + "que no avisa: se revisa cada pocos minutos desde el servidor de tareas.",
    );
  }
  return config;
}

export async function testMailbox(): Promise<ActionResult> {
  try {
    await requireActionUser("invoices.mailbox");
    const config = requireConfig();
    if (config.kind === "imap") {
      const info = await testImapConnection(config);
      return { ok: true, message: `Conexión correcta con el buzón ${info.address} (${info.displayName}).` };
    }
    resetTokenCache();
    const info = await testConnection(config);
    return { ok: true, message: `Conexión correcta con el buzón ${info.address} (${info.displayName}).` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Pide a Microsoft que avise cada vez que llegue un correo nuevo. */
export async function activateMailbox(): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.mailbox");
    const config = requireGraph();
    const url = notificationUrl();
    if (!url) throw new BusinessError("Falta la variable APP_URL con la dirección pública del sistema.");

    const existing = await getSubscriptionState();
    if (existing && (await getSubscription(config, existing.id))) {
      throw new BusinessError("Los avisos ya están activos.");
    }

    const created = await createSubscription(config);
    await setSubscriptionState({
      id: created.id,
      expirationDateTime: created.expirationDateTime,
      notificationUrl: created.notificationUrl ?? url,
      createdAt: new Date().toISOString(),
    });
    await logAudit({
      user, action: "ACTIVAR", module: "CORREO", recordId: created.id,
      description: `${user.name} activó la lectura automática del buzón ${config.mailbox}.`,
      newData: { expira: created.expirationDateTime, aviso: created.notificationUrl },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Lectura automática activada. Las facturas que lleguen se registrarán solas." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deactivateMailbox(): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.mailbox");
    const config = requireGraph();
    const state = await getSubscriptionState();
    if (!state) throw new BusinessError("Los avisos no están activos.");
    try {
      await deleteSubscription(config, state.id);
    } catch {
      // Si Microsoft ya la había caducado, basta con olvidarla de nuestro lado.
    }
    await clearSubscriptionState();
    await logAudit({
      user, action: "DESACTIVAR", module: "CORREO", recordId: state.id,
      description: `${user.name} desactivó la lectura automática del buzón ${config.mailbox}.`,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Lectura automática desactivada. Las facturas deberán registrarse a mano." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function renewMailbox(): Promise<ActionResult> {
  try {
    await requireActionUser("invoices.mailbox");
    const config = requireGraph();
    const state = await getSubscriptionState();
    if (!state) throw new BusinessError("Los avisos no están activos: actívalos primero.");
    const live = await getSubscription(config, state.id);
    const renewed = live ? await renewSubscription(config, state.id) : await createSubscription(config);
    await setSubscriptionState({
      id: renewed.id,
      expirationDateTime: renewed.expirationDateTime,
      notificationUrl: renewed.notificationUrl ?? state.notificationUrl,
      createdAt: live ? state.createdAt : new Date().toISOString(),
    });
    revalidatePath("/", "layout");
    return { ok: true, message: live ? "Avisos renovados." : "La suscripción había caducado y se volvió a crear." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Repasa el buzón ahora mismo, sin esperar a la revisión diaria. */
export async function syncMailboxNow(): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const config = requireConfig();
    const r = await syncMailbox(config);
    await logAudit({
      user, action: "IMPORTAR", module: "CORREO",
      description: `${user.name} revisó el buzón: ${r.revisados} correo(s), ${r.creadas} factura(s) registrada(s).`,
      newData: r,
    });
    revalidatePath("/", "layout");
    const partes = [
      `${r.revisados} correo(s) revisado(s)`,
      r.creadas ? `${r.creadas} factura(s) registrada(s)` : null,
      r.revisar ? `${r.revisar} por revisar` : null,
      r.duplicados ? `${r.duplicados} ya registrada(s)` : null,
      r.errores ? `${r.errores} con error` : null,
    ].filter(Boolean);
    return { ok: true, message: `${partes.join(", ")}.` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Vuelve a intentar un correo que quedó por revisar o con error. */
export async function retryEmail(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const config = requireConfig();
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") throw new BusinessError("Este correo ya generó una factura.");

    // Se borra el registro anterior (y sus adjuntos) para leerlo otra vez desde el buzón.
    await db.delete(invoiceEmails).where(eq(invoiceEmails.id, id));
    const outcome = await ingestMessage(config, email.messageId);
    await logAudit({
      user, action: "IMPORTAR", module: "CORREO", recordId: id,
      description: `${user.name} reintentó el correo "${email.subject ?? "(sin asunto)"}": ${outcome.result}.`,
      newData: outcome,
    });
    revalidatePath("/", "layout");
    if (outcome.result === "creada") return { ok: true, message: `Factura ${outcome.label} registrada.` };
    if (outcome.result === "duplicado") return { ok: true, message: outcome.reason };
    if (outcome.result === "revisar") return { ok: false, message: `Sigue sin poder registrarse: ${outcome.reason}` };
    if (outcome.result === "error") return { ok: false, message: outcome.reason };
    return { ok: true, message: "El correo ya estaba registrado." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function discardEmail(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { statusReason } = observeInvoiceSchema.parse(formToObject(formData));
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") throw new BusinessError("Este correo ya generó una factura.");

    await db.update(invoiceEmails).set({ status: "DESCARTADO", detail: statusReason, processedAt: new Date() })
      .where(eq(invoiceEmails.id, id));
    await logAudit({
      user, action: "ELIMINAR", module: "CORREO", recordId: id,
      description: `${user.name} descartó el correo "${email.subject ?? "(sin asunto)"}". Motivo: ${statusReason}`,
      oldData: { estado: email.status }, newData: { estado: "DESCARTADO", motivo: statusReason },
    });
    revalidatePath("/", "layout");
    return { ok: true, message: "Correo descartado." };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Crea la factura a mano a partir de un correo que no traía XML legible, y le pasa
 * los archivos que llegaron adjuntos para no perder el respaldo.
 */
export async function createInvoiceFromEmail(emailId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const { receivedDate: _ignorado, ...data } = invoiceSchema.parse(formToObject(formData));
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, emailId)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") throw new BusinessError("Este correo ya generó una factura.");

    const invoice = await db.transaction(async (tx) => {
      const row = await insertInvoice(tx, { ...data, source: "CORREO", receivedAt: email.receivedAt }, user);
      // Los archivos del correo pasan a pertenecer a la factura.
      await tx.update(invoiceAttachments).set({ emailId: null, invoiceId: row.id })
        .where(eq(invoiceAttachments.emailId, emailId));
      await tx.update(invoiceEmails).set({ status: "PROCESADO", invoiceId: row.id, processedAt: new Date() })
        .where(eq(invoiceEmails.id, emailId));
      await logAudit({
        user, action: "CREAR", module: "FACTURAS", recordId: row.id,
        description: `${user.name} registró la factura ${invoiceNumber(row.series, row.number)} a partir del correo "${email.subject ?? "(sin asunto)"}".`,
        newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Factura ${invoiceNumber(invoice.series, invoice.number)} registrada desde el correo.` };
  } catch (e) {
    return toActionError(e);
  }
}
