/**
 * Lectura del buzón de facturas por IMAP.
 *
 * Lo que se prueba acá es la parte propia: convertir un correo crudo en lo que el resto
 * del sistema espera, reconocer sus adjuntos, identificar cada correo sin confundirlo con
 * otro, y traducir los fallos de conexión a algo que se entienda sin saber de IMAP.
 *
 * La conexión en sí no se prueba acá: eso depende del servidor de correo de la empresa y
 * se comprueba contra él de verdad, no contra una imitación.
 *
 *   npx tsx --conditions=react-server tests/imap.test.ts
 */
import "dotenv/config";
import { comoMensaje, explicar, idDe, partirId } from "../src/server/imap";
import type { ImapConfig } from "../src/server/mailbox-config";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const CONFIG: ImapConfig = {
  kind: "imap", host: "mail.ejemplo.com", port: 993, secure: true,
  user: "facturas@ejemplo.com", pass: "x", mailbox: "facturas@ejemplo.com", folder: "INBOX",
};

/** Un correo crudo, tal como viaja por el protocolo: cabeceras, cuerpo y adjuntos. */
function correoCrudo({ partes = [] as { nombre: string; tipo: string; contenido: string; inline?: boolean }[] } = {}) {
  const limite = "LIMITE123";
  const cabeceras = [
    "From: Facturacion SAC <facturacion@proveedor.com>",
    "To: facturas@ejemplo.com",
    "Subject: Factura F001-1234",
    "Date: Mon, 13 Oct 2026 09:30:00 -0500",
    "Message-ID: <abc123@proveedor.com>",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    // Dos saltos: la línea en blanco es lo que separa las cabeceras del cuerpo. Sin ella
    // el correo está mal formado y el cuerpo no se lee.
    "",
    "",
  ].join("\r\n");

  const cuerpo = [
    `--${limite}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Estimados, adjunto la factura del servicio de transporte.",
    "",
    ...partes.flatMap((p) => [
      `--${limite}`,
      `Content-Type: ${p.tipo}; name="${p.nombre}"`,
      `Content-Disposition: ${p.inline ? "inline" : "attachment"}; filename="${p.nombre}"`,
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(p.contenido).toString("base64"),
      "",
    ]),
    `--${limite}--`,
    "",
  ].join("\r\n");

  return Buffer.from(cabeceras + cuerpo);
}

async function main() {
  // ---------- Identificar un correo ----------
  // El UID solo es único dentro de la carpeta. Si el servidor la reconstruye, los UID se
  // reparten de nuevo: sin el UIDVALIDITY delante, una factura nueva heredaría el número
  // de una vieja y el sistema la daría por registrada sin estarlo.
  check("el identificador junta validez y número", idDe(123n, 45) === "123-45");
  check("y se puede volver a partir",
    partirId("123-45").validez === "123" && partirId("123-45").uid === 45);
  check("dos carpetas distintas no comparten identificador", idDe(999n, 45) !== idDe(123n, 45));

  // ---------- Convertir el correo ----------
  const xml = '<?xml version="1.0"?><Invoice><ID>F001-1234</ID></Invoice>';
  const { mensaje, adjuntos } = await comoMensaje(
    correoCrudo({
      partes: [
        { nombre: "20123456789-01-F001-1234.xml", tipo: "text/xml", contenido: xml },
        { nombre: "factura.pdf", tipo: "application/pdf", contenido: "%PDF-1.4 contenido" },
      ],
    }),
    "100-7",
  );

  check("conserva el identificador que se le dio", mensaje.id === "100-7", mensaje.id);
  check("lee el asunto", mensaje.subject === "Factura F001-1234", mensaje.subject);
  check("lee quién lo envía",
    mensaje.from?.emailAddress?.address === "facturacion@proveedor.com"
    && mensaje.from?.emailAddress?.name === "Facturacion SAC", mensaje.from);
  check("lee la fecha en que llegó", mensaje.receivedDateTime.startsWith("2026-10-13"), mensaje.receivedDateTime);
  check("guarda el Message-ID del remitente", mensaje.internetMessageId === "<abc123@proveedor.com>", mensaje.internetMessageId);
  check("avisa que trae adjuntos", mensaje.hasAttachments === true);
  check("trae un resumen del cuerpo", (mensaje.bodyPreview ?? "").includes("adjunto la factura"), mensaje.bodyPreview);

  check("encuentra los dos adjuntos", adjuntos.length === 2, adjuntos.map((a) => a.name));
  const elXml = adjuntos.find((a) => a.name.endsWith(".xml"));
  check("el XML llega entero y sin tocar", elXml?.data.toString() === xml, elXml?.data.toString().slice(0, 60));
  check("con su tipo", elXml?.contentType === "text/xml", elXml?.contentType);
  check("y su tamaño", elXml?.size === Buffer.byteLength(xml), [elXml?.size, Buffer.byteLength(xml)]);
  const elPdf = adjuntos.find((a) => a.name.endsWith(".pdf"));
  check("el PDF también", elPdf?.data.toString() === "%PDF-1.4 contenido", elPdf?.data.toString());
  check("cada adjunto tiene identificador propio",
    new Set(adjuntos.map((a) => a.id)).size === 2, adjuntos.map((a) => a.id));

  // ---------- Lo que no es un adjunto ----------
  // El logotipo de la firma del remitente viaja como parte incrustada. Tomarlo por adjunto
  // llenaría la factura de imágenes que nadie pidió.
  const conFirma = await comoMensaje(
    correoCrudo({
      partes: [
        { nombre: "logo.png", tipo: "image/png", contenido: "PNGFALSO", inline: true },
        { nombre: "20123456789-01-F001-9999.xml", tipo: "text/xml", contenido: xml },
      ],
    }),
    "100-8",
  );
  check("el logotipo de la firma no cuenta como adjunto",
    conFirma.adjuntos.length === 1 && conFirma.adjuntos[0].name.endsWith(".xml"),
    conFirma.adjuntos.map((a) => a.name));

  // ---------- Un correo sin nada ----------
  const vacio = await comoMensaje(correoCrudo(), "100-9");
  check("un correo sin adjuntos lo dice", vacio.mensaje.hasAttachments === false);
  check("y no inventa ninguno", vacio.adjuntos.length === 0);

  // ---------- Los fallos, en palabras ----------
  const fallo = (code: string, message = "boom") => explicar(Object.assign(new Error(message), { code }), CONFIG);
  check("servidor que no existe", fallo("ENOTFOUND").includes("IMAP_HOST"), fallo("ENOTFOUND"));
  check("puerto cerrado", fallo("ECONNREFUSED").includes("IMAP_PORT"), fallo("ECONNREFUSED"));
  check("servidor que no responde", fallo("ETIMEDOUT").includes("bloqueando"), fallo("ETIMEDOUT"));
  check("usuario o clave mal",
    explicar(new Error("Authentication failed"), CONFIG).includes("IMAP_PASSWORD"),
    explicar(new Error("Authentication failed"), CONFIG));
  check("todos los mensajes nombran el servidor o la variable a revisar",
    [fallo("ENOTFOUND"), fallo("ECONNREFUSED"), fallo("ETIMEDOUT"), explicar(new Error("raro"), CONFIG)]
      .every((m) => m.includes(CONFIG.host) || m.includes("IMAP_")));

  // ---------- Qué buzón se elige ----------
  // Importar el módulo aparte para poder cambiar el entorno antes de que lo lea.
  const limpiar = () => {
    for (const v of ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID",
      "GRAPH_CLIENT_SECRET", "INVOICE_MAILBOX", "GRAPH_WEBHOOK_SECRET"]) delete process.env[v];
  };
  const { readMailboxConfig, missingMailboxSettings } = await import("../src/server/mailbox-config");

  limpiar();
  check("sin nada configurado no hay buzón", readMailboxConfig() === null);
  check("y se reclaman las variables de IMAP, que es el camino corto",
    missingMailboxSettings().includes("IMAP_HOST"), missingMailboxSettings());

  limpiar();
  Object.assign(process.env, { IMAP_HOST: "mail.x.com", IMAP_USER: "f@x.com", IMAP_PASSWORD: "c" });
  const soloImap = readMailboxConfig();
  check("con las de IMAP se elige IMAP", soloImap?.kind === "imap", soloImap?.kind);
  check("el puerto por defecto es el 993 sobre SSL",
    soloImap?.kind === "imap" && soloImap.port === 993 && soloImap.secure === true, soloImap);
  check("sin INVOICE_MAILBOX se usa el propio usuario",
    soloImap?.kind === "imap" && soloImap.mailbox === "f@x.com", soloImap);

  limpiar();
  Object.assign(process.env, { IMAP_HOST: "mail.x.com", IMAP_USER: "f@x.com", IMAP_PASSWORD: "c", IMAP_PORT: "143" });
  const sinSsl = readMailboxConfig();
  check("el puerto 143 se trata como no cifrado de entrada",
    sinSsl?.kind === "imap" && sinSsl.secure === false, sinSsl);

  limpiar();
  Object.assign(process.env, {
    GRAPH_TENANT_ID: "t", GRAPH_CLIENT_ID: "c", GRAPH_CLIENT_SECRET: "s",
    INVOICE_MAILBOX: "f@x.com", GRAPH_WEBHOOK_SECRET: "w",
  });
  check("con las de Microsoft se elige Microsoft", readMailboxConfig()?.kind === "graph");

  // Con las dos cargadas manda IMAP: es la que se configuró a propósito, mientras que las
  // de Graph suelen quedar de un intento anterior que no llegó a ninguna parte.
  Object.assign(process.env, { IMAP_HOST: "mail.x.com", IMAP_USER: "f@x.com", IMAP_PASSWORD: "c" });
  check("con las dos, manda IMAP", readMailboxConfig()?.kind === "imap");

  limpiar();
  Object.assign(process.env, { IMAP_HOST: "mail.x.com" });
  check("con IMAP a medias se reclama lo que falta de IMAP",
    missingMailboxSettings().join(",") === "IMAP_USER,IMAP_PASSWORD", missingMailboxSettings());

  limpiar();
  Object.assign(process.env, { GRAPH_TENANT_ID: "t" });
  check("con Microsoft a medias se reclama lo que falta de Microsoft",
    missingMailboxSettings().includes("GRAPH_CLIENT_ID"), missingMailboxSettings());

  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
