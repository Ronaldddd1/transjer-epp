import "server-only";
import { BusinessError } from "@/lib/action-result";
import { publicBaseUrl, type GraphConfig } from "./mailbox-config";

/**
 * Conexión con el buzón de facturas en Microsoft 365, mediante Microsoft Graph.
 *
 * Las credenciales viven en variables de entorno (nunca en la base de datos ni en el código):
 *   GRAPH_TENANT_ID        Identificador de la organización en Microsoft Entra ID
 *   GRAPH_CLIENT_ID        Identificador de la aplicación registrada
 *   GRAPH_CLIENT_SECRET    Secreto de esa aplicación
 *   INVOICE_MAILBOX        Buzón que se lee, p. ej. facturas@transjer.com
 *   GRAPH_WEBHOOK_SECRET   Palabra secreta que Microsoft devuelve en cada aviso
 *
 * La aplicación usa permiso de solo lectura (Mail.Read) y debe estar limitada a ese único
 * buzón desde Exchange Online (RBAC for Applications). Ver el README.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Traduce un fallo de red en un mensaje que se entienda en pantalla. */
async function safeFetch(url: string, init: RequestInit, contexto: string): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new GraphError(`No se pudo contactar con Microsoft al ${contexto}. Revisa la conexión a internet del servidor. (${detalle})`);
  }
}

/** Hereda de BusinessError para que su mensaje llegue tal cual a la pantalla. */
export class GraphError extends BusinessError {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}


export function notificationUrl(): string | null {
  const base = publicBaseUrl();
  return base ? `${base}/api/correo/graph` : null;
}

// --- Token de acceso (se reutiliza mientras siga vigente) ---
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(config: GraphConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await safeFetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  }, "pedir el permiso de acceso");

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new GraphError(`Microsoft rechazó las credenciales: ${String(detail).split("\n")[0]}`, res.status);
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.value;
}

/** Olvida el token guardado (tras un cambio de credenciales). */
export function resetTokenCache() {
  cachedToken = null;
}

async function graphFetch(config: GraphConfig, path: string, init: RequestInit = {}) {
  const token = await getAccessToken(config);
  const res = await safeFetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  }, "leer el buzón");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = `Microsoft respondió con error ${res.status}.`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error?.message) message = parsed.error.message;
    } catch { /* la respuesta no era JSON */ }
    if (res.status === 403) {
      message = `Sin permiso para leer el buzón ${config.mailbox}. Revisa que la aplicación tenga Mail.Read y esté autorizada sobre ese buzón. (${message})`;
    }
    throw new GraphError(message, res.status);
  }
  return res.status === 204 ? null : res.json();
}

export type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  receivedDateTime: string;
  hasAttachments?: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
  bodyPreview?: string;
};

const MESSAGE_FIELDS = "id,internetMessageId,subject,receivedDateTime,hasAttachments,from,bodyPreview";

export async function getMessage(config: GraphConfig, messageId: string): Promise<GraphMessage> {
  return graphFetch(config, `/users/${encodeURIComponent(config.mailbox)}/messages/${messageId}?$select=${MESSAGE_FIELDS}`);
}

/** Mensajes recibidos desde una fecha, del más antiguo al más reciente. */
export async function listMessagesSince(config: GraphConfig, since: Date, top = 25): Promise<GraphMessage[]> {
  const folder = process.env.INVOICE_MAIL_FOLDER?.trim() || "Inbox";
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  const data = await graphFetch(
    config,
    `/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(folder)}/messages` +
      `?$select=${MESSAGE_FIELDS}&$filter=${filter}&$orderby=receivedDateTime asc&$top=${top}`,
  );
  return data?.value ?? [];
}

export type GraphAttachment = { id: string; name: string; contentType: string; size: number; data: Buffer };

/** Descarga los archivos adjuntos de un mensaje (solo archivos, no mensajes incrustados). */
export async function getAttachments(config: GraphConfig, messageId: string): Promise<GraphAttachment[]> {
  const data = await graphFetch(config, `/users/${encodeURIComponent(config.mailbox)}/messages/${messageId}/attachments`);
  const out: GraphAttachment[] = [];
  for (const att of data?.value ?? []) {
    if (att["@odata.type"] !== "#microsoft.graph.fileAttachment") continue;
    if (att.isInline) continue;
    let content: Buffer;
    if (att.contentBytes) {
      content = Buffer.from(att.contentBytes, "base64");
    } else {
      // Adjuntos grandes: se piden por separado.
      const token = await getAccessToken(config);
      const res = await fetch(
        `${GRAPH}/users/${encodeURIComponent(config.mailbox)}/messages/${messageId}/attachments/${att.id}/$value`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!res.ok) continue;
      content = Buffer.from(await res.arrayBuffer());
    }
    out.push({
      id: att.id,
      name: att.name ?? "adjunto",
      contentType: att.contentType || "application/octet-stream",
      size: content.byteLength,
      data: content,
    });
  }
  return out;
}

// --- Suscripción de avisos ---

export type GraphSubscription = { id: string; expirationDateTime: string; notificationUrl: string; resource: string };

/** Microsoft permite hasta casi 7 días; se pide algo menos para tener margen. */
export function subscriptionExpiry(): string {
  return new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString();
}

export async function createSubscription(config: GraphConfig): Promise<GraphSubscription> {
  const url = notificationUrl();
  if (!url) throw new GraphError("Falta APP_URL: Microsoft necesita una dirección pública para enviar los avisos.");
  if (!url.startsWith("https://")) throw new GraphError("La dirección de avisos debe empezar con https://.");

  const folder = process.env.INVOICE_MAIL_FOLDER?.trim() || "Inbox";
  return graphFetch(config, "/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: url,
      resource: `/users/${config.mailbox}/mailFolders('${folder}')/messages`,
      expirationDateTime: subscriptionExpiry(),
      clientState: config.webhookSecret,
    }),
  });
}

export async function renewSubscription(config: GraphConfig, id: string): Promise<GraphSubscription> {
  return graphFetch(config, `/subscriptions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ expirationDateTime: subscriptionExpiry() }),
  });
}

export async function deleteSubscription(config: GraphConfig, id: string): Promise<void> {
  await graphFetch(config, `/subscriptions/${id}`, { method: "DELETE" });
}

export async function getSubscription(config: GraphConfig, id: string): Promise<GraphSubscription | null> {
  try {
    return await graphFetch(config, `/subscriptions/${id}`);
  } catch (error) {
    if (error instanceof GraphError && (error.status === 404 || error.status === 400)) return null;
    throw error;
  }
}

/** Comprueba que las credenciales y el permiso sobre el buzón funcionan. */
export async function testConnection(config: GraphConfig): Promise<{ displayName: string; address: string }> {
  const data = await graphFetch(config, `/users/${encodeURIComponent(config.mailbox)}?$select=displayName,mail,userPrincipalName`);
  return { displayName: data?.displayName ?? config.mailbox, address: data?.mail ?? data?.userPrincipalName ?? config.mailbox };
}
