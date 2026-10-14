import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion,
  Browsers, isPnUser, isLidUser,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from './config.js';

const logger = pino({ level: 'warn' });
let sock = null;
const estado = { conectado: false, qr: null, numero: null, nombre: null };
let manejadores = { mensaje: () => {}, acuse: () => {} };

export const estadoWhatsApp = () => ({ ...estado });

export async function iniciarWhatsApp(handlers) {
  manejadores = { ...manejadores, ...handlers };
  const { state, saveCreds } = await useMultiFileAuthState(config.CARPETA_SESION);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      estado.qr = await QRCode.toDataURL(qr, { margin: 1, width: 280 });
      estado.conectado = false;
      console.log('📱 Escanea el código QR desde el panel: http://localhost:' + config.PORT);
    }
    if (connection === 'open') {
      estado.conectado = true;
      estado.qr = null;
      estado.numero = sock.user?.id?.split(':')[0].split('@')[0] ?? null;
      estado.nombre = sock.user?.name ?? null;
      console.log('✅ WhatsApp conectado como', estado.numero);
    }
    if (connection === 'close') {
      estado.conectado = false;
      const codigo = lastDisconnect?.error?.output?.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        console.log('⚠️ Sesión cerrada desde el teléfono. Se generará un nuevo QR.');
        fs.rmSync(config.CARPETA_SESION, { recursive: true, force: true });
      } else {
        console.log('🔄 Conexión perdida (código', codigo, '), reconectando...');
      }
      setTimeout(() => iniciarWhatsApp(manejadores).catch(console.error), 3000);
    }
  });

  // Mensajes entrantes (respuestas de los destinatarios)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      if (m.key.fromMe || !m.message) continue;
      const jid = m.key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) continue;

      const texto =
        m.message.conversation ||
        m.message.extendedTextMessage?.text ||
        m.message.buttonsResponseMessage?.selectedDisplayText ||
        m.message.listResponseMessage?.title || '';

      const telefono = await telefonoDesdeJid(jid, m.key.remoteJidAlt);
      if (!telefono) continue;
      try {
        await manejadores.mensaje({ jid, telefono, texto: texto.trim() });
      } catch (err) { console.error('Error procesando respuesta:', err); }
    }
  });

  // Acuses de recibo: 3 = entregado, 4 = leído
  sock.ev.on('messages.update', (updates) => {
    for (const { key, update } of updates) {
      if (key.fromMe && update.status) manejadores.acuse(key.id, update.status);
    }
  });
}

// WhatsApp ahora puede identificar contactos con un "LID" en lugar del número.
async function telefonoDesdeJid(jid, jidAlt) {
  for (const j of [jid, jidAlt]) {
    if (j && isPnUser(j)) return j.split('@')[0].split(':')[0];
  }
  if (isLidUser(jid)) {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid).catch(() => null);
    if (pn) return pn.split('@')[0].split(':')[0];
  }
  return null;
}

export class SinWhatsAppError extends Error {}

/** Verifica si el número tiene WhatsApp y devuelve su JID. Si la consulta falla, usa el número tal cual. */
async function resolverJid(telefono) {
  const jidDirecto = `${telefono}@s.whatsapp.net`;
  let resultado;
  try {
    resultado = await sock.onWhatsApp(telefono);
  } catch (err) {
    console.warn('No se pudo verificar', telefono, '-', err.message, '| se envía igual');
    return jidDirecto;
  }
  const lista = Array.isArray(resultado) ? resultado : resultado ? [resultado] : [];
  if (!lista.length) return jidDirecto; // WhatsApp no respondió la consulta: se intenta enviar igual
  const r = lista[0];
  if (r.exists === false) throw new SinWhatsAppError('El número no tiene WhatsApp');
  return r.jid || jidDirecto;
}

/** Lista los grupos donde está el número vinculado, con su ID para usar en NOTIFICAR_A */
export async function listarGrupos() {
  if (!sock || !estado.conectado) throw new Error('WhatsApp no está conectado');
  const grupos = await sock.groupFetchAllParticipating();
  return Object.values(grupos)
    .map((g) => ({ id: g.id, nombre: g.subject, participantes: g.participants?.length ?? 0 }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export async function enviarTexto(destino, texto) {
  if (!sock || !estado.conectado) throw new Error('WhatsApp no está conectado');
  // Si es un grupo (termina en @g.us) se envía directo, sin verificar número
  if (String(destino).endsWith('@g.us')) {
    const enviadoGrupo = await sock.sendMessage(String(destino), { text: texto });
    return enviadoGrupo.key.id;
  }
  const telefono = destino;
  const jid = await resolverJid(telefono);
  const r = { jid };

  // Simula escritura humana antes de enviar
  await sock.sendPresenceUpdate('composing', r.jid).catch(() => {});
  await new Promise((res) => setTimeout(res, 1500 + Math.random() * 2000));
  const enviado = await sock.sendMessage(r.jid, { text: texto });
  await sock.sendPresenceUpdate('paused', r.jid).catch(() => {});
  return enviado.key.id;
}

export async function responder(jid, texto) {
  if (!sock || !estado.conectado) return;
  await sock.sendMessage(jid, { text: texto });
}
