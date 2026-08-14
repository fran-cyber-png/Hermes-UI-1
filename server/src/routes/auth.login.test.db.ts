import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

/**
 * LA COSTURA DE `/api/auth/login` — el cableado, no la regla.
 *
 * La cascada tiene sus tests puros en `auth/loginCascada.test.ts`, con todas las
 * ramas y sin una sola línea de red. Este archivo existe porque **el defecto que
 * esos tests no pueden ver vive en la costura**: que el `estado` llegue al
 * `res.status()`, que el `type` sobreviva al JSON, que el `resolverLogin` de la
 * ruta sea el de verdad y no una versión con las patas cambiadas. Es la misma
 * lección de `?etapa=sin_respuesta`, que respondía 400 con quince tests con base
 * en verde porque todos llamaban al seam directo y se salteaban la ruta.
 *
 * Los dos sistemas de afuera son stubs locales:
 *   - Cerberus, apuntado con `CERBERUS_BASE_URL` **antes** de importar la ruta
 *     (ese módulo lee la env al cargarse, así que el import va dinámico y abajo).
 *   - Centurión, apuntado con `CENTURION_URL`, que además CUENTA las consultas:
 *     es la única forma de afirmar que con Cerberus caído no se le pregunta nada.
 *
 * ⚠️ Como `routes/auth.ts` importa el singleton `db`, esto es `.test.db.ts` y
 * necesita `DATABASE_URL` para siquiera cargar. Igual que su hermano
 * `auth.centurion.test.db.ts`, **acá no se prueba el camino que consulta la
 * base** (la guarda de línea, que tiene sus tests en `auth/sesionCenturion.test.ts`
 * y en `numeros/repositorio.test.db.ts`): todos los casos de este archivo
 * resuelven antes de esa consulta.
 */

const SECRETO = 'secreto-de-prueba-del-login-directo';
const CLAVE = 'la-clave-que-nunca-se-loguea';

/**
 * Qué le pasa hoy a Cerberus.
 *
 *   `rechaza` ...... anda y dice que la clave está mal (200 con el form de nuevo)
 *   `caido` ........ contesta, pero sin el formulario: ni siquiera hay handshake
 *   `502-en-post` .. 🔴 **el que muerde**: el GET anda y el POST revienta. Es la
 *                    forma que tiene una caída de verdad —el MySQL de Cerberus se
 *                    cae, Django tira 500 y nginx 502— y no la que este stub
 *                    modelaba, que era la única que `autenticarEnCerberus` sabía
 *                    marcar `caido`. Sin eso la cascada lee «clave incorrecta» y
 *                    le manda usuario y clave de la vendedora a Centurión.
 */
let modoCerberus: 'rechaza' | 'caido' | '502-en-post' = 'rechaza';
/** Qué contesta Centurión, y cuántas veces se le preguntó. */
let modoCenturion: 'rechaza' | 'acepta' = 'rechaza';
let consultasACenturion = 0;

function levantar(manejar: Parameters<typeof createServer>[1]): Promise<{ server: Server; base: string }> {
  const server = createServer(manejar);
  return once(server.listen(0, '127.0.0.1'), 'listening').then(() => {
    const { port } = server.address() as AddressInfo;
    return { server, base: `http://127.0.0.1:${port}` };
  });
}

// ── Stub de Cerberus: el baile CSRF de Django, en miniatura ─────────────────
const cerberus = await levantar((req, res) => {
  if (modoCerberus === 'caido') {
    // Contesta, pero sin cookie ni formulario: es el caso que `autenticarEnCerberus`
    // marca `caido` sin que haya un error de red de por medio.
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html>mantenimiento</html>');
    return;
  }
  if (req.method === 'GET') {
    res
      .writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'csrftoken=abc; Path=/' })
      .end('<form><input name="csrfmiddlewaretoken" value="xyz"></form>');
    return;
  }
  if (modoCerberus === '502-en-post') {
    // El GET de arriba entregó cookie y token: el handshake se ve impecable. Lo
    // que revienta es el POST, que es donde vive el juicio sobre la clave.
    res.writeHead(502, { 'content-type': 'text/html' }).end('<html>Bad Gateway</html>');
    return;
  }
  // POST: Django re-renderiza el formulario con 200 cuando la clave está mal.
  res.writeHead(200, { 'content-type': 'text/html' }).end('<form>credenciales incorrectas</form>');
});

// ── Stub de Centurión ───────────────────────────────────────────────────────
const centurion = await levantar((_req, res) => {
  consultasACenturion += 1;
  if (modoCenturion === 'acepta') {
    // Un token de handoff de verdad, firmado con el mismo secreto: así el canje
    // llega hasta la guarda de línea y no se queda en «el token no verifica».
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, token: tokenDeHandoff() }));
    return;
  }
  res
    .writeHead(401, { 'content-type': 'application/json' })
    .end(JSON.stringify({ ok: false, code: 'credenciales_invalidas' }));
});

function tokenDeHandoff(): string {
  const encabezado = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(
    JSON.stringify({ sub: 'betto.romero', aud: 'hermes', exp: Math.floor(Date.now() / 1000) + 120 }),
  ).toString('base64url');
  const firma = createHmac('sha256', SECRETO).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

// El módulo de Cerberus lee `CERBERUS_BASE_URL` al cargarse: la env va ANTES
// del import, y por eso el import es dinámico.
process.env.CERBERUS_BASE_URL = cerberus.base;
const { authRouter } = await import('./auth.js');

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

async function login(body: unknown): Promise<Respuesta> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: resp.status, json: (await resp.json().catch(() => null)) as Record<string, unknown> | null };
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function prenderCenturion(): void {
  process.env.CENTURION_URL = centurion.base;
  process.env.CENTURION_SSO_SECRET = SECRETO;
}

function apagarCenturion(): void {
  delete process.env.CENTURION_URL;
  delete process.env.CENTURION_SSO_SECRET;
}

test('sin usuario o sin clave: 400', async () => {
  const r = await login({ username: '', password: CLAVE });
  assert.equal(r.status, 400);
});

test('Cerberus rechaza y el login directo está apagado: 401 con el mensaje de siempre', async () => {
  modoCerberus = 'rechaza';
  apagarCenturion();
  consultasACenturion = 0;

  const r = await login({ username: 'luz', password: CLAVE });

  assert.equal(r.status, 401);
  assert.equal(r.json?.message, 'usuario o contraseña incorrectos');
  assert.equal(r.json?.type, undefined, 'un 401 de siempre no estrena campos');
  assert.equal(consultasACenturion, 0);
});

test('🔴 Cerberus CAÍDO: 503 tipado, y a Centurión no se le pregunta nada', async () => {
  modoCerberus = 'caido';
  prenderCenturion();
  modoCenturion = 'acepta';
  consultasACenturion = 0;

  const r = await login({ username: 'luz', password: CLAVE });

  assert.equal(r.status, 503);
  assert.equal(r.json?.type, 'cerberus_caido', 'el `type` tiene que sobrevivir hasta el JSON: el front ramifica con él');
  assert.equal(consultasACenturion, 0, 'una caída de Cerberus no puede mandar la clave de una vendedora a otro sistema');
});

test('🔴 el GET de Cerberus anda y el POST tira 502: 503 tipado, y a Centurión no se le pregunta nada', async () => {
  // El escenario que el stub de arriba no modelaba y que es el MÁS probable de
  // una caída real. Antes del 13-ago-2026 esto respondía **401** y de paso le
  // mandaba la contraseña de la vendedora a Centurión.
  modoCerberus = '502-en-post';
  prenderCenturion();
  modoCenturion = 'acepta';
  consultasACenturion = 0;

  const r = await login({ username: 'luz', password: CLAVE });

  assert.equal(r.status, 503, 'un 502 de nginx sobre el POST de login no es «usuario o contraseña incorrectos»');
  assert.equal(r.json?.type, 'cerberus_caido');
  assert.equal(consultasACenturion, 0, 'una caída de Cerberus no puede mandar la clave de una vendedora a otro sistema');
  assert.ok(!JSON.stringify(r.json).includes(CLAVE));
});

test('Cerberus rechaza y Centurión también: 401 genérico, sin pistas de qué sistema rechazó', async () => {
  modoCerberus = 'rechaza';
  prenderCenturion();
  modoCenturion = 'rechaza';
  consultasACenturion = 0;

  const r = await login({ username: 'betto.romero', password: CLAVE });

  assert.equal(r.status, 401);
  assert.equal(r.json?.message, 'usuario o contraseña incorrectos');
  assert.equal(consultasACenturion, 1, 'con Cerberus rechazando SÍ se consulta');
  assert.ok(!JSON.stringify(r.json).includes('centurion'), 'la respuesta no publica que hay un segundo sistema');
  assert.ok(!JSON.stringify(r.json).includes(CLAVE));
});

test('la contraseña no vuelve en ninguna respuesta de la ruta', async () => {
  for (const [modoC, modoK] of [
    ['rechaza', 'rechaza'],
    ['caido', 'rechaza'],
    ['502-en-post', 'rechaza'],
  ] as const) {
    modoCerberus = modoC;
    modoCenturion = modoK;
    prenderCenturion();
    const r = await login({ username: 'luz', password: CLAVE });
    assert.ok(!JSON.stringify(r.json).includes(CLAVE), `la clave volvió en la respuesta (${modoC}/${modoK})`);
  }
});

test.after(() => {
  apagarCenturion();
  cerberus.server.close();
  centurion.server.close();
});
