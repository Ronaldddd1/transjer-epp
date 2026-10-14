import "server-only";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { BusinessError } from "@/lib/action-result";
import type { GraphAttachment, GraphMessage } from "./graph";
import type { ImapConfig } from "./mailbox-config";

/**
 * Lectura del buzón de facturas por IMAP.
 *
 * Es el camino para un correo corriente —el del hosting de la empresa, por ejemplo—, sin
 * registrar aplicaciones ni pedirle permisos a nadie: servidor, usuario y contraseña.
 *
 * Devuelve lo mismo que el lector de Microsoft (GraphMessage, GraphAttachment) para que
 * todo lo que viene después —leer el XML, crear la factura, detectar duplicados, la
 * bandeja de "Por revisar"— no sepa de dónde salió el correo ni tenga que cambiar.
 *
 * La diferencia que sí se nota: IMAP no avisa cuando llega un correo, hay que preguntar.
 * Por eso el buzón se revisa cada pocos minutos desde fuera en vez de esperar un aviso.
 */

/** Hereda de BusinessError para que el mensaje llegue tal cual a la pantalla. */
export class ImapError extends BusinessError {}

/**
 * El identificador de un correo.
 *
 * Se usa el UID del mensaje junto con el UIDVALIDITY de la carpeta: el UID solo es único
 * dentro de la carpeta, y si el servidor la reconstruye los UID se reparten de nuevo. Con
 * el UIDVALIDITY delante, un correo viejo nunca se confunde con uno nuevo que heredó su
 * número, que es lo que haría que una factura se diera por registrada sin estarlo.
 */
export const idDe = (uidValidity: bigint | number, uid: number) => `${uidValidity}-${uid}`;

export const partirId = (id: string) => {
  const [validez, uid] = id.split("-");
  return { validez, uid: Number(uid) };
};

/** Abre la conexión, hace algo y la cierra siempre, incluso si lo de en medio falla. */
async function conectado<T>(config: ImapConfig, trabajo: (cliente: ImapFlow) => Promise<T>): Promise<T> {
  const cliente = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    // La librería escribe cada comando del protocolo por consola; en los registros del
    // servidor eso es ruido, y además la línea de autenticación lleva la contraseña.
    logger: false,
    // Sin esto, un servidor que no responde deja el proceso colgado para siempre.
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });

  try {
    await cliente.connect();
  } catch (error) {
    throw new ImapError(explicar(error, config));
  }

  try {
    return await trabajo(cliente);
  } finally {
    // logout() cierra la sesión con educación; si ya se cayó, no hay nada que cerrar.
    await cliente.logout().catch(() => cliente.close());
  }
}

/** Traduce los fallos típicos a algo que se pueda leer sin saber de IMAP. */
export function explicar(error: unknown, config: ImapConfig): string {
  const mensaje = error instanceof Error ? error.message : String(error);
  const codigo = (error as { code?: string })?.code ?? "";

  if (codigo === "ENOTFOUND") return `No se encontró el servidor ${config.host}. Revisa IMAP_HOST.`;
  if (codigo === "ECONNREFUSED") return `El servidor ${config.host} rechazó la conexión en el puerto ${config.port}. Revisa IMAP_PORT.`;
  if (codigo === "ETIMEDOUT" || /timeout/i.test(mensaje)) {
    return `El servidor ${config.host} no respondió. Puede estar bloqueando conexiones desde fuera de su red.`;
  }
  if (/auth/i.test(mensaje) || /credential/i.test(mensaje) || /login/i.test(mensaje)) {
    return "El servidor rechazó el usuario o la contraseña. Revisa IMAP_USER e IMAP_PASSWORD.";
  }
  if (/certificate/i.test(mensaje)) return `Problema con el certificado de ${config.host}: ${mensaje}`;
  return `No se pudo conectar con ${config.host}: ${mensaje}`;
}

/** Abre la carpeta configurada y avisa claro si no existe. */
async function abrirCarpeta(cliente: ImapFlow, config: ImapConfig) {
  try {
    return await cliente.mailboxOpen(config.folder, { readOnly: true });
  } catch {
    const carpetas = (await cliente.list()).map((c) => c.path).slice(0, 20);
    throw new ImapError(
      `No existe la carpeta "${config.folder}" en el buzón. Las que hay: ${carpetas.join(", ") || "ninguna"}.`,
    );
  }
}

/** Convierte un correo crudo en la forma que espera el resto del sistema. */
export async function comoMensaje(crudo: Buffer, id: string): Promise<{ mensaje: GraphMessage; adjuntos: GraphAttachment[] }> {
  const correo = await simpleParser(crudo);
  const remitente = correo.from?.value?.[0];

  const adjuntos: GraphAttachment[] = (correo.attachments ?? [])
    // Las imágenes incrustadas en la firma del remitente no son adjuntos de verdad y
    // llenarían la factura de logotipos.
    .filter((a) => a.contentDisposition !== "inline")
    .map((a, i) => ({
      id: `${id}-${i}`,
      name: a.filename ?? `adjunto-${i + 1}`,
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? a.content.byteLength,
      data: a.content,
    }));

  return {
    mensaje: {
      id,
      // El Message-ID que puso quien lo envió. Sirve para reconocer el mismo correo
      // aunque cambie de carpeta y le toque otro UID.
      internetMessageId: correo.messageId ?? undefined,
      subject: correo.subject ?? undefined,
      receivedDateTime: (correo.date ?? new Date()).toISOString(),
      hasAttachments: adjuntos.length > 0,
      from: { emailAddress: { name: remitente?.name || undefined, address: remitente?.address || undefined } },
      bodyPreview: (correo.text ?? "").trim().slice(0, 255) || undefined,
    },
    adjuntos,
  };
}

/**
 * Descarga un correo entero una sola vez.
 *
 * El lector pide primero el mensaje y después sus adjuntos, pero por IMAP ambas cosas
 * salen del mismo correo crudo. Bajarlo dos veces sería descargar los PDF por gusto, así
 * que la segunda llamada reusa lo de la primera. Es por mensaje y de corta vida: solo
 * cubre el ida y vuelta de una misma factura.
 */
const cache = new Map<string, { mensaje: GraphMessage; adjuntos: GraphAttachment[] }>();

async function traer(config: ImapConfig, id: string) {
  const guardado = cache.get(id);
  if (guardado) return guardado;

  const leido = await conectado(config, async (cliente) => {
    const carpeta = await abrirCarpeta(cliente, config);
    const { validez, uid } = partirId(id);
    if (String(carpeta.uidValidity) !== validez) {
      throw new ImapError("El buzón se reorganizó y ese correo ya no se puede ubicar por su número. Vuelve a revisar el buzón.");
    }
    const mensaje = await cliente.fetchOne(String(uid), { source: true }, { uid: true });
    if (!mensaje || !mensaje.source) throw new ImapError("Ese correo ya no está en el buzón.");
    return comoMensaje(mensaje.source, id);
  });

  cache.set(id, leido);
  // Se suelta solo: si no, un proceso largo iría acumulando correos con sus adjuntos.
  setTimeout(() => cache.delete(id), 60_000).unref?.();
  return leido;
}

export const imapReader = {
  async getMessage(config: ImapConfig, id: string): Promise<GraphMessage> {
    return (await traer(config, id)).mensaje;
  },

  async getAttachments(config: ImapConfig, id: string): Promise<GraphAttachment[]> {
    return (await traer(config, id)).adjuntos;
  },

  /**
   * Los correos recibidos desde una fecha, del más antiguo al más reciente.
   *
   * Solo devuelve sus identificadores y lo básico; los adjuntos se bajan después y solo
   * de los que haga falta. Así revisar un buzón con cientos de correos no se traduce en
   * descargar cientos de PDF.
   *
   * Se procesan de a pocos porque la revisión corre dentro de una función de Vercel, que
   * tiene un tiempo máximo. Al ir del más antiguo al más reciente y guardar hasta dónde
   * se llegó, un buzón con meses de atraso se vacía solo en revisiones sucesivas en vez
   * de cortarse a la mitad y volver a empezar.
   */
  async listMessagesSince(config: ImapConfig, since: Date, top = 15): Promise<GraphMessage[]> {
    return conectado(config, async (cliente) => {
      const carpeta = await abrirCarpeta(cliente, config);
      const encontrados: GraphMessage[] = [];

      for await (const m of cliente.fetch({ since }, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
        const remitente = m.envelope?.from?.[0];
        encontrados.push({
          id: idDe(carpeta.uidValidity, m.uid),
          internetMessageId: m.envelope?.messageId ?? undefined,
          subject: m.envelope?.subject ?? undefined,
          receivedDateTime: (m.envelope?.date ?? new Date()).toISOString(),
          // Un correo con adjuntos es multipart; uno de solo texto no.
          hasAttachments: (m.bodyStructure?.childNodes?.length ?? 0) > 0,
          from: { emailAddress: { name: remitente?.name || undefined, address: remitente?.address || undefined } },
        });
      }

      encontrados.sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
      // Si hay más de los que caben, se procesan los más antiguos primero: así la
      // siguiente pasada sigue donde quedó esta en vez de dejarlos para siempre.
      return encontrados.slice(0, top);
    });
  },
};

/** Comprueba que el servidor acepte las credenciales y que la carpeta exista. */
export async function testImapConnection(config: ImapConfig): Promise<{ displayName: string; address: string }> {
  return conectado(config, async (cliente) => {
    const carpeta = await abrirCarpeta(cliente, config);
    return {
      displayName: `${config.folder} · ${carpeta.exists} correo(s)`,
      address: config.user,
    };
  });
}
