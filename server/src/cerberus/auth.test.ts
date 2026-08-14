import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * QUÉ CONTESTA CERBERUS Y QUÉ SIGNIFICA — y sobre todo, **cuándo `caido` tiene
 * que estar prendido**.
 *
 * `caido` parece un detalle cosmético de este módulo (el route contesta 503 en
 * vez de 401) y desde `auth/loginCascada.ts` es otra cosa: es el candado que
 * decide si la contraseña de una vendedora de la Escuela sale hacia Centurión.
 * Con `caido` la cascada corta; sin `caido` lee un rechazo de la persona y sigue.
 *
 * El caso que este archivo existe para fijar: **el GET anda y el POST contesta
 * 500/502**. Es el escenario más probable de una caída real —el MySQL de
 * Cerberus se cae y Django tira 500 en el POST, mientras la página de login
 * sigue sirviéndose— y hasta el 13-ago-2026 salía por la rama de «usuario o
 * contraseña incorrectos», sin `caido`.
 *
 * El stub es un Django en miniatura: el mismo baile CSRF de `autenticarEnCerberus`.
 * `CERBERUS_BASE_URL` se lee al CARGAR el módulo, así que la env va antes y el
 * import es dinámico.
 */

/** Qué hace hoy el stub con el POST de credenciales. El GET siempre entrega el form. */
type ModoPost =
  | { clase: 'rechaza' }
  | { clase: 'acepta' }
  | { clase: 'estado'; status: number };

let modoPost: ModoPost = { clase: 'rechaza' };

const server: Server = createServer((req, res) => {
  if (req.method === 'GET') {
    res
      .writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'csrftoken=abc; Path=/' })
      .end('<form><input name="csrfmiddlewaretoken" value="xyz"></form>');
    return;
  }
  if (modoPost.clase === 'acepta') {
    res
      .writeHead(302, { location: '/panel/', 'set-cookie': ['sessionid=sid-de-luz; Path=/', 'csrftoken=rotado; Path=/'] })
      .end();
    return;
  }
  if (modoPost.clase === 'estado') {
    res.writeHead(modoPost.status, { 'content-type': 'text/html' }).end('<html>ups</html>');
    return;
  }
  // Django re-renderiza el formulario con 200 cuando la clave está mal.
  res.writeHead(200, { 'content-type': 'text/html' }).end('<form>credenciales incorrectas</form>');
});

await once(server.listen(0, '127.0.0.1'), 'listening');
const { port } = server.address() as AddressInfo;
process.env.CERBERUS_BASE_URL = `http://127.0.0.1:${port}`;

const { autenticarEnCerberus } = await import('./auth.js');

const USUARIO = 'luz';
const CLAVE = 'la-clave-que-nunca-se-loguea';

/** Corre algo con la consola capturada: este módulo loguea, y el log también se audita. */
async function conConsolaCapturada<T>(fn: () => Promise<T>): Promise<{ valor: T; consola: string }> {
  const originales = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  const escrito: string[] = [];
  const anotar = (...args: unknown[]) => {
    for (const a of args) escrito.push(typeof a === 'string' ? a : String(a));
  };
  console.error = anotar;
  console.warn = anotar;
  console.log = anotar;
  console.info = anotar;
  try {
    const valor = await fn();
    return { valor, consola: escrito.join(' | ') };
  } finally {
    Object.assign(console, originales);
  }
}

// ── El camino de todos los días, que este frente no puede tocar ──────────────

test('clave correcta: entra, con la sesión de Cerberus que después registra la venta', async () => {
  modoPost = { clase: 'acepta' };
  const r = await autenticarEnCerberus(USUARIO, CLAVE);

  assert.equal(r.ok, true);
  assert.deepEqual(r.ok === true && r.vendedora, { id: USUARIO, nombre: USUARIO });
  assert.equal(r.ok === true && r.sesion.sessionid, 'sid-de-luz');
  assert.equal(r.ok === true && r.sesion.csrftoken, 'rotado', 'Django rota el csrftoken al loguear');
});

test('clave incorrecta: rechazo SIN `caido` — la cascada tiene que poder seguir', async () => {
  modoPost = { clase: 'rechaza' };
  const r = await autenticarEnCerberus(USUARIO, CLAVE);

  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.motivo, 'usuario o contraseña incorrectos');
  assert.equal(r.ok === false && r.caido, undefined, 'un 200 con el form de nuevo SÍ es un juicio sobre la clave');
});

// ── 🔴 El agujero ───────────────────────────────────────────────────────────

test('🔴 el GET anda y el POST contesta 5xx: eso es CAÍDO, no una clave mala', async () => {
  // Los tres que se ven en una caída real: 500 de Django (el MySQL se cayó),
  // 502 y 504 de nginx delante.
  for (const status of [500, 502, 503, 504]) {
    modoPost = { clase: 'estado', status };
    const { valor, consola } = await conConsolaCapturada(() => autenticarEnCerberus(USUARIO, CLAVE));

    assert.equal(valor.ok, false);
    assert.equal(
      valor.ok === false && valor.caido,
      true,
      `con ${status} la cascada mandaría la contraseña de la vendedora a Centurión`,
    );
    assert.equal(valor.ok === false && valor.motivo, 'Cerberus no responde en este momento.');
    assert.match(consola, new RegExp(String(status)), 'el 503 que ve la persona no explica nada: el log tiene que hacerlo');
    assert.ok(!consola.includes(CLAVE), 'la contraseña no puede aparecer en el log');
  }
});

test('🔴 408 y 429 tampoco son un juicio sobre la clave', async () => {
  for (const status of [408, 429]) {
    modoPost = { clase: 'estado', status };
    const { valor } = await conConsolaCapturada(() => autenticarEnCerberus(USUARIO, CLAVE));
    assert.equal(valor.ok === false && valor.caido, true, `${status} se leyó como clave incorrecta`);
  }
});

test('un 403 (CSRF roto, o bloqueo por intentos) es infraestructura: caído, no clave mala', async () => {
  modoPost = { clase: 'estado', status: 403 };
  const { valor } = await conConsolaCapturada(() => autenticarEnCerberus(USUARIO, CLAVE));
  assert.equal(valor.ok === false && valor.caido, true);
});

test('el handshake sin formulario sigue siendo caído (la rama que ya existía)', async () => {
  const roto = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html>mantenimiento</html>');
  });
  await once(roto.listen(0, '127.0.0.1'), 'listening');
  const puerto = (roto.address() as AddressInfo).port;
  const antes = process.env.CERBERUS_BASE_URL;
  // Si el import de abajo NO trajera un módulo nuevo, esto haría que el test
  // falle en vez de pasar por el motivo equivocado: contra el stub de arriba,
  // `rechaza` da `caido: undefined`.
  modoPost = { clase: 'rechaza' };
  try {
    // El módulo ya leyó su BASE, así que este caso se prueba con su propio import.
    process.env.CERBERUS_BASE_URL = `http://127.0.0.1:${puerto}`;
    const { autenticarEnCerberus: autenticarContraElRoto } = (await import(
      `./auth.js?roto=${puerto}`
    )) as typeof import('./auth.js');
    const { valor } = await conConsolaCapturada(() => autenticarContraElRoto(USUARIO, CLAVE));
    assert.equal(valor.ok === false && valor.caido, true);
  } finally {
    process.env.CERBERUS_BASE_URL = antes;
    roto.close();
  }
});

test('la contraseña no vuelve en ningún resultado, en ninguna rama', async () => {
  const modos: ModoPost[] = [
    { clase: 'acepta' },
    { clase: 'rechaza' },
    { clase: 'estado', status: 500 },
    { clase: 'estado', status: 429 },
  ];
  for (const modo of modos) {
    modoPost = modo;
    const { valor } = await conConsolaCapturada(() => autenticarEnCerberus(USUARIO, CLAVE));
    assert.ok(!JSON.stringify(valor).includes(CLAVE), `la clave volvió en el resultado (${JSON.stringify(modo)})`);
  }
});

test.after(() => {
  server.close();
});
