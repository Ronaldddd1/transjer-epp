"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invoiceAttachments, invoiceEmails, supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import {
  compararMonto, formatMoney, invoiceNumber, REJECT_REASON_LABEL, type RejectReasonKey,
} from "@/lib/utils";
import {
  approveEmailSchema, invoiceSchema, observeInvoiceSchema, rejectEmailSchema, verifyAmountSchema,
} from "@/lib/validations";
import {
  createSubscription, deleteSubscription, getSubscription, notificationUrl,
  renewSubscription, resetTokenCache, testConnection,
} from "@/server/graph";
import { testImapConnection } from "@/server/imap";
import { readMailboxConfig } from "@/server/mailbox-config";
import { ingestMessage, syncMailbox } from "@/server/invoice-ingest";
import { parsedOf, registerApprovedEmail, registerRejectedEmail } from "@/server/invoice-approval";
import { insertInvoice } from "@/server/invoice-service";
import { sendMail, verifySmtp } from "@/server/mailer";
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
      // Se prueba también el correo de SALIDA, sin mandarle nada a nadie. Leer y enviar
      // son dos conexiones distintas, y la de salida solo se usa al rechazar: sin esto,
      // la primera vez que falla sería en medio de un rechazo.
      const salida = await verifySmtp();
      return {
        ok: true,
        message: `Conexión correcta con el buzón ${info.address} (${info.displayName}).`
          + (salida.ok
            ? " El envío de respuestas al proveedor también funciona."
            : ` Ojo: se puede leer, pero no enviar. ${salida.error}`),
      };
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
      description: `${user.name} revisó el buzón: ${r.revisados} correo(s), ${r.porAprobar} comprobante(s) por aprobar.`,
      newData: r,
    });
    revalidatePath("/", "layout");
    const partes = [
      `${r.revisados} correo(s) revisado(s)`,
      r.porAprobar ? `${r.porAprobar} comprobante(s) por aprobar` : null,
      r.revisar ? `${r.revisar} por revisar` : null,
      r.duplicados ? `${r.duplicados} ya registrada(s)` : null,
      r.errores ? `${r.errores} con error` : null,
    ].filter(Boolean);
    return { ok: true, message: `${partes.join(", ")}.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * El filtro del monto: el paso que va antes de aceptar o rechazar.
 *
 * Quien revisa escribe lo que se pactó por el flete y el sistema lo compara con el total
 * del comprobante. Mientras esto no quede conforme, el comprobante no se puede aceptar.
 *
 * Es la comprobación que en el control en Excel se hacía de memoria, y por eso a veces no
 * se hacía: una factura por un importe distinto al acordado entraba en la cola de pagos
 * como cualquier otra y se descubría al pagarla, cuando ya era tarde para reclamar.
 *
 * Si hay diferencia hay dos salidas, y las dos quedan escritas: dejarlo observado —que lo
 * frena— o aprobar la diferencia explicando por qué. Lo que no se puede es aceptarlo sin
 * que nadie haya mirado el importe.
 */
export async function verifyEmailAmount(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.approve");
    const data = verifyAmountSchema.parse(formToObject(formData));

    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") {
      throw new BusinessError("Este comprobante ya fue aceptado: el filtro del monto va antes.");
    }
    if (email.status === "RECHAZADO") throw new BusinessError("Este comprobante ya fue rechazado.");

    const comprobante = parsedOf(email);
    if (!comprobante) {
      throw new BusinessError("Este correo no trae los datos del comprobante leídos, así que no hay importe que comparar.");
    }

    const { diferencia, coincide, cobraDeMas } = compararMonto(comprobante.total, data.agreedAmount);
    const nota = data.amountNote?.trim() || null;

    // Aprobar una diferencia sin decir por qué deja el mismo agujero que había antes.
    if (!coincide && data.aprobarDiferencia && !nota) {
      throw new BusinessError("Para aprobar la diferencia hay que explicar por qué: escribe el motivo.");
    }

    const conforme = coincide || data.aprobarDiferencia;
    const estado = conforme ? "CONFORME" : "OBSERVADO";
    const plata = (n: number) => formatMoney(Math.abs(n).toFixed(2), comprobante.currency);

    await db.update(invoiceEmails).set({
      agreedAmount: data.agreedAmount,
      amountStatus: estado,
      amountNote: nota,
      amountCheckedBy: user.id,
      amountCheckedAt: new Date(),
    }).where(eq(invoiceEmails.id, id));

    const label = invoiceNumber(comprobante.series, comprobante.number);
    await logAudit({
      user, action: "EDITAR", module: "CORREO", recordId: id,
      description: `${user.name} verificó el monto del comprobante ${label}:`
        + ` facturado ${formatMoney(comprobante.total, comprobante.currency)},`
        + ` pactado ${formatMoney(data.agreedAmount, comprobante.currency)}.`
        + (coincide
          ? " Coincide."
          : ` Diferencia de ${plata(diferencia)} ${cobraDeMas ? "de más" : "de menos"}.`
            + (conforme ? ` Se aprobó: ${nota}` : " Queda observado.")),
      oldData: { monto: email.amountStatus, pactado: email.agreedAmount },
      newData: { monto: estado, pactado: data.agreedAmount, diferencia },
    });

    revalidatePath("/", "layout");
    if (coincide) {
      return {
        ok: true,
        message: `El monto coincide con lo pactado. ${label} ya se puede aceptar o rechazar.`,
      };
    }
    if (conforme) {
      return {
        ok: true,
        message: `Diferencia de ${plata(diferencia)} ${cobraDeMas ? "de más" : "de menos"} aprobada.`
          + ` ${label} ya se puede aceptar o rechazar.`,
      };
    }
    return {
      ok: true,
      message: `${label} queda con el monto observado: el proveedor cobra ${plata(diferencia)}`
        + ` ${cobraDeMas ? "más" : "menos"} de lo pactado. No se puede aceptar hasta resolverlo.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Acepta el comprobante: recién aquí nace la factura por pagar.
 *
 * Hasta este momento el correo era solo lo que mandó el proveedor. Al aceptarlo, la
 * empresa reconoce la deuda, se da de alta al proveedor si no estaba y los archivos del
 * correo pasan a colgar de la factura.
 */
export async function approveEmail(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.approve");
    const data = approveEmailSchema.parse(formToObject(formData));
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") throw new BusinessError("Este comprobante ya fue aceptado.");
    if (email.status !== "POR_APROBAR") {
      throw new BusinessError("Solo se pueden aceptar los comprobantes que están por aprobar.");
    }
    // El filtro del monto va antes. Sin él, aceptar sería reconocer una deuda cuyo importe
    // nadie comparó con lo que se pactó por el flete.
    if (email.amountStatus === "PENDIENTE") {
      throw new BusinessError("Antes de aceptar hay que verificar el monto: compáralo con lo pactado por el flete.");
    }
    if (email.amountStatus === "OBSERVADO") {
      throw new BusinessError(
        `El monto está observado: ${email.amountNote || "no coincide con lo pactado"}.`
        + " Corrígelo o apruébalo con un comentario antes de aceptar el comprobante.",
      );
    }

    const resultado = await db.transaction((tx) => registerApprovedEmail(tx, email, user, {
      serviceType: data.serviceType,
      paymentTerm: data.paymentTerm,
      termDays: data.termDays,
      description: data.description,
      // Solo las facturas de transporte llevan datos de viaje. En un servicio corriente
      // una placa o un cliente serían datos sueltos que después nadie sabría de dónde salieron.
      viaje: data.serviceType === "TRANSPORTE" ? {
        serviceDate: data.serviceDate,
        plate: data.plate,
        clientName: data.clientName,
        originCity: data.originCity,
        destinationCity: data.destinationCity,
        grtNumber: data.grtNumber,
        dispatchNote: data.dispatchNote,
      } : undefined,
    }));

    revalidatePath("/", "layout");
    if (!resultado.ok) return { ok: false, message: resultado.error };
    return {
      ok: true,
      message: `Comprobante aceptado. Quedó registrado como factura ${resultado.label}`
        + `${data.serviceType === "TRANSPORTE" ? " de transporte." : " de servicio."}`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Rechaza el comprobante y le responde al proveedor.
 *
 * El rechazo se guarda aunque el correo no salga: la decisión ya se tomó y no puede
 * depender de que el servidor de correo esté de buenas. Lo que sí se guarda es que el
 * aviso falló, y la pantalla lo muestra, porque un proveedor que no recibió la devolución
 * va a seguir esperando que le paguen.
 */
export async function rejectEmail(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.approve");
    const data = rejectEmailSchema.parse(formToObject(formData));
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") {
      throw new BusinessError("Este comprobante ya fue aceptado. Si hay que darlo de baja, anula la factura.");
    }
    if (email.status === "RECHAZADO") throw new BusinessError("Este comprobante ya fue rechazado.");
    if (email.status === "DESCARTADO") {
      throw new BusinessError("Este correo quedó descartado, no es algo que se le devuelva al proveedor.");
    }

    const destino = (data.replyTo || email.fromAddress || "").trim();
    const parsed = parsedOf(email);
    const label = parsed ? invoiceNumber(parsed.series, parsed.number) : null;
    // Un correo sin XML legible se rechaza igual: el proveedor tiene que enterarse de que
    // lo que mandó no se va a pagar. Lo único que no se puede hacer es registrar la
    // factura anulada, porque no hay datos de comprobante que registrar.
    const registrarPedido = data.registrar && !!parsed;

    let envio: { ok: boolean; error?: string } = { ok: false, error: "No se envió ningún correo al proveedor." };
    if (data.send) {
      if (!destino) {
        throw new BusinessError("No hay a quién responderle: el correo no trae remitente. Escribe una dirección.");
      }
      envio = await sendMail({
        to: destino,
        subject: label
          ? `Comprobante ${label} observado — Transjer Operador Logístico`
          : `Comprobante observado — Transjer Operador Logístico`,
        text: data.body,
        inReplyTo: email.internetMessageId,
      });
    }

    // La factura se registra ANTES de marcar el correo, y en una transacción: si falla el
    // registro, el correo no queda rechazado "a medias" con una factura que no existe.
    let registrada: { label: string } | null = null;
    let avisoRegistro = "";
    if (registrarPedido) {
      const r = await db.transaction((tx) => registerRejectedEmail(tx, email, user, {
        reason: data.reason, comment: data.comment,
      }));
      if (r.ok) registrada = { label: r.label };
      else avisoRegistro = ` No se pudo registrar la factura anulada: ${r.error}`;
    }

    await db.update(invoiceEmails).set({
      status: "RECHAZADO",
      rejectReason: data.reason,
      rejectComment: data.comment,
      detail: `${REJECT_REASON_LABEL[data.reason as RejectReasonKey] ?? data.reason}`
        + (data.comment ? ` — ${data.comment}` : ""),
      replyTo: data.send ? destino : null,
      replyBody: data.send ? data.body : null,
      replySentAt: envio.ok ? new Date() : null,
      replyError: data.send && !envio.ok ? (envio.error ?? "No se pudo enviar el correo.") : null,
      decidedBy: user.id,
      decidedAt: new Date(),
      processedAt: new Date(),
    }).where(eq(invoiceEmails.id, id));

    await logAudit({
      user, action: "EDITAR", module: "CORREO", recordId: id,
      description: `${user.name} rechazó ${label ? `el comprobante ${label}` : `el correo "${email.subject ?? "(sin asunto)"}"`}.`
        + ` Motivo: ${REJECT_REASON_LABEL[data.reason as RejectReasonKey] ?? data.reason}.`
        + (data.send ? (envio.ok ? ` Se le avisó a ${destino}.` : ` No se pudo avisar a ${destino}: ${envio.error}`) : " No se envió aviso al proveedor."),
      oldData: { estado: email.status },
      newData: {
        estado: "RECHAZADO", motivo: data.reason, comentario: data.comment, avisado: envio.ok,
        facturaAnulada: registrada?.label ?? null,
      },
    });

    revalidatePath("/", "layout");
    if (data.send && !envio.ok) {
      return { ok: false, message: `El comprobante quedó rechazado, pero el correo no salió: ${envio.error}` };
    }
    const qué = label ? "Comprobante rechazado" : "Correo rechazado";
    const base = data.send
      ? `${qué}. Se le avisó a ${destino}.`
      : `${qué}, sin avisar al proveedor.`;
    return {
      ok: true,
      message: base
        + (registrada
          ? ` La factura ${registrada.label} quedó anulada, esperando la nota de crédito.`
          : avisoRegistro),
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Aplica a su factura una nota de crédito que llegó por correo.
 *
 * El XML de la nota dice a qué comprobante afecta, así que no hay que emparejarla a mano:
 * se busca esa factura del mismo proveedor y se anula con ella. Es el otro extremo del
 * rechazo: ahí la factura quedó esperando la NC, y aquí llega y se cierra sola.
 */
export async function applyCreditNoteEmail(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.approve");
    const [email] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, id)).limit(1);
    if (!email) throw new BusinessError("El correo no existe.");
    if (email.status === "PROCESADO") throw new BusinessError("Este correo ya se procesó.");

    const nota = parsedOf(email);
    if (!nota) throw new BusinessError("Este correo no tiene los datos del comprobante leídos.");
    if (nota.docType !== "NOTA_CREDITO") {
      throw new BusinessError("Este comprobante no es una nota de crédito.");
    }
    if (!nota.referencedDoc) {
      throw new BusinessError(
        "La nota de crédito no dice a qué factura afecta. Regístrala a mano desde la factura.",
      );
    }

    const etiquetaNota = invoiceNumber(nota.series, nota.number);
    const resultado = await db.transaction(async (tx) => {
      const [proveedor] = await tx.select().from(suppliers)
        .where(eq(suppliers.ruc, nota.supplierRuc)).limit(1);
      if (!proveedor) {
        throw new BusinessError(
          `No hay ninguna factura registrada de ${nota.supplierName}, así que esta nota de crédito no anula nada.`,
        );
      }

      // "F001-123" viene en el XML como un solo texto: se parte para buscar la factura.
      const [serie, numero] = nota.referencedDoc!.split("-");
      if (!serie || !numero) {
        throw new BusinessError(`No se entiende a qué factura afecta la nota (${nota.referencedDoc}).`);
      }

      const [factura] = await tx.select().from(supplierInvoices).where(and(
        eq(supplierInvoices.supplierId, proveedor.id),
        eq(supplierInvoices.series, serie),
        eq(supplierInvoices.number, numero),
      )).limit(1);
      if (!factura) {
        throw new BusinessError(
          `La nota de crédito anula la factura ${nota.referencedDoc}, que no está registrada.`,
        );
      }
      if (factura.creditNoteNumber) {
        throw new BusinessError(
          `La factura ${nota.referencedDoc} ya fue anulada con la nota ${factura.creditNoteNumber}.`,
        );
      }
      if (factura.status === "PAGADA") {
        throw new BusinessError(
          `La factura ${nota.referencedDoc} está pagada: el dinero salió. Reabre el pago antes de anularla.`,
        );
      }

      const totalFactura = Number(factura.total);
      const totalNota = Number(nota.total);
      if (Math.abs(totalNota - totalFactura) > 0.009) {
        throw new BusinessError(
          `La nota de crédito es por ${formatMoney(totalNota, nota.currency)} y la factura `
          + `${nota.referencedDoc} es de ${formatMoney(totalFactura, factura.currency)}. `
          + "Solo se aplica sola cuando anula el importe completo.",
        );
      }

      const [anulada] = await tx.update(supplierInvoices).set({
        status: "ANULADA",
        awaitingCreditNote: false,
        creditNoteNumber: etiquetaNota,
        creditNoteDate: nota.issueDate,
        creditNoteAmount: totalNota.toFixed(2),
        creditNoteRegisteredBy: user.id,
        creditNoteRegisteredAt: new Date(),
        statusReason: `Anulada con la nota de crédito ${etiquetaNota}.`,
        ...(factura.detractionStatus === "PAGADA" ? {} : { detractionStatus: "NO_APLICA" as const }),
      }).where(eq(supplierInvoices.id, factura.id)).returning();

      // El XML y el PDF de la nota pasan a colgar de la factura que anula: es donde se
      // van a buscar cuando alguien pregunte por qué está anulada.
      await tx.update(invoiceAttachments)
        .set({ invoiceId: factura.id })
        .where(and(eq(invoiceAttachments.emailId, email.id), isNull(invoiceAttachments.invoiceId)));

      await tx.update(invoiceEmails).set({
        status: "PROCESADO",
        invoiceId: factura.id,
        detail: `Nota de crédito ${etiquetaNota}: anula la factura ${nota.referencedDoc}.`,
        decidedBy: user.id,
        decidedAt: new Date(),
        processedAt: new Date(),
      }).where(eq(invoiceEmails.id, email.id));

      await logAudit({
        user, action: "ANULAR", module: "CORREO", recordId: factura.id,
        description: `${user.name} aplicó la nota de crédito ${etiquetaNota} de ${proveedor.businessName}`
          + `: la factura ${nota.referencedDoc} queda anulada.`
          + (factura.detractionStatus === "PAGADA" ? " Su detracción ya estaba depositada y se dejó como estaba." : ""),
        oldData: factura, newData: anulada,
      }, tx);

      return { factura: nota.referencedDoc!, detraccionDepositada: factura.detractionStatus === "PAGADA" };
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Factura ${resultado.factura} anulada con la nota de crédito ${etiquetaNota}.`
        + (resultado.detraccionDepositada
          ? " Su detracción ya estaba depositada: revísala con el proveedor."
          : ""),
    };
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
    if (outcome.result === "por_aprobar") return { ok: true, message: `Comprobante ${outcome.label} leído. Queda por aprobar.` };
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
