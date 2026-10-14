import express from 'express';
import multer from 'multer';
import cron from 'node-cron';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db } from './db.js';
import { fechaLima, formatearFecha, normalizarTelefono } from './utils.js';
import { construirMensaje } from './plantilla.js';
import { iniciarWhatsApp, estadoWhatsApp, listarGrupos, enviarTexto } from './whatsapp.js';
import { enviarPendientes, enviarIndividual, enviarPrueba, estadoCola, registrarAcuse, procesarRespuesta } from './envios.js';
import { importarArchivo, registrarEnvio, generarPlantilla, generarReporte } from './importar.js';

const app = express();
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const raiz = path.dirname(fileURLToPath(import.meta.url));

// Protección del panel con usuario y clave (solo si CLAVE_PANEL está definida)
if (config.CLAVE_PANEL) {
  const esperado = 'Basic ' + Buffer.from(`${config.USUARIO_PANEL}:${config.CLAVE_PANEL}`).toString('base64');
  app.use((req, res, next) => {
    const recibido = req.headers.authorization || '';
    const ok = recibido.length === esperado.length &&
      crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
    if (ok) return next();
    res.set('WWW-Authenticate', 'Basic realm="TransJer"').status(401).send('Acceso restringido');
  });
} else {
  console.warn('⚠️  El panel está sin clave. Define CLAVE_PANEL antes de exponerlo fuera de la red local.');
}

app.use(express.json());
app.use(express.static(path.join(raiz, '..', 'public')));

const manejar = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) { res.status(400).json({ error: err.message }); }
};

// Mensaje libre a un número, para correcciones puntuales
app.post('/api/mensaje', manejar(async (req, res) => {
  const { telefono, texto } = req.body || {};
  const numero = normalizarTelefono(telefono);
  if (!numero) throw new Error('Celular inválido');
  if (!texto) throw new Error('Falta el texto');
  await enviarTexto(numero, texto);
  res.json({ ok: true });
}));

app.get('/api/estado', (req, res) => res.json({
  whatsapp: estadoWhatsApp(),
  cola: estadoCola(),
  manana: fechaLima(1),
  envioAutomatico: config.ENVIO_AUTOMATICO ? config.HORA_ENVIO : null,
}));

app.get('/api/envios', (req, res) => {
  const fecha = req.query.fecha || fechaLima(1);
  res.json({ fecha, fechaTexto: formatearFecha(fecha), envios: db.listar({ fecha }) });
});

app.post('/api/envios', manejar((req, res) => {
  const r = registrarEnvio(req.body);
  if (!r.ok) return res.status(400).json({ error: r.motivo });
  res.status(201).json(r.envio);
}));

app.post('/api/envios/importar', subir.single('archivo'), manejar(async (req, res) => {
  if (!req.file) throw new Error('Adjunta un archivo Excel o CSV');
  res.json(await importarArchivo(req.file.buffer, req.file.originalname));
}));

app.get('/api/envios/:id/vista-previa', manejar((req, res) => {
  const e = db.obtener(req.params.id);
  if (!e) throw new Error('Envío no encontrado');
  res.json({ texto: construirMensaje(e) });
}));

app.post('/api/envios/:id/enviar', manejar(async (req, res) => {
  const ok = await enviarIndividual(req.params.id, { ignorarHorario: !!req.body?.ignorarHorario });
  res.json({ ok, envio: db.obtener(req.params.id) });
}));

app.delete('/api/envios/:id', manejar((req, res) => {
  if (!db.eliminar(req.params.id)) throw new Error('Envío no encontrado');
  res.json({ ok: true });
}));

app.post('/api/enviar', manejar((req, res) => {
  const { fecha = fechaLima(1), incluirFallidos = false, ignorarHorario = false } = req.body || {};
  res.json({ encolados: enviarPendientes(fecha, { incluirFallidos, ignorarHorario }), fecha });
}));

app.post('/api/prueba', manejar(async (req, res) => {
  await enviarPrueba(req.body?.telefono, req.body?.id);
  res.json({ ok: true });
}));

// Reporte del día en Excel, para archivar o pasar a operaciones
app.get('/api/reporte.xlsx', manejar(async (req, res) => {
  const fecha = req.query.fecha || fechaLima(1);
  const buffer = await generarReporte(fecha, formatearFecha(fecha), db.listar({ fecha }));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="avisos-${fecha}.xlsx"`);
  res.send(Buffer.from(buffer));
}));

app.get('/api/grupos', manejar(async (req, res) => res.json({ grupos: await listarGrupos() })));

app.get('/api/plantilla.xlsx', manejar(async (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-envios-transjer.xlsx"');
  res.send(Buffer.from(await generarPlantilla()));
}));

// Envío automático diario de los pedidos de mañana
if (config.ENVIO_AUTOMATICO) {
  const [h, m] = config.HORA_ENVIO.split(':').map(Number);
  cron.schedule(`${m} ${h} * * *`, () => {
    try {
      const n = enviarPendientes(fechaLima(1), { ignorarHorario: true });
      console.log(`⏰ Envío automático iniciado: ${n} mensajes`);
    } catch (err) { console.error('⏰ Envío automático no iniciado:', err.message); }
  }, { timezone: config.ZONA_HORARIA });
}

app.listen(config.PORT, () => {
  console.log(`🚚 Panel TransJer en http://localhost:${config.PORT}`);
  iniciarWhatsApp({ mensaje: procesarRespuesta, acuse: registrarAcuse }).catch((err) => {
    console.error('No se pudo iniciar WhatsApp:', err.message);
  });
});
