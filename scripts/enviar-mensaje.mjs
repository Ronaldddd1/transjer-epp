/**
 * Ruta para mandar un mensaje suelto por WhatsApp.
 *
 * Va en el servidor de avisos del droplet, no en Vercel. Tu servidor ya sabe mandar los
 * avisos de entrega; esto le agrega una ruta para mandar un texto cualquiera a un número,
 * que es lo que necesita el aviso de vencimientos de Transjer Gestión.
 *
 * No toca nada de lo que ya tienes: recibe tu socket de Baileys y se monta encima de tu
 * servidor Express. En el archivo principal, después de crear el socket:
 *
 *     import { montarEnvio } from "./enviar-mensaje.mjs";
 *     montarEnvio(app, () => sock);
 *
 * `app` es tu servidor de Express y `sock` la variable del socket de Baileys —si en tu
 * código se llaman distinto, cambia esos dos nombres y listo. Se pasa como función
 * (`() => sock`) y no como valor para que, cuando Baileys se reconecte y reemplace el
 * socket, la ruta use el nuevo y no uno muerto.
 *
 * Protección: la ruta pide una clave en la cabecera, la misma AVISOS_SECRET del archivo
 * de variables. El panel ya está detrás de Tailscale y no se expone a internet, pero una
 * ruta que manda WhatsApp a cualquier número no debería quedar abierta ni dentro de casa.
 */

/** "+51 963 898 237" → "51963898237". Devuelve null si no parece un número utilizable. */
export function normalizarNumero(valor) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  // Con 9 dígitos es un celular peruano escrito sin código de país: se le antepone el 51.
  const completo = digitos.length === 9 && digitos.startsWith("9") ? `51${digitos}` : digitos;
  // Un número internacional válido tiene entre 8 y 15 dígitos contando el código de país.
  return completo.length >= 8 && completo.length <= 15 ? completo : null;
}

/**
 * Manda un texto por WhatsApp con el socket que le pases.
 *
 * Antes de mandar comprueba que el número tenga WhatsApp. Sin esa comprobación, un número
 * mal escrito se "envía" sin error y el mensaje no llega a ninguna parte: el aviso queda
 * marcado como enviado y nadie se entera de que nunca llegó.
 */
export async function enviarTexto(sock, numero, texto) {
  if (!sock?.user) throw new Error("WhatsApp no está conectado todavía.");

  const limpio = normalizarNumero(numero);
  if (!limpio) throw new Error(`Número inválido: "${numero}".`);
  if (!texto || !String(texto).trim()) throw new Error("El mensaje viene vacío.");

  const [encontrado] = await sock.onWhatsApp(limpio);
  if (!encontrado?.exists) throw new Error(`El número ${limpio} no tiene WhatsApp.`);

  // Se usa el jid que devuelve WhatsApp y no el que armamos nosotros: en algunos países
  // el número registrado no es exactamente el que uno escribe.
  const envio = await sock.sendMessage(encontrado.jid, { text: String(texto) });
  return { jid: encontrado.jid, id: envio?.key?.id ?? null };
}

/**
 * Monta POST /enviar sobre tu servidor Express.
 *
 *   POST /enviar
 *   Authorization: Bearer <AVISOS_SECRET>
 *   { "numero": "51999888777", "mensaje": "texto" }
 *
 * @param app       Tu servidor de Express.
 * @param traerSock Función que devuelve el socket de Baileys vigente.
 * @param opciones  { ruta, secret } por si quieres otra ruta u otra clave.
 */
/**
 * El cuerpo del pedido, venga ya leído o no.
 *
 * Si tu servidor usa express.json(), el cuerpo ya está en req.body y se devuelve tal cual.
 * Si no lo usa, req.body llega vacío y la ruta respondería "número inválido" sin que se
 * entienda por qué: aquí se lee el pedido directamente y se evita esa confusión.
 */
async function leerCuerpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    const partes = [];
    for await (const trozo of req) partes.push(trozo);
    const texto = Buffer.concat(partes).toString("utf8").trim();
    return texto ? JSON.parse(texto) : {};
  } catch {
    return {};
  }
}

export function montarEnvio(app, traerSock, opciones = {}) {
  const ruta = opciones.ruta ?? "/enviar";
  const secret = opciones.secret ?? process.env.AVISOS_SECRET ?? "";

  if (!secret) {
    throw new Error(
      "Falta AVISOS_SECRET: sin clave, la ruta de envío quedaría abierta y no se monta.",
    );
  }

  app.post(ruta, async (req, res) => {
    if (req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ ok: false, error: "No autorizado" });
    }

    const { numero, mensaje } = await leerCuerpo(req);
    try {
      const enviado = await enviarTexto(traerSock(), numero, mensaje);
      console.log(`[envio] ${new Date().toISOString()} → ${enviado.jid}`);
      res.json({ ok: true, ...enviado });
    } catch (e) {
      const razón = e instanceof Error ? e.message : String(e);
      console.error(`[envio] falló: ${razón}`);
      // 503 cuando es que WhatsApp todavía no conecta: eso se reintenta solo. El resto es
      // un problema del pedido y reintentarlo daría lo mismo.
      res.status(razón.includes("no está conectado") ? 503 : 400).json({ ok: false, error: razón });
    }
  });

  console.log(`[envio] ruta ${ruta} lista.`);
}
