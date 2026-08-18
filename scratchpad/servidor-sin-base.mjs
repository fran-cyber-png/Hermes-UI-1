import http from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * Servidor mock SIN base de datos y SIN Cerberus, solo para correr Hermes en
 * local y entrar a la Libreta sin depender de Postgres ni del login real.
 *
 * Login: acepta CUALQUIER usuario/contraseña (con usuario no vacío). Todo lo
 * demás (notas, espacios) vive en memoria del proceso: se pierde al reiniciar.
 *
 * Escucha en :4100, el mismo puerto que `VITE_API_URL` por default
 * (`src/config.ts`), así que alcanza con `npm run dev` sin tocar ningún .env.
 */

const PUERTO = 4202;
const DURACION_MS = 14 * 24 * 60 * 60 * 1000;

// ── "sesión" ──────────────────────────────────────────────────────────────
const usuariosConocidos = new Set();

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

// ── notas ─────────────────────────────────────────────────────────────────
let proximoIdNota = 1;
const notas = [];

function textoDeDoc(doc) {
  if (!Array.isArray(doc)) return '';
  return doc
    .map((bloque) =>
      Array.isArray(bloque?.content)
        ? bloque.content.map((n) => (typeof n?.text === 'string' ? n.text : '')).join('')
        : '',
    )
    .join('\n');
}

function esVisible(nota, vendedoraId, espaciosDe) {
  if (nota.espacioId === null) return nota.vendedoraId === vendedoraId;
  return espaciosDe.has(nota.espacioId);
}

function conOrigen(nota) {
  return { ...nota, origen: 'nota' };
}

// ── espacios ──────────────────────────────────────────────────────────────
let proximoIdEspacio = 1;
const espacios = [];

function espaciosDeVendedora(vendedoraId) {
  const propios = new Set(
    espacios
      .filter((e) => !e.archivado && (e.creadaPor === vendedoraId || e.miembros.includes(vendedoraId)))
      .map((e) => e.id),
  );
  return propios;
}

// ── server ────────────────────────────────────────────────────────────────
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      if (!datos) return resolve({});
      try {
        resolve(JSON.parse(datos));
      } catch {
        reject(new Error('json inválido'));
      }
    });
    req.on('error', reject);
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
        'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      });
      res.end(JSON.stringify(cuerpo));
    };

    if (req.method === 'OPTIONS') return enviar({}, 204);

    let body = {};
    if (req.method === 'POST' || req.method === 'PATCH') {
      try {
        body = await leerCuerpo(req);
      } catch {
        return enviar({ ok: false, message: 'json inválido' }, 400);
      }
    }

    const p = url.pathname;
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const vendedoraId = idDeToken(token);

    function requiereSesion() {
      if (!vendedoraId) {
        enviar({ ok: false, message: 'sesión inválida o expirada, volvé a ingresar' }, 401);
        return null;
      }
      return vendedoraId;
    }

    // ── auth ──
    if (p === '/api/auth/login' && req.method === 'POST') {
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      if (!username) return enviar({ ok: false, message: 'usuario o contraseña incorrectos' }, 401);
      usuariosConocidos.add(username);
      return enviar({ ok: true, token: firmarSesion(username), vendedora: { id: username, nombre: username } });
    }
    if (p === '/api/auth/yo' && req.method === 'GET') {
      const quien = requiereSesion();
      if (!quien) return;
      return enviar({ ok: true, vendedora: { id: quien, nombre: quien }, cerberus: false });
    }

    // Todo lo de acá para abajo pide sesión.
    const quien = requiereSesion();
    if (!quien) return;

    // ── espacios ──
    if (p === '/api/espacios/padron' && req.method === 'GET') {
      return enviar({ personas: [...usuariosConocidos] });
    }
    if (p === '/api/espacios' && req.method === 'GET') {
      const ids = espaciosDeVendedora(quien);
      return enviar({ espacios: espacios.filter((e) => ids.has(e.id)) });
    }
    if (p === '/api/espacios' && req.method === 'POST') {
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
      if (!nombre) return enviar({ ok: false, message: 'el espacio necesita un nombre' }, 400);
      const miembros = [...new Set([quien, ...(Array.isArray(body.miembros) ? body.miembros : [])])];
      miembros.forEach((m) => usuariosConocidos.add(m));
      const espacio = { id: proximoIdEspacio++, nombre, creadaPor: quien, creadoAt: new Date().toISOString(), miembros, archivado: false };
      espacios.push(espacio);
      return enviar({ ok: true, espacio });
    }
    let m = p.match(/^\/api\/espacios\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const espacio = espacios.find((e) => e.id === Number(m[1]));
      if (!espacio) return enviar({ ok: false, message: 'ese espacio no existe' }, 404);
      const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
      if (nombre) espacio.nombre = nombre;
      return enviar({ ok: true, espacio });
    }
    m = p.match(/^\/api\/espacios\/(\d+)\/archivar$/);
    if (m && req.method === 'PATCH') {
      const espacio = espacios.find((e) => e.id === Number(m[1]));
      if (!espacio) return enviar({ ok: false, message: 'ese espacio no existe' }, 404);
      espacio.archivado = true;
      return enviar({ ok: true });
    }
    m = p.match(/^\/api\/espacios\/(\d+)\/miembros$/);
    if (m && req.method === 'POST') {
      const espacio = espacios.find((e) => e.id === Number(m[1]));
      if (!espacio) return enviar({ ok: false, message: 'ese espacio no existe' }, 404);
      const nuevo = typeof body.vendedoraId === 'string' ? body.vendedoraId.trim() : '';
      if (!nuevo) return enviar({ ok: false, message: `no conozco a ${nuevo || '(nadie)'}` }, 409);
      if (!espacio.miembros.includes(nuevo)) espacio.miembros.push(nuevo);
      usuariosConocidos.add(nuevo);
      return enviar({ ok: true, espacio });
    }
    m = p.match(/^\/api\/espacios\/(\d+)\/miembros\/([^/]+)$/);
    if (m && req.method === 'DELETE') {
      const espacio = espacios.find((e) => e.id === Number(m[1]));
      if (!espacio) return enviar({ ok: false, message: 'ese espacio no existe' }, 404);
      const saliente = decodeURIComponent(m[2]);
      espacio.miembros = espacio.miembros.filter((v) => v !== saliente);
      return enviar({ ok: true, espacio });
    }

    // ── notas ──
    if (p === '/api/notas' && req.method === 'GET') {
      const ids = espaciosDeVendedora(quien);
      const q = url.searchParams.get('q');
      if (q && q.trim()) {
        const termino = q.trim().toLowerCase();
        const filas = notas.filter((n) => !n.archivadoAt && esVisible(n, quien, ids) && n.texto.toLowerCase().includes(termino));
        return enviar({ notas: filas.map(conOrigen) });
      }
      const clave = url.searchParams.get('clave')?.trim();
      if (!clave) return enviar({ ok: false, message: 'falta clave (o q para buscar)' }, 400);
      const espacioParam = url.searchParams.get('espacio');
      const espacioId = espacioParam ? Number(espacioParam) : null;
      const filas = notas.filter(
        (n) => !n.archivadoAt && n.clave === clave && (espacioId === null ? n.espacioId === null && n.vendedoraId === quien : n.espacioId === espacioId),
      );
      return enviar({ notas: filas.map(conOrigen) });
    }
    if (p === '/api/notas' && req.method === 'POST') {
      const clave = typeof body.clave === 'string' ? body.clave.trim() : '';
      if (!clave) return enviar({ ok: false, message: 'falta la clave' }, 400);
      const espacioId = body.espacioId ?? null;
      const doc = body.doc ?? null;
      const texto = doc ? textoDeDoc(doc) : typeof body.texto === 'string' ? body.texto : '';
      const ahora = new Date().toISOString();
      const nota = {
        id: proximoIdNota++,
        clave,
        vendedoraId: quien,
        texto,
        doc,
        fijada: false,
        creadoAt: ahora,
        editadoAt: null,
        archivadoAt: null,
        espacioId,
        token: null,
        alcance: null,
        permiso: null,
        venceAt: null,
        ultimoAccesoAt: null,
      };
      notas.push(nota);
      return enviar({ ok: true, nota: conOrigen(nota) });
    }
    m = p.match(/^\/api\/notas\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      if (nota.espacioId === null && nota.vendedoraId !== quien) return enviar({ ok: false, message: 'solo la autora puede editar esta nota' }, 403);
      if (body.doc !== undefined) {
        nota.doc = body.doc;
        nota.texto = textoDeDoc(body.doc);
      } else if (typeof body.texto === 'string') {
        nota.texto = body.texto;
      }
      if (typeof body.fijada === 'boolean') nota.fijada = body.fijada;
      nota.editadoAt = new Date().toISOString();
      return enviar({ ok: true, nota: conOrigen(nota) });
    }
    m = p.match(/^\/api\/notas\/(\d+)\/mover$/);
    if (m && req.method === 'PATCH') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      nota.espacioId = body.espacioId ?? null;
      return enviar({ ok: true, nota: conOrigen(nota) });
    }
    m = p.match(/^\/api\/notas\/(\d+)\/archivar$/);
    if (m && req.method === 'PATCH') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      nota.archivadoAt = new Date().toISOString();
      return enviar({ ok: true, nota: conOrigen(nota) });
    }
    m = p.match(/^\/api\/notas\/(\d+)\/desarchivar$/);
    if (m && req.method === 'PATCH') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      nota.archivadoAt = null;
      return enviar({ ok: true, nota: conOrigen(nota) });
    }
    m = p.match(/^\/api\/notas\/(\d+)\/link$/);
    if (m && req.method === 'POST') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      nota.token = nota.token ?? randomBytes(16).toString('hex');
      nota.alcance = body.alcance ?? 'goberna';
      nota.permiso = body.permiso ?? 'ver';
      nota.venceAt = body.venceAt ?? null;
      return enviar({ ok: true, token: nota.token });
    }
    if (m && req.method === 'DELETE') {
      const nota = notas.find((n) => n.id === Number(m[1]));
      if (!nota) return enviar({ ok: false, message: 'la nota no existe' }, 404);
      nota.token = null;
      nota.alcance = null;
      nota.permiso = null;
      return enviar({ ok: true, token: null });
    }

    return enviar({ ok: false, message: 'no implementado en el mock sin base' }, 501);
  })
  .listen(PUERTO, () => console.log(`servidor sin base en :${PUERTO} (login: cualquier usuario/contraseña)`));
