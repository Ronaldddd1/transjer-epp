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
 * Instalación en el droplet:
 *
 *   1. Copiar este archivo junto al servidor de avisos.
 *   2. Crear el archivo de variables (chmod 600, la clave es un secreto):
 *        TRANSJER_URL=https://transjer-epp.vercel.app
 *        AVISOS_SECRET=...la misma que se puso en Vercel...
 *        AVISOS_DESTINO=51999888777          # el número que recibe, con código de país
 *        AVISOS_BAILEYS=http://127.0.0.1:3001/enviar
 *   3. Probar sin enviar nada:   node aviso-vencimientos.mjs --simular
 *   4. Programarlo con cron, de lunes a sábado a las 8:00:
 *        0 8 * * 1-6  cd /ruta/al/servidor && /usr/bin/node aviso-vencimientos.mjs >> avisos.log 2>&1
 *
 * No usa ninguna dependencia: Node 18 o superior ya trae fetch.
 */

const URL_BASE = (process.env.TRANSJER_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.AVISOS_SECRET ?? "";
const DESTINO = process.env.AVISOS_DESTINO ?? "";
const BAILEYS = process.env.AVISOS_BAILEYS ?? "";
const DIAS = Number(process.env.AVISOS_DIAS ?? 2);
const SIMULAR = process.argv.includes("--simular");

const ahora = () => new Date().toLocaleString("es-PE", { timeZone: "America/Lima" });
const log = (...partes) => console.log(`[${ahora()}]`, ...partes);

/**
 * El envío. Es lo único que depende de tu servidor de avisos.
 *
 * Por defecto hace POST a AVISOS_BAILEYS con { numero, mensaje }. Si tu servidor espera
 * otra cosa, cambia solo esta función: el resto del script no sabe nada de WhatsApp.
 */
async function enviarWhatsApp(numero, mensaje) {
  if (!BAILEYS) throw new Error("Falta AVISOS_BAILEYS: no se sabe a qué servidor pedirle el envío.");
  const r = await fetch(BAILEYS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numero, mensaje }),
  });
  if (!r.ok) throw new Error(`El servidor de avisos respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${URL_BASE}${ruta}`, {
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
