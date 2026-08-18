import { createServer } from 'node:http';

/**
 * STUB PARA LA EVIDENCIA DE LA FRONTERA DE CAMPAÑA (`numeros/campana.ts`).
 *
 * Sirve lo mínimo para que la vista Mensajes se pinte con la mirada de un
 * SUPERVISOR DE VENTAS, con los números reales de producción:
 *
 *   · `/api/whatsapp/lineas` devuelve **solo la de la Escuela** — la de campaña
 *     (`51963139984`, «Betto») ya no se le ofrece.
 *   · la cola trae una conversación de campaña **como la traería el caché de
 *     IndexedDB de ayer** (ADR 0007), que es la única puerta que queda para
 *     llegar a ese hilo…
 *   · …y `/api/whatsapp/conversacion/` contesta el **403 `linea_de_campana`**
 *     de verdad, que es lo que se quiere fotografiar.
 *
 * Uso: `node scratchpad/api-campana.mjs` + `VITE_API_URL=http://localhost:4199 npx vite --port 5199`
 */

const PUERTO = 4199;
const ESCUELA = '51984429504';
const CAMPANA = '51963139984';
const AHORA = new Date().toISOString();

const conversacion = (persona, nombre, linea, texto) => ({
  clave: `conv:whatsapp:${persona}:${linea}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: persona,
  persona_nombre: nombre,
  numero_propio: linea,
  texto,
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 3,
  referencia: AHORA,
  ultimo_at: AHORA,
  primer_at: AHORA,
  dias: 0,
  nivel: 3,
  etapa_manual: null,
  hablo: true,
  ya_le_hablamos: true,
  precio_enviado: false,
});

const COLA = [
  conversacion('51900000001', 'Milagros Quispe', ESCUELA, 'Hola, quiero el diploma de OSINT'),
  // La de campaña: en producción ya NO llegaría acá — está en la foto porque es
  // lo que el caché de ayer todavía muestra, y es cómo se llega al 403.
  conversacion('51900000002', 'Lead de la campaña', CAMPANA, 'Hola, apoyo la candidatura'),
];

/**
 * ⚠️ **Los endpoints que la mesa pide de arranque, aunque esta evidencia no los
 * mire.** El riel abre en Dashboard y la app es UNA sola pantalla (ADR 0002):
 * un `{}` donde el front espera una lista revienta con «Cannot read properties
 * of undefined (reading 'find')» y la captura sale del splash, **sin un error
 * visible en la pantalla**. Pasó acá.
 */
const RUTAS = {
  '/api/categorias': { categorias: [] },
  // ⚠️ `useRueda` hace `q.data?.destinos.length` — con un `{}` el `.length`
  // revienta y se cae la app entera al abrir un chat. (No es de este frente: es
  // un `?.` que falta en `features/reparto/reparto.ts:57`.)
  '/api/reparto/rueda': { rueda: [], destinos: [] },
  '/api/senales': { senales: {} },
  '/api/gestiones/intereses': { intereses: [], derivados: [] },
  '/api/eventos': { eventos: [] },
  '/api/hechos': { hechos: [] },
  '/api/agenda': { recordatorios: [], pendientes: [] },
  '/api/autorespuesta': { modo: 'apagada', encendida: false },
  '/api/interactions/frescura': { frescura: null },
  // Las MISMAS claves que emite `routes/dashboard.ts`: una que falte revienta la
  // vista con un `.map` de undefined, y el riel entero queda sin dibujar.
  '/api/dashboard': {
    chats: [],
    formularios: [],
    etapas: {},
    etiquetas: {},
    porVendedora: [],
    automaticos: null,
    embudo: {},
    cursos: [],
    series: { leads_dia: [], envios_dia: [], ventas_dia: [] },
    supervisor: true,
  },
  // ⚠️ La FORMA importa: el front lee `r.vendedora`, no un `vendedoraId` suelto
  // (`features/auth/sesion.ts`). Con la forma equivocada se queda en el login y
  // la captura sale del splash — pasó, y no da ningún error en consola.
  '/api/auth/yo': {
    vendedora: { id: 'alex', nombre: 'Alex Roldán' },
    cerberus: true,
    rol: 'supervisor',
    esSupervisor: true,
  },
  '/api/whatsapp/lineas': {
    lineas: [{ numero: ESCUELA, etiqueta: 'Ventas Meta', estado: 'conectado', mias: false, compartida: true }],
  },
  '/api/whatsapp/sesion': { estado: 'conectado', telefono: ESCUELA, transporte: 'cloud-api' },
  '/api/conversaciones': {
    conversaciones: COLA,
    total: COLA.length,
    conteos: {},
    conteosFiltro: {},
    desglose: [],
  },
};

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  // ⚠️ Sin declarar los métodos, el preflight de un `PUT` falla y la app se cae
  // al abrir un chat (marcar leído). El navegador lo dice en consola y la
  // captura sale en blanco: un `*` en headers no alcanza.
  res.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('content-type', 'application/json');
  if (req.method === 'OPTIONS') return res.end('{}');

  // 🔴 LO QUE ESTA EVIDENCIA EXISTE PARA MOSTRAR.
  if (url.pathname.startsWith('/api/whatsapp/conversacion/')) {
    if (url.pathname.includes('51900000002')) {
      res.statusCode = 403;
      return res.end(
        JSON.stringify({ ok: false, motivo: 'linea_de_campana', message: 'esa línea es de una campaña y no la atendés' }),
      );
    }
    return res.end(JSON.stringify({ telefono: '51900000001', mensajes: [], origen: null }));
  }

  if (process.env.LOG) console.log(req.method, url.pathname + url.search);
  const fijo = RUTAS[url.pathname];
  if (fijo) return res.end(JSON.stringify(fijo));
  res.end('{}');
}).listen(PUERTO, () => console.log(`stub de campaña en http://localhost:${PUERTO}`));
