import http from 'node:http';

/**
 * Servidor mock SOLO PARA VER LA PANTALLA DE MENSAJES SIN BACKEND REAL.
 *
 * No es parte del repo real ni de ningún ADR — se escribió a mano para poder
 * abrir la app real (localhost:5173) contra datos de ejemplo, sin Docker ni
 * Postgres ni Cerberus. Login: cualquier usuario/contraseña.
 *
 * Cubre: sesión, /api/conversaciones (la cola), /api/whatsapp/conversacion/:tel
 * (el hilo), /api/whatsapp/sesion, /api/whatsapp/leido, /api/whatsapp/enviar.
 * Todo lo demás (hechos, señales, intereses, eventos, agenda, dashboard...)
 * contesta un cuerpo vacío/neutral en vez de un error, para que el panel
 * derecho se vea completo aunque esas secciones no tengan datos reales.
 */

const PUERTO = 4199;
const DURACION_MS = 14 * 24 * 60 * 60 * 1000;

function firmarSesion(id) {
  const cuerpo = Buffer.from(`${id}|${Date.now() + DURACION_MS}`).toString('base64url');
  return `${cuerpo}.mock`;
}

function idDeToken(token) {
  const [cuerpo] = (token ?? '').split('.');
  if (!cuerpo) return null;
  try {
    const [id, expira] = Buffer.from(cuerpo, 'base64url').toString().split('|');
    if (!id || !(Number(expira) > Date.now())) return null;
    return id;
  } catch {
    return null;
  }
}

const NUMERO_PROPIO = '51984429504';

const hilos = {
  '51987654321': {
    telefono: '51987654321',
    origen: { fuente: 'anuncio', titulo: 'Diplomado en Inteligencia y Contrainteligencia' },
    mensajes: [
      { id: 1, direccion: 'entrante', autor: 'Lenin Ramírez', texto: 'Hola, quiero información sobre la consultoría política', occurred_at: '2026-08-19T14:22:00Z', external_id: 'wa:1' },
      { id: 2, direccion: 'saliente', autor: 'vos', texto: '¡Hola Lenin! Claro, te cuento. Tenemos dos modalidades: consultoría integral que incluye campaña, estrategia y vocería, y consultoría táctica solo para campaña. ¿Cuál te interesa más?', occurred_at: '2026-08-19T14:24:00Z', external_id: 'wa:2', entrega: 'leido' },
      { id: 3, direccion: 'entrante', autor: 'Lenin Ramírez', texto: 'Me interesa la campaña de 3 meses. ¿Cuánto cuesta?', occurred_at: '2026-08-20T09:15:00Z', external_id: 'wa:3' },
    ],
  },
  '51912345678': {
    telefono: '51912345678',
    origen: { fuente: 'landing', ref: 'diplomado-ciberdefensa' },
    mensajes: [
      { id: 4, direccion: 'entrante', autor: 'Alejandro García', texto: 'Buenas, quiero saber del diplomado en Ciberdefensa', occurred_at: '2026-08-19T08:10:00Z', external_id: 'wa:4' },
      { id: 5, direccion: 'entrante', autor: 'Alejandro García', texto: 'Sigo interesado, ¿tienen cupos?', occurred_at: '2026-08-19T08:12:00Z', external_id: 'wa:5' },
    ],
  },
  '51999888777': {
    telefono: '51999888777',
    origen: null,
    mensajes: [
      { id: 6, direccion: 'entrante', autor: 'María Castillo', texto: 'Hola, ¿me pueden decir el precio del diplomado?', occurred_at: '2026-08-20T10:45:00Z', external_id: 'wa:6' },
      { id: 7, direccion: 'saliente', autor: 'vos', texto: 'Hola María, el diplomado tiene un costo de S/ 3 200 en 6 cuotas. ¿Te mando el temario?', occurred_at: '2026-08-20T10:47:00Z', external_id: 'wa:7', entrega: 'entregado' },
    ],
  },
};

const cola = [
  {
    clave: 'conv:whatsapp:51987654321:' + NUMERO_PROPIO,
    canal: 'whatsapp', tipo: 'mensaje',
    persona_id: '51987654321', persona_nombre: 'Lenin Ramírez',
    numero_propio: NUMERO_PROPIO,
    texto: 'Me interesa la campaña de 3 meses. ¿Cuánto cuesta?',
    contexto_texto: null,
    respondida: false, ya_le_hablamos: true, pregunto: true, pregunto_precio: true,
    ventana_abierta: false, etapa_efectiva: 'cotizado',
    n: 3, referencia: '2026-08-20T09:15:00Z', ultimo_at: '2026-08-20T09:15:00Z', dias: 0, nivel: 0,
    no_leido: true,
    origen_anuncio: { fuente: 'anuncio', titulo: 'Diplomado en Inteligencia y Contrainteligencia' },
  },
  {
    clave: 'conv:whatsapp:51912345678:' + NUMERO_PROPIO,
    canal: 'whatsapp', tipo: 'mensaje',
    persona_id: '51912345678', persona_nombre: 'Alejandro García',
    numero_propio: NUMERO_PROPIO,
    texto: 'Sigo interesado, ¿tienen cupos?',
    contexto_texto: null,
    respondida: false, ya_le_hablamos: false, pregunto: true, pregunto_precio: false,
    ventana_abierta: false, etapa_efectiva: 'interesado',
    n: 2, referencia: '2026-08-19T08:12:00Z', ultimo_at: '2026-08-19T08:12:00Z', dias: 1, nivel: 3,
    no_leido: true,
  },
  {
    clave: 'conv:whatsapp:51999888777:' + NUMERO_PROPIO,
    canal: 'whatsapp', tipo: 'mensaje',
    persona_id: '51999888777', persona_nombre: 'María Castillo',
    numero_propio: NUMERO_PROPIO,
    texto: 'Hola María, el diplomado tiene un costo de S/ 3 200 en 6 cuotas. ¿Te mando el temario?',
    contexto_texto: null,
    respondida: true, ya_le_hablamos: true, pregunto: true, pregunto_precio: true,
    ventana_abierta: false, etapa_efectiva: 'cotizado',
    n: 2, referencia: '2026-08-20T10:47:00Z', ultimo_at: '2026-08-20T10:47:00Z', dias: 0, nivel: 3,
    no_leido: false,
  },
  {
    // Sin curso, sin `pregunto`: fila SIN chip, para ver cómo cae el preview
    // solo (pedido del 20-ago, comparando contra una captura real sin chip).
    clave: 'conv:whatsapp:51955512345:' + NUMERO_PROPIO,
    canal: 'whatsapp', tipo: 'mensaje',
    persona_id: '51955512345', persona_nombre: 'Juan Carlos Medina',
    numero_propio: NUMERO_PROPIO,
    texto: 'Estoy tomando unos entrenamientos en otra academia pero quería preguntarles por el diplomado igual',
    contexto_texto: null,
    respondida: false, ya_le_hablamos: false, pregunto: false, pregunto_precio: false,
    // Una conversación de hace 31 días NO puede tener la ventana de 24h abierta
    // (era el error del fixture, no del componente): con `true` acá aparecía un
    // pill "último día" que le sumaba una línea al bloque, corriendo el preview
    // un renglón más abajo de lo que se ve en producción para un caso así.
    ventana_abierta: false, etapa_efectiva: 'interesado',
    n: 8, referencia: '2026-07-21T09:00:00Z', ultimo_at: '2026-07-21T09:00:00Z', dias: 30, nivel: 5,
    no_leido: true,
  },
];

// ── Pipeline: cinco columnas con tarjetas de ejemplo ───────────────────────
const NOMBRES = [
  'José Baldemar Saavedra', 'Melissa Guisel Pizarro', 'Yorman Salas', 'Sandra Castañeda',
  'Jahuar Rodríguez', 'Alexander Vega', 'Luz Contreras', 'Miguel Ángel Torres',
  'Adrián Ortega', 'Juan Carlos Ríos', 'Pablo Hernández', 'Yusef Marín',
  'Paul Espinoza', 'Constanza Reyes', 'Romero Díaz', 'Rosario Flores',
];
const CURSOS = ['Inteligencia y Contrainteligencia', 'Gestión Pública', 'Ciberdefensa', 'Consultoría Política'];

const HORAS_BASE_COLUMNA = {
  interesado: 9, sin_respuesta: 48, contactado: 576, cotizado: 720, cierre: 552,
};
const HORAS_PASO_COLUMNA = {
  interesado: 13, sin_respuesta: 200, contactado: 24, cotizado: 24, cierre: 24,
};

function tarjeta(i, columna) {
  const nombre = NOMBRES[i % NOMBRES.length];
  const tel = `519${(51000000 + i * 137).toString().slice(0, 8)}`;
  const horas = (HORAS_BASE_COLUMNA[columna] ?? 6) + i * (HORAS_PASO_COLUMNA[columna] ?? 7);
  const ahora = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  // Cuánto lleva EN LA COLUMNA — a propósito distinto de `ultimo_at` (lo último
  // que pasó): si coinciden, `lecturaDeAntiguedad` calla el chip a propósito
  // (TarjetaEmbudo.tsx, «yaVisible»). En producción casi siempre difieren: entró
  // hace semanas, algo la tocó hace un par de días.
  const diasEnEtapa = { sin_respuesta: 21, contactado: 24, cotizado: 28, cierre: 23 }[columna];
  const etapaDesde =
    diasEnEtapa != null
      ? new Date(Date.now() - (diasEnEtapa + i * 2) * 24 * 3600 * 1000).toISOString()
      : undefined;
  const base = {
    clave: `conv:whatsapp:${tel}:${NUMERO_PROPIO}:${columna}`,
    canal: 'whatsapp',
    persona_id: tel, persona_nombre: nombre,
    numero_propio: NUMERO_PROPIO,
    texto: null, contexto_texto: null,
    ventana_abierta: true, n: 1 + (i % 4),
    // `referencia` es lo que lee `horasDesde()` para el "hace cuánto" de la
    // tarjeta (TarjetaEmbudo.tsx) — tiene que ser la MISMA fecha que ultimo_at,
    // no un id arbitrario.
    referencia: ahora,
    ultimo_at: ahora,
    etapa_desde: etapaDesde,
    dias: Math.floor(horas / 24), nivel: 3,
    etapa_efectiva: columna,
  };
  if (columna === 'interesado') {
    return {
      ...base,
      tipo: i % 3 === 0 ? 'mensaje' : 'lead',
      respondida: false, pregunto: true,
      canal: i % 3 === 0 ? 'whatsapp' : 'landing',
      lead_curso: CURSOS[i % CURSOS.length],
    };
  }
  if (columna === 'sin_respuesta') {
    return {
      ...base,
      tipo: 'mensaje',
      // Ya le escribiste y no volvió — la pelota está en su cancha (✓, no →).
      respondida: true, ya_le_hablamos: true, pregunto: false,
      // 150 de 187 en el desglose ya tienen precio mandado (i%5 !== 0 → 80%).
      pregunto_precio: i % 5 !== 0, precio_enviado: i % 5 !== 0,
    };
  }
  if (columna === 'contactado') {
    return { ...base, tipo: 'mensaje', respondida: true, ya_le_hablamos: true, pregunto: false, interes_curso: i % 2 === 0 ? CURSOS[i % CURSOS.length] : null };
  }
  if (columna === 'cotizado') {
    return { ...base, tipo: 'mensaje', respondida: true, ya_le_hablamos: true, pregunto: true, pregunto_precio: true, precio_enviado: true };
  }
  // cierre
  return {
    ...base, tipo: 'mensaje', respondida: true, ya_le_hablamos: true, pregunto: false,
    precio_enviado: true, cliente_nivel: i % 4 === 0 ? 'vip' : i % 3 === 0 ? 'recompro' : 'compro',
    cliente_compras: 1 + (i % 3),
  };
}

const TOTALES_COLUMNA = { interesado: 42, sin_respuesta: 187, contactado: 12, cotizado: 63, cierre: 6 };

// Estado mutable del bot — sin esto el anillo del header nunca reflejaría el
// clic: `/api/bot/estado` contestaría siempre el mismo modo fijo.
let modoBotActual = 'apagado';

// El detalle real por columna — sin esto «Te esperan» calla la bandeja
// (sin abrir/volvieron) y «Nunca contestaron»/«Saben el precio» callan sus
// chips de recorte («Con precio»/«Se callaron»): las dos cosas leen `desglose`,
// nunca el conteo de la cabecera.
const DESGLOSE = [
  // interesado (42): 4 escribiendo ahora + 31 nunca abiertas = 35 nuevas, 7 volvieron.
  { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: true, n: 4 },
  { etapa: 'interesado', yaLeHablamos: false, precio: false, viva: false, n: 31 },
  { etapa: 'interesado', yaLeHablamos: true, precio: false, viva: false, n: 7 },
  // sin_respuesta (187): 150 ya tienen precio mandado, 37 no.
  { etapa: 'sin_respuesta', yaLeHablamos: true, precio: true, viva: false, n: 150 },
  { etapa: 'sin_respuesta', yaLeHablamos: true, precio: false, viva: false, n: 37 },
  // cotizado (63): 50 se callaron después del precio, 13 siguen conversando.
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, seCallo: true, n: 50 },
  { etapa: 'cotizado', yaLeHablamos: true, precio: true, viva: false, seCallo: false, n: 13 },
];

function columnaServida(id) {
  const total = TOTALES_COLUMNA[id] ?? 8;
  const n = Math.min(total, 8);
  return {
    conversaciones: Array.from({ length: n }, (_, i) => tarjeta(i, id)),
    total,
    hayMas: total > n,
  };
}

function leerCuerpo(req) {
  return new Promise((resolve) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      if (!datos) return resolve({});
      try {
        resolve(JSON.parse(datos));
      } catch {
        resolve({});
      }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const enviar = (cuerpo, estado = 200) => {
      res.writeHead(estado, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      });
      res.end(JSON.stringify(cuerpo));
    };

    if (req.method === 'OPTIONS') return enviar({}, 204);

    let body = {};
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') body = await leerCuerpo(req);

    const p = url.pathname;
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const quien = idDeToken(token);

    // ── auth ──
    if (p === '/api/auth/login' && req.method === 'POST') {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!username) return enviar({ ok: false, message: 'usuario o contraseña incorrectos' }, 401);
      return enviar({ ok: true, token: firmarSesion(username), vendedora: { id: username, nombre: username } });
    }
    if (p === '/api/auth/yo' && req.method === 'GET') {
      if (!quien) return enviar({ ok: false, message: 'sesión inválida, volvé a ingresar' }, 401);
      return enviar({ ok: true, vendedora: { id: quien, nombre: quien }, cerberus: true });
    }
    if (!quien) return enviar({ ok: false, message: 'sesión inválida, volvé a ingresar' }, 401);

    // ── whatsapp: sesión de la línea ──
    if (p === '/api/whatsapp/sesion' && req.method === 'GET') {
      return enviar({ estado: 'conectado', telefono: NUMERO_PROPIO, transporte: 'whatsmeow', puedeEditar: true });
    }

    // ── las líneas vivas (para SelectorLinea, en la fila de los tabs) ──
    if (p === '/api/whatsapp/lineas' && req.method === 'GET') {
      return enviar({
        lineas: [
          { numero: NUMERO_PROPIO, etiqueta: 'Ventas Meta', estado: 'conectado' },
          { numero: '51963139984', etiqueta: 'Manuel', estado: 'conectado' },
        ],
      });
    }

    // ── el catálogo de categorías (los chips con punto de color, al final de la pista) ──
    if (p === '/api/categorias' && req.method === 'GET') {
      return enviar({
        categorias: [
          { id: 1, nombre: 'interesada', color: 'azul', esFavorito: true, orden: 0, conteo: 68 },
          { id: 2, nombre: 'precio', color: 'rojo', esFavorito: true, orden: 1, conteo: 24 },
          { id: 3, nombre: 'reclamo', color: 'rojo', esFavorito: true, orden: 2, conteo: 3 },
        ],
      });
    }

    // ── frescura de datos (barra superior) ──
    if (p === '/api/interactions/frescura' && req.method === 'GET') {
      return enviar({
        ultimoDato: new Date().toISOString(),
        ultimaIngesta: new Date().toISOString(),
        horasDesdeIngesta: 0,
        total: cola.length,
        fresca: true,
      });
    }

    // ── el bot (barra superior) ──
    if (p === '/api/bot/estado' && req.method === 'GET') {
      return enviar({
        numero: NUMERO_PROPIO,
        habilitada: true,
        modoEfectivo: modoBotActual,
        modoDeLaBase: modoBotActual,
        modoDelEntorno: 'apagado',
        frenado: false,
        frenadoMotivo: null,
        modos: [
          { modo: 'apagado', descripcion: 'No piensa ni manda nada.' },
          { modo: 'sombra', descripcion: 'Piensa y guarda. No habla.' },
          { modo: 'automatico', descripcion: 'Piensa y habla solo.' },
        ],
      });
    }
    if (p === '/api/bot/modo' && req.method === 'PUT') {
      if (['apagado', 'sombra', 'automatico'].includes(body.modo)) modoBotActual = body.modo;
      return enviar({ ok: true });
    }

    // ── auto-respuesta fuera de horario (barra superior) ──
    if (p === '/api/autorespuesta/modo' && req.method === 'GET') {
      return enviar({ modo: 'supervisada', encendida: true });
    }

    // ── la cola ──
    if (p === '/api/conversaciones' && req.method === 'GET') {
      // El front pide `?intencion=pregunto-precio|te-escribieron|puedo-escribirle`
      // (dominio/cola.ts, `parametrosDeCola`) — sin filtrar acá, el chip decía un
      // número y la lista de al lado mostraba otro (mismo síntoma que el badge
      // de "recordatorios" del agenda: un mock que no lee el filtro miente).
      const intencion = url.searchParams.get('intencion');
      const PREDICADO = {
        'pregunto-precio': (c) => c.pregunto_precio === true,
        'te-escribieron': (c) => c.respondida === false,
        'puedo-escribirle': (c) => c.ventana_abierta === true,
      };
      const filtradas = intencion && PREDICADO[intencion] ? cola.filter(PREDICADO[intencion]) : cola;
      return enviar({
        conversaciones: filtradas,
        total: filtradas.length,
        hayMas: false,
        conteos: { interesado: 1, cotizado: 2 },
        conteosFiltro: {
          preguntoPrecio: cola.filter(PREDICADO['pregunto-precio']).length,
          teEscribieron: cola.filter(PREDICADO['te-escribieron']).length,
          puedoEscribirle: cola.filter(PREDICADO['puedo-escribirle']).length,
          mios: cola.length,
        },
      });
    }
    // ── foto de perfil: nunca hay una real acá, que caiga a iniciales ──
    if (p.startsWith('/api/whatsapp/foto/') && req.method === 'GET') {
      return enviar({ ok: false, message: 'sin foto' }, 404);
    }

    if (p === '/api/conversaciones/tablero' && req.method === 'GET') {
      const ids = (url.searchParams.get('columnas') ?? '')
        .split(',')
        .map((c) => c.split(':')[0])
        .filter(Boolean);
      const columnas = {};
      const conteos = {};
      for (const id of ids) {
        columnas[id] = columnaServida(id);
        conteos[id] = TOTALES_COLUMNA[id] ?? 0;
      }
      return enviar({ columnas, conteos, desglose: DESGLOSE, colaRecortada: false, conLineaPropia: false });
    }

    // ── el hilo ──
    let m = p.match(/^\/api\/whatsapp\/conversacion\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const tel = m[1];
      const hilo = hilos[tel] ?? { telefono: tel, mensajes: [], origen: null };
      return enviar(hilo);
    }
    m = p.match(/^\/api\/whatsapp\/leido\/([^/]+)$/);
    if (m && req.method === 'POST') return enviar({ ok: true, cursor: true });

    if (p === '/api/whatsapp/enviar' && req.method === 'POST') {
      const tel = body.telefono;
      const hilo = hilos[tel];
      if (hilo) {
        hilo.mensajes.push({
          id: hilo.mensajes.length + 100,
          direccion: 'saliente',
          autor: quien,
          texto: body.texto ?? '',
          occurred_at: new Date().toISOString(),
          external_id: `wa:mock-${Date.now()}`,
          entrega: 'enviado',
        });
      }
      return enviar({ ok: true, idExterno: `mock-${Date.now()}` });
    }

    // ── panel derecho: degrada a vacío, nunca a error feo ──
    if (p === '/api/hechos' && req.method === 'GET') {
      return enviar({ momento: 'en-conversacion', hechos: [], editable: false, origen: 'defecto' });
    }
    if (p === '/api/senales' && req.method === 'GET') return enviar({});
    if (p === '/api/gestiones/intereses' && req.method === 'GET') return enviar({ intereses: [], derivados: [] });
    if (p === '/api/eventos' && req.method === 'GET') return enviar({ eventos: [] });
    if (p === '/api/agenda' && req.method === 'GET') return enviar({ recordatorios: [] });
    if (p === '/api/dashboard' && req.method === 'GET') {
      const dias14 = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (13 - i));
        return d.toISOString().slice(0, 10);
      });
      const pseudo = (dia, sal) => {
        // Determinístico (no random) para que no cambie entre pedidos.
        const n = [...dia].reduce((a, c) => a + c.charCodeAt(0), 0) % sal;
        return n;
      };
      return enviar({
        chats: [],
        formularios: [],
        etapas: {},
        etiquetas: {},
        porVendedora: [],
        automaticos: null,
        embudo: {},
        cursos: [],
        series: {
          leads_dia: dias14.map((dia) => ({
            dia,
            chats: pseudo(dia, 6),
            comentarios: pseudo(dia + 'c', 3),
            formularios: pseudo(dia + 'f', 2),
          })),
          envios_dia: dias14.map((dia) => ({ dia, n: pseudo(dia + 'e', 8) })),
          ventas_dia: dias14.map((dia) => ({ dia, n: pseudo(dia + 'v', 2) })),
        },
        supervisor: false,
        soloMisAsignadas: true,
        sinSupervisores: false,
      });
    }
    if (p === '/api/padron/facetas' && req.method === 'GET') return enviar({ facetas: {} });
    if (p === '/api/padron' && req.method === 'GET') return enviar({ contactos: [], total: 0, hayMas: false });

    // ── campañas — antes faltaban del todo y el catch-all devolvía `{}`, que
    // rompía cada pantalla con «Cannot read properties of undefined» al leer
    // `data.corridas`/`data.plantillas`/etc. Acá sí importa la FORMA exacta. ──
    if (p === '/api/campana/corridas' && req.method === 'GET') {
      return enviar({
        corridas: [
          {
            pieza: 'foro_estado_5_ago',
            empezo: '2026-08-05T09:00:00Z',
            termino: '2026-08-06T18:00:00Z',
            enCurso: false,
            enviados: 1004,
            fallidos: 12,
            fallosPorMotivo: [{ motivo: '131047 — ventana de 24h', n: 12 }],
            respondieron: { n: 26, de: 1004, pct: 2.6 },
            autoRespuestas: 0,
            medianaRespuestaMin: 41,
            enLaPrimeraHora: 9,
            sinAtender: { n: 3, de: 26, pct: 11.5 },
            masViejaSinAtenderMin: 187,
            porDuena: [
              { duena: 'Luz', enviados: 0, respondieron: 8, sinAtender: 1 },
              { duena: 'ventas10@grupogoberna.com', enviados: 0, respondieron: 6, sinAtender: 0 },
            ],
            aviso: null,
          },
        ],
      });
    }
    if (p.startsWith('/api/campana/corridas/') && p.endsWith('/esperando') && req.method === 'GET') {
      return enviar({ esperando: [] });
    }
    if (p.startsWith('/api/campana/corridas/') && p.endsWith('/frenar') && req.method === 'POST') {
      return enviar({ frenada: true });
    }
    if (p === '/api/campana/vivas' && req.method === 'GET') return enviar({ vivas: [] });
    if (p === '/api/campana/plantillas' && req.method === 'GET') {
      return enviar({
        plantillas: [
          {
            nombre: 'promo_3x1_cursos',
            idioma: 'es',
            estado: 'APPROVED',
            categoria: 'MARKETING',
            cuerpo: 'Hola {{1}}, tenemos una promo 3x1 en diplomados este mes. ¿Te cuento?',
            headerDeImagen: false,
            enviable: true,
            lectura: { titulo: 'Aprobada', detalle: null, tono: 'bien', enviable: true },
            calidad: { texto: 'Calidad alta', tono: 'bien' },
            id: 'tpl_1',
          },
        ],
        resumen: { total: 1, enviables: 1, conProblema: 0 },
      });
    }
    if (p === '/api/campana/plantillas/revisar' && req.method === 'POST') {
      return enviar({ reparos: [], nombreSugerido: 'nueva_plantilla' });
    }
    if (p === '/api/campana/plantillas/envios' && req.method === 'GET') {
      return enviar({ dias: 30, lineaDeBase: null, plantillas: [] });
    }
    if (p === '/api/campana/listas' && req.method === 'GET') return enviar({ listas: [] });
    if (p === '/api/campana/cuantos' && req.method === 'POST') return enviar({ cuantos: null });
    if (p === '/api/campana/historial' && req.method === 'GET') {
      return enviar({
        historial: [
          {
            id: 1,
            piezaRef: 'promo_3x1_cursos',
            autorizadaPor: 'ventas10@grupogoberna.com',
            autorizadaEn: '2026-08-19T15:00:00Z',
            totalPrevisto: 420,
            estado: 'terminada',
            frenadaPor: null,
            motivoDelFreno: null,
          },
          {
            id: 2,
            piezaRef: 'foro_estado_5_ago',
            autorizadaPor: 'Luz',
            autorizadaEn: '2026-08-05T09:00:00Z',
            totalPrevisto: 1004,
            estado: 'frenada',
            frenadaPor: null,
            motivoDelFreno: 'Meta retuvo el 40% por calidad de plantilla',
          },
        ],
      });
    }

    // ── catch-all: nunca 501, para que ninguna pantalla se rompa ──
    if (req.method === 'GET') return enviar({});
    return enviar({ ok: true });
  })
  .listen(PUERTO, () => console.log(`mock de Mensajes en :${PUERTO} (login: cualquier usuario/contraseña)`));
