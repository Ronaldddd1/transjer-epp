/**
 * La ruta de envío de WhatsApp que va en el servidor de avisos del droplet.
 *
 * Se prueba con un socket de Baileys inventado y un servidor Express inventado: lo que
 * importa es que no mande a números que no existen, que no quede abierta sin clave, y que
 * distinga "WhatsApp todavía no conecta" —que se reintenta— de "el pedido está mal", que
 * no tiene sentido reintentar.
 *
 *   npx tsx tests/envio-whatsapp.test.ts
 */
// @ts-expect-error — es un .mjs sin tipos, pensado para copiarse al droplet tal cual.
import { enviarTexto, montarEnvio, normalizarNumero } from "../scripts/enviar-mensaje.mjs";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

/** Un socket de Baileys de mentira: anota lo que se le manda. */
function socketFalso({ conectado = true, conWhatsApp = ["51999888777"] } = {}) {
  const enviados: { jid: string; texto: string }[] = [];
  return {
    enviados,
    user: conectado ? { id: "51963898237:1@s.whatsapp.net" } : null,
    async onWhatsApp(n: string) {
      return conWhatsApp.includes(n) ? [{ jid: `${n}@s.whatsapp.net`, exists: true }] : [{ exists: false }];
    },
    async sendMessage(jid: string, c: { text: string }) {
      enviados.push({ jid, texto: c.text });
      return { key: { id: "MSG1" } };
    },
  };
}

/** Un Express de mentira: guarda el manejador para poder llamarlo a mano. */
function appFalso() {
  let manejador: ((req: unknown, res: unknown) => Promise<void>) | null = null;
  return {
    post(_ruta: string, fn: (req: unknown, res: unknown) => Promise<void>) { manejador = fn; },
    async llamar(cuerpo: unknown, autorizacion?: string) {
      const resultado: { estado: number; cuerpo: Record<string, unknown> } = { estado: 0, cuerpo: {} };
      const res = {
        status(n: number) { resultado.estado = n; return res; },
        json(d: Record<string, unknown>) { resultado.cuerpo = d; if (!resultado.estado) resultado.estado = 200; return res; },
      };
      await manejador!({ headers: { authorization: autorizacion }, body: cuerpo }, res);
      return resultado;
    },
  };
}

async function main() {
  // ---------- El número ----------
  const numeros: [unknown, string | null][] = [
    ["963898237", "51963898237"],       // celular peruano sin código de país
    ["+51 963 898 237", "51963898237"], // con espacios y símbolos
    ["51999888777", "51999888777"],
    ["123", null],
    ["", null],
    [null, null],
  ];
  for (const [entrada, esperado] of numeros) {
    check(`normaliza ${JSON.stringify(entrada)}`, normalizarNumero(entrada) === esperado, normalizarNumero(entrada));
  }

  // ---------- El envío ----------
  const sock = socketFalso();
  const enviado = await enviarTexto(sock, "51999888777", "hola");
  check("manda al jid que devuelve WhatsApp", enviado.jid === "51999888777@s.whatsapp.net", enviado);
  check("y con el texto tal cual", sock.enviados[0]?.texto === "hola", sock.enviados);

  const falla = async (fn: () => Promise<unknown>) => {
    try { await fn(); return ""; } catch (e) { return e instanceof Error ? e.message : String(e); }
  };
  check("sin conexión no manda nada",
    (await falla(() => enviarTexto(socketFalso({ conectado: false }), "51999888777", "x"))).includes("no está conectado"));
  // Un número mal escrito se "enviaría" sin error y el aviso quedaría marcado como mandado
  // sin que nadie lo reciba: por eso se comprueba antes.
  check("a un número sin WhatsApp no manda",
    (await falla(() => enviarTexto(sock, "51900000000", "x"))).includes("no tiene WhatsApp"));
  check("un mensaje vacío se rechaza",
    (await falla(() => enviarTexto(sock, "51999888777", "   "))).includes("vacío"));

  // ---------- La ruta ----------
  check("sin clave la ruta no se monta",
    (await falla(async () => montarEnvio(appFalso(), () => sock, { secret: "" }))).includes("AVISOS_SECRET"));

  let vivo = socketFalso();
  const app = appFalso();
  montarEnvio(app, () => vivo, { secret: "clave" });

  let r = await app.llamar({ numero: "51999888777", mensaje: "hola" }, "Bearer otra");
  check("con la clave equivocada responde 401", r.estado === 401, r);
  r = await app.llamar({ numero: "51999888777", mensaje: "hola" }, undefined);
  check("sin cabecera responde 401", r.estado === 401, r);
  r = await app.llamar({ numero: "51999888777", mensaje: "hola" }, "Bearer clave");
  check("con la clave correcta envía", r.estado === 200 && vivo.enviados.length === 1, [r, vivo.enviados]);
  r = await app.llamar({ numero: "nada", mensaje: "hola" }, "Bearer clave");
  check("un número malo responde 400", r.estado === 400, r);

  // 503 y no 400: que WhatsApp no haya conectado todavía se arregla solo, y el servidor de
  // avisos lo puede reintentar. Un 400 diría que el pedido está mal y no vale reintentarlo.
  vivo = socketFalso({ conectado: false });
  r = await app.llamar({ numero: "51999888777", mensaje: "hola" }, "Bearer clave");
  check("desconectado responde 503", r.estado === 503, r);

  // El socket se lee en cada pedido: cuando Baileys se reconecta y lo reemplaza, la ruta
  // tiene que usar el nuevo y no quedarse con uno muerto.
  vivo = socketFalso();
  r = await app.llamar({ numero: "51999888777", mensaje: "de nuevo" }, "Bearer clave");
  check("tras reconectar vuelve a enviar", r.estado === 200 && vivo.enviados.length === 1, [r, vivo.enviados]);

  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
