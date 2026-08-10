import { createServer } from 'node:http';

/**
 * LA PANTALLA DE CAMPAÑAS, CON LOS VALORES REALES DE PRODUCCIÓN.
 *
 *   node scratchpad/stub-campanas.mjs
 *   VITE_API_URL=http://localhost:4199 npx vite --port 5199
 *   → http://localhost:5199/galeria-campanas.html
 *
 * ⚠️ **Los números son los MEDIDOS el 10-ago-2026 en `hermes_db` (VPS1)**, no
 * unos lindos. Es la lección de la galería del radar: un stub con datos ideales
 * no es evidencia — ahí tapó tres defectos que producción tenía a la vista.
 *
 * Y por eso las tres plantillas de esta galería son los tres estados que
 * importan, todos reales:
 *
 *   · `foro_estado_5_ago`  → 1.000 salieron, 4 no, y se pueden medir todos.
 *   · `promo_3x1_cursos`   → 88 salieron con `referencia = 'campana:…'`, así que
 *                            de NINGUNO se puede saber si contestó.
 *   · `hello_world`        → nunca se mandó. Un cero de verdad.
 */

const CUERPO_FORO = `👋 Hola buen día. Te saluda Luz asesora comercial de Goberna. Quiero invitarlo a participar en el:

🏛️𝗫𝗜𝗜 𝗙𝗢𝗥𝗢 𝗗𝗘 𝗘𝗦𝗧𝗔𝗗𝗢 - Aniversario GOBERNA 🏛️
Si eres político, candidato, autoridad electa, miembro del personal militar/policial o líder de seguridad en el sector corporativo, este es el espacio donde debes estar este 29 de agosto.

🗓️Fecha: Sábado 29 de agosto
📍Lugar: Hotel Westin, Lima.
Hora 2:00 PM a 10:00 PM.
👥 𝗔𝗳𝗼𝗿𝗼: Exclusivo para 200 personas.

*Único pago de S/360.00*
 Categoría General`;

const aprobada = (extra) => ({
  estado: 'APPROVED',
  enviable: true,
  lectura: { titulo: 'Aprobada', detalle: null, tono: 'bien', enviable: true },
  calidad: { texto: 'Sin medir todavía', tono: 'espera' },
  ...extra,
});

const PLANTILLAS = [
  aprobada({
    nombre: 'foro_estado_5_ago',
    idioma: 'es_PE',
    categoria: 'MARKETING',
    cuerpo: CUERPO_FORO,
    headerDeImagen: true,
    id: '1',
  }),
  aprobada({
    nombre: 'promo_3x1_cursos',
    idioma: 'en',
    categoria: 'MARKETING',
    cuerpo: 'Hola {{1}}, tenemos 3x1 en los diplomados de agosto.',
    headerDeImagen: false,
    id: '2',
  }),
  aprobada({
    nombre: 'hello_world',
    idioma: 'en_US',
    categoria: 'UTILITY',
    cuerpo: 'Hello World',
    headerDeImagen: false,
    id: '3',
  }),
];

/** Wilson al 95 %, tal como lo devuelve `resultados/medicion.ts`. */
const medicion = (exitos, n, bajo, alto) => ({
  base: 'respondio_despues_de',
  exitos,
  n,
  tasa: n === 0 ? null : exitos / n,
  intervalo: n === 0 ? null : { bajo, alto },
  muestraSuficiente: n >= 30,
});

const ENVIOS = {
  dias: 90,
  // 471 envíos escritos a mano en la ventana, 76 con respuesta.
  lineaDeBase: { envios: 471, respondieron: medicion(76, 471, 0.13, 0.2) },
  plantillas: [
    {
      plantilla: 'foro_estado_5_ago',
      salieron: 1000,
      noSalieron: 4,
      medibles: 1000,
      primerUso: '2026-08-05T20:10:20.839Z',
      ultimoUso: '2026-08-06T01:08:12.373Z',
      versiones: 1,
      respondieron: medicion(26, 1000, 0.018, 0.038),
      medianaMinutosHastaLaRespuesta: 8,
    },
    {
      plantilla: 'promo_3x1_cursos',
      salieron: 88,
      noSalieron: 1,
      medibles: 0,
      primerUso: '2026-08-05T15:44:56.995Z',
      ultimoUso: '2026-08-05T17:26:44.290Z',
      versiones: 1,
      respondieron: medicion(0, 0),
      medianaMinutosHastaLaRespuesta: null,
    },
  ],
};

// `corridas_campana` y `listas_campana` tienen CERO filas en producción: nunca
// se armó una campaña desde la app. La galería sirve eso mismo.
const RUTAS = {
  '/api/campana/plantillas': {
    plantillas: PLANTILLAS,
    resumen: { total: 3, enviables: 3, conProblema: 0 },
  },
  '/api/campana/plantillas/envios': ENVIOS,
  '/api/campana/corridas': { corridas: [], aviso: null },
  '/api/campana/listas': { listas: [] },
  '/api/campana/historial': { historial: [] },
  '/api/campana/vivas': { vivas: [] },
  '/api/auth/yo': { vendedoraId: 'luz' },
};

createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  const cuerpo = RUTAS[ruta];
  res.writeHead(cuerpo ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(cuerpo ?? { ok: false, motivo: 'sin_stub', ruta }));
}).listen(4199, () => console.log('stub de campañas en :4199'));
