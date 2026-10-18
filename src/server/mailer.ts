import "server-only";
import nodemailer from "nodemailer";
import { readMailboxConfig } from "./mailbox-config";

/**
 * El envío de correos del sistema.
 *
 * Hoy solo se usa para una cosa: devolverle al proveedor el comprobante que no se aceptó.
 * Sale del mismo buzón que recibe las facturas, así que la respuesta le llega al proveedor
 * en el mismo hilo donde él escribió y nadie tiene que abrir Outlook para contestar.
 *
 * Por defecto toma el servidor y las credenciales del buzón IMAP ya configurado: en un
 * correo corriente, el servidor de salida es el mismo que el de entrada y la contraseña
 * también. Se pueden separar con SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASSWORD si algún
 * día el correo de salida fuera otro.
 */

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

const texto = (v: string | undefined) => v?.trim() || "";

export function readSmtpConfig(): SmtpConfig | null {
  const buzon = readMailboxConfig();
  const imap = buzon?.kind === "imap" ? buzon : null;

  const host = texto(process.env.SMTP_HOST) || imap?.host || "";
  const user = texto(process.env.SMTP_USER) || imap?.user || "";
  const pass = process.env.SMTP_PASSWORD || imap?.pass || "";
  if (!host || !user || !pass) return null;

  // 465 es SMTP cifrado de entrada; 587 arranca sin cifrar y asciende a TLS. Si no se
  // dice nada se usa 465, que es lo que sirve casi cualquier hosting.
  const puerto = Number(texto(process.env.SMTP_PORT));
  const port = Number.isFinite(puerto) && puerto > 0 ? puerto : 465;

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from: texto(process.env.MAIL_FROM) || user,
    fromName: texto(process.env.MAIL_FROM_NAME) || "Transjer Operador Logístico",
  };
}

export type SendResult = { ok: true } | { ok: false; error: string };

export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
  /** Para que la respuesta caiga en el mismo hilo del proveedor. */
  inReplyTo?: string | null;
  cc?: string | null;
};

/**
 * Manda un correo. Nunca lanza: quien lo llama necesita seguir adelante igual.
 *
 * Un rechazo se registra aunque el correo no salga —la decisión ya se tomó— pero el
 * motivo del fallo se devuelve para dejarlo guardado y que se vea en pantalla. Lo peor
 * que podría pasar aquí es que el sistema diga "rechazado y avisado" cuando el proveedor
 * no recibió nada.
 */
export async function sendMail(mail: OutgoingMail): Promise<SendResult> {
  const config = readSmtpConfig();
  if (!config) {
    return { ok: false, error: "El correo de salida no está configurado (faltan los datos del buzón)." };
  }

  try {
    const transporte = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    });

    await transporte.sendMail({
      from: { name: config.fromName, address: config.from },
      to: mail.to,
      cc: mail.cc || undefined,
      subject: mail.subject,
      text: mail.text,
      inReplyTo: mail.inReplyTo || undefined,
      references: mail.inReplyTo || undefined,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explicar(error) };
  }
}

/** Prueba que el correo de salida funcione, sin mandarle nada a nadie. */
export async function verifySmtp(): Promise<SendResult> {
  const config = readSmtpConfig();
  if (!config) return { ok: false, error: "El correo de salida no está configurado." };
  try {
    const transporte = nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 15_000, greetingTimeout: 15_000,
    });
    await transporte.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explicar(error) };
  }
}

/**
 * Traduce el error del servidor de correo a algo accionable.
 *
 * Los mensajes que devuelve nodemailer son códigos y jerga de SMTP. Quien ve esto en
 * pantalla necesita saber qué hacer, no qué pasó por dentro.
 */
function explicar(error: unknown): string {
  const e = error as { code?: string; responseCode?: number; message?: string };
  const codigo = e?.code ?? "";
  const mensaje = e?.message ?? String(error);

  if (codigo === "EAUTH" || e?.responseCode === 535) {
    return "El servidor de correo rechazó el usuario o la contraseña. Revisa IMAP_USER e IMAP_PASSWORD en Vercel.";
  }
  if (codigo === "ENOTFOUND" || codigo === "EDNS") {
    return "No se encontró el servidor de correo de salida. Revisa el nombre del servidor.";
  }
  if (codigo === "ECONNREFUSED") {
    return "El servidor de correo rechazó la conexión. Puede ser el puerto: prueba 465 o 587 en SMTP_PORT.";
  }
  if (codigo === "ETIMEDOUT" || codigo === "ESOCKET") {
    return "El servidor de correo no respondió a tiempo. Vuelve a intentarlo en un momento.";
  }
  if (e?.responseCode === 550 || e?.responseCode === 553) {
    return "El servidor no aceptó el destinatario. Revisa la dirección a la que se está respondiendo.";
  }
  return mensaje.slice(0, 300);
}
