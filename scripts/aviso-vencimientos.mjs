/**
 * Aviso de vencimientos por WhatsApp.
 *
 * Va en el VPS de avisos, no en Vercel. Cada mañana pregunta a Transjer Gestión qué cuotas
 * de préstamos y servicios vencen pronto, manda un WhatsApp y le avisa de vuelta qué se
 * envió, para que ese vencimiento no se repita al día siguiente.
 *
 * Se hace así —el VPS preguntando— para no abrir ningún puerto: el servidor de avisos
 * sigue detrás de Tailscale, sin exponerse a internet.
 *
 * Para mandar el WhatsApp usa la ruta que el servidor de avisos ya tiene, POST /api/mensaje,
 * la misma del panel para escribirle a un número suelto. No hace falta tocar ese servidor.
 *
 * Instalación en el droplet:
 *
 *   1. Copiar este archivo a la carpeta del servidor de avisos.
 *   2. Crear el archivo de variables (chmod 600: lleva dos claves):
 *        TRANSJER_URL=https://transjer-epp.vercel.app
 *        AVISOS_SECRET=...la misma que se puso en Vercel...
 *        AVISOS_DESTINO=51999888777          # el número que recibe, con código de país
 *        AVISOS_PANEL=http://127.0.0.1:3000/api/mensaje
 *        AVISOS_PANEL_USUARIO=...el USUARIO_PANEL del servidor de avisos...
 *        AVISOS_PANEL_CLAVE=...la CLAVE_PANEL del servidor de avisos...
 *      El script lo lee solo: no hace falta cargarlo antes con `set -a; . ./.env.avisos`.
 *   3. Probar sin enviar nada:   node aviso-vencimientos.mjs --simular
 *   4. Programarlo con cron, de lunes a sábado a las 8:00:
 *        0 8 * * 1-6  cd /ruta/al/servidor && /usr/bin/node aviso-vencimientos.mjs >> avisos.log 2>&1
 *
 * No usa ninguna dependencia: Node 18 o superior ya trae fetch.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Lee el archivo de variables que está junto a este script.
 *
 * Lo lee aquí y no con `set -a; . ./.env.avisos` a propósito. Al cargarlo desde bash, una
 * clave con un espacio o con caracteres como $ o ` se parte: el shell se queda con el
 * primer trozo e intenta ejecutar el resto. La variable termina a medias y el envío falla
 * con un 401 que no se explica mirando el archivo, porque ahí la clave está bien escrita.
 * Partiendo por el primer "=" y sin pasar por el shell, el valor llega entero sea cual sea.
 *
 * Lo que ya venga en el entorno manda sobre el archivo, para poder probar cosas sueltas:
 *   AVISOS_DIAS=30 node aviso-vencimientos.mjs --simular
 */
function cargarVariables() {
  const archivo = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env.avisos");
  if (!fs.existsSync(archivo)) return;

  for (const linea of fs.readFileSync(archivo, "utf8").split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;

    const corte = limpia.indexOf("=");
    if (corte < 1) continue;

    const nombre = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    // Se aceptan valores entrecomillados, por si el archivo viene de otro sitio.
    const comilla = valor[0];
    if ((comilla === '"' || comilla === "'") && valor.endsWith(comilla) && valor.length > 1) {
      valor = valor.slice(1, -1);
    }
    if (!(nombre in process.env)) process.env[nombre] = valor;
  }
}

cargarVariables();

const URL_BASE = (process.env.TRANSJER_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.AVISOS_SECRET ?? "";
const DESTINO = process.env.AVISOS_DESTINO ?? "";
const PANEL = process.env.AVISOS_PANEL ?? "http://127.0.0.1:3000/api/mensaje";
const PANEL_USUARIO = process.env.AVISOS_PANEL_USUARIO ?? "";
const PANEL_CLAVE = process.env.AVISOS_PANEL_CLAVE ?? "";
const DIAS = Number(process.env.AVISOS_DIAS ?? 2);
const SIMULAR = process.argv.includes("--simular");

const ahora = () => new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
const log = (...partes) => console.log(`[${ahora()}]`, ...partes);

/**
 * El envío. Es lo único que depende del servidor de avisos.
 *
 * Usa su ruta POST /api/mensaje, la que el panel ya usa para escribirle a un número
 * suelto: recibe { telefono, texto } y por dentro resuelve el JID, comprueba que el
 * número tenga WhatsApp y manda. Nada de eso hace falta repetirlo acá.
 *
 * El panel entero está detrás de autenticación básica, así que va con el usuario y la
 * clave del panel. Si ese servidor corriera sin CLAVE_PANEL —no debería—, basta con
 * dejar vacías las dos variables y se manda sin cabecera.
 */
/**
 * fetch, pero diciendo a quién no pudo alcanzar.
 *
 * Cuando algo no responde, fetch lanza "fetch failed" a secas. Leído tres días después en
 * el log del cron, eso no dice si se cayó la web, el servidor de envío o el internet del
 * droplet. Aquí se nombra la dirección y el motivo del sistema operativo.
 */
async function pedirRed(url, opciones) {
  try {
    return await fetch(url, opciones);
  } catch (e) {
    const motivo = e?.cause?.code ?? e?.cause?.message ?? e?.message ?? "sin detalle";
    throw new Error(`No se pudo conectar con ${url} (${motivo}).`);
  }
}

async function enviarWhatsApp(telefono, texto) {
  const cabeceras = { "Content-Type": "application/json" };
  if (PANEL_CLAVE) {
    const credencial = Buffer.from(`${PANEL_USUARIO}:${PANEL_CLAVE}`).toString("base64");
    cabeceras.Authorization = `Basic ${credencial}`;
  }

  const r = await pedirRed(PANEL, { method: "POST", headers: cabeceras, body: JSON.stringify({ telefono, texto }) });
  if (r.ok) return;

  const detalle = (await r.text()).slice(0, 200);
  // El 401 es el error más probable al configurarlo, y "Acceso restringido" a secas no
  // dice qué hay que arreglar.
  if (r.status === 401) {
    throw new Error(
      "El panel de avisos rechazó el acceso (401). Revisa AVISOS_PANEL_USUARIO y "
      + "AVISOS_PANEL_CLAVE: tienen que ser los mismos USUARIO_PANEL y CLAVE_PANEL de ese servidor.",
    );
  }
  throw new Error(`El panel de avisos respondió ${r.status}: ${detalle}`);
}

async function pedir(ruta, opciones = {}) {
  const r = await pedirRed(`${URL_BASE}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json", ...opciones.headers },
  });
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function main() {
  for (const [nombre, valor] of [["TRANSJER_URL", URL_BASE], ["AVISOS_SECRET", SECRET], ["AVISOS_DESTINO", DESTINO]]) {
    if (!valor) throw new Error(`Falta la variable ${nombre}.`);
  }

  const { cuotas, mensaje } = await pedir(`/api/avisos/vencimientos?dias=${DIAS}`);

  if (!mensaje) {
    log(`Nada vence en los próximos ${DIAS} día(s). No se envía nada.`);
    return;
  }

  log(`${cuotas.length} cuota(s) por avisar.`);
  if (SIMULAR) {
    console.log("\n--- SIMULACIÓN, no se envía ni se marca nada ---\n");
    console.log(mensaje);
    return;
  }

  await enviarWhatsApp(DESTINO, mensaje);
  log(`Mensaje enviado a ${DESTINO}.`);

  // Solo después de que el envío salió bien se marcan como avisadas. Si WhatsApp falla, el
  // aviso se vuelve a intentar mañana en vez de perderse en silencio.
  const { marcadas } = await pedir("/api/avisos/vencimientos", {
    method: "POST",
    body: JSON.stringify({ enviados: cuotas.map((c) => c.id) }),
  });
  log(`${marcadas} cuota(s) quedaron marcadas como avisadas.`);
}

main().catch((e) => {
  log("FALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
