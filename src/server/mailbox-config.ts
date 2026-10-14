import "server-only";

/**
 * De dónde se leen las facturas que llegan por correo.
 *
 * Hay dos formas, y el sistema soporta las dos porque dependen de qué correo tenga la
 * empresa:
 *
 *   IMAP   — un buzón corriente, el de toda la vida. Sirve con cualquier proveedor:
 *            el hosting de la propia web, Gmail, el que sea. Solo pide servidor,
 *            usuario y contraseña. Es lo que usa Transjer.
 *
 *   GRAPH  — Microsoft 365. Pide registrar una aplicación en Entra ID y que un
 *            administrador dé su consentimiento, pero a cambio Microsoft avisa en
 *            cuanto llega un correo, sin tener que preguntar cada rato.
 *
 * Se elige sola según qué variables de entorno estén cargadas. Si están las dos, manda
 * IMAP: es la que se configura a propósito, mientras que las de Graph suelen quedar de
 * un intento anterior.
 */

export type ImapConfig = {
  kind: "imap";
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  /** La dirección del buzón, para los avisos de "esta factura no es nuestra". */
  mailbox: string;
  /** Carpeta que se revisa. Casi siempre la bandeja de entrada. */
  folder: string;
};

export type GraphConfig = {
  kind: "graph";
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
  webhookSecret: string;
};

export type MailboxConfig = ImapConfig | GraphConfig;

const texto = (v: string | undefined) => v?.trim() || "";

function readImapConfig(): ImapConfig | null {
  const host = texto(process.env.IMAP_HOST);
  const user = texto(process.env.IMAP_USER);
  const pass = process.env.IMAP_PASSWORD ?? "";
  if (!host || !user || !pass) return null;

  const puerto = Number(texto(process.env.IMAP_PORT));
  // El 993 es IMAP sobre SSL, que es como lo sirve casi todo el mundo. El 143 es sin
  // cifrar de entrada y se asciende a TLS después, así que ahí `secure` va en false.
  const port = Number.isFinite(puerto) && puerto > 0 ? puerto : 993;

  return {
    kind: "imap",
    host,
    port,
    secure: port !== 143,
    user,
    pass,
    mailbox: texto(process.env.INVOICE_MAILBOX).toLowerCase() || user.toLowerCase(),
    folder: texto(process.env.IMAP_FOLDER) || "INBOX",
  };
}

function readGraphConfig(): GraphConfig | null {
  const tenantId = texto(process.env.GRAPH_TENANT_ID);
  const clientId = texto(process.env.GRAPH_CLIENT_ID);
  const clientSecret = texto(process.env.GRAPH_CLIENT_SECRET);
  const mailbox = texto(process.env.INVOICE_MAILBOX).toLowerCase();
  const webhookSecret = texto(process.env.GRAPH_WEBHOOK_SECRET);
  if (!tenantId || !clientId || !clientSecret || !mailbox || !webhookSecret) return null;
  return { kind: "graph", tenantId, clientId, clientSecret, mailbox, webhookSecret };
}

export function readMailboxConfig(): MailboxConfig | null {
  return readImapConfig() ?? readGraphConfig();
}

/**
 * Qué falta por configurar, para decirlo en pantalla.
 *
 * Se mira lo que ya empezó a configurarse: si hay algo de IMAP a medias se reclama lo de
 * IMAP, y lo mismo con Graph. Sin nada cargado se proponen las de IMAP, que es el camino
 * corto y el que sirve con cualquier correo.
 */
export function missingMailboxSettings(): string[] {
  const imap = { IMAP_HOST: process.env.IMAP_HOST, IMAP_USER: process.env.IMAP_USER, IMAP_PASSWORD: process.env.IMAP_PASSWORD };
  const graph = {
    GRAPH_TENANT_ID: process.env.GRAPH_TENANT_ID,
    GRAPH_CLIENT_ID: process.env.GRAPH_CLIENT_ID,
    GRAPH_CLIENT_SECRET: process.env.GRAPH_CLIENT_SECRET,
    INVOICE_MAILBOX: process.env.INVOICE_MAILBOX,
    GRAPH_WEBHOOK_SECRET: process.env.GRAPH_WEBHOOK_SECRET,
  };
  const faltan = (campos: Record<string, string | undefined>) =>
    Object.entries(campos).filter(([, v]) => !v?.trim()).map(([k]) => k);

  const empezoGraph = Object.values(graph).some((v) => v?.trim());
  const empezoImap = Object.values(imap).some((v) => v?.trim());
  if (empezoGraph && !empezoImap) return faltan(graph);
  return faltan(imap);
}

/** Dirección pública de la aplicación, necesaria para que Microsoft pueda avisar. */
export function publicBaseUrl(): string | null {
  const explicit = texto(process.env.APP_URL);
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = texto(process.env.VERCEL_PROJECT_PRODUCTION_URL) || texto(process.env.VERCEL_URL);
  return vercel ? `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : null;
}
