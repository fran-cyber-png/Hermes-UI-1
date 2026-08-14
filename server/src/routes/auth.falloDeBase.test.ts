import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';

/**
 * 🔴 UN FALLO DE LA BASE NO PUEDE TUMBAR EL PROCESO.
 *
 * Express 4 **no atrapa el rechazo de un handler `async`**: se vuelve un
 * `unhandledRejection` y Node se cae. Hasta el login directo eso no podía pasar
 * en `POST /api/auth/login` —era Cerberus y nada más, y `autenticarEnCerberus`
 * atrapa todo adentro—, pero ahora la cascada llega a `canjear`, que consulta
 * `numero_vendedora`. Con la base caída, un login fallido se convertía en
 * **Hermes abajo para las cinco vendedoras**.
 *
 * ── Por qué este archivo NO es `.test.db.ts` ──
 * Porque lo que se prueba es la base **ausente**, no una base de prueba: el
 * `DATABASE_URL` que se setea acá apunta a un puerto donde no escucha nadie.
 * `db/client.ts` solo exige que la variable EXISTA (postgres.js conecta
 * perezoso), así que la primera consulta rechaza con `ECONNREFUSED` — que es
 * exactamente lo que hace una base caída en producción. El runner de node corre
 * cada archivo en su propio proceso, así que esta env no se le escapa a nadie.
 *
 * Los dos sistemas de afuera son stubs locales, como en `auth.login.test.db.ts`:
 * Cerberus rechaza (para que la cascada siga) y Centurión acepta con un token de
 * handoff de verdad (para que el canje llegue hasta la consulta a la base).
 */

const SECRETO = 'secreto-de-prueba-del-login-directo';
const CLAVE = 'la-clave-que-nunca-se-loguea';

function levantar(manejar: Parameters<typeof createServer>[1]): Promise<{ server: Server; base: string }> {
  const server = createServer(manejar);
  return once(server.listen(0, '127.0.0.1'), 'listening').then(() => {
    const { port } = server.address() as AddressInfo;
    return { server, base: `http://127.0.0.1:${port}` };
  });
}

/** El baile CSRF de Django en miniatura, siempre rechazando la clave. */
const cerberus = await levantar((req, res) => {
  if (req.method === 'GET') {
    res
      .writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'csrftoken=abc; Path=/' })
      .end('<form><input name="csrfmiddlewaretoken" value="xyz"></form>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' }).end('<form>credenciales incorrectas</form>');
});

function tokenDeHandoff(): string {
  const encabezado = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const cuerpo = Buffer.from(
    JSON.stringify({ sub: 'betto.romero', aud: 'hermes', exp: Math.floor(Date.now() / 1000) + 120 }),
  ).toString('base64url');
  const firma = createHmac('sha256', SECRETO).update(`${encabezado}.${cuerpo}`).digest('base64url');
  return `${encabezado}.${cuerpo}.${firma}`;
}

const centurion = await levantar((_req, res) => {
  res
    .writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ ok: true, token: tokenDeHandoff() }));
});

/**
 * Una base que no existe. El puerto se toma y se suelta enseguida: así se elige
 * uno que con altísima probabilidad no tiene a nadie escuchando, sin clavar un
 * número a mano que mañana podría ser el Postgres de alguien.
 */
const muerto = createServer(() => {});
await once(muerto.listen(0, '127.0.0.1'), 'listening');
const puertoMuerto = (muerto.address() as AddressInfo).port;
muerto.close();
await once(muerto, 'close');

process.env.DATABASE_URL = `postgres://nadie:nadie@127.0.0.1:${puertoMuerto}/no_existe`;
process.env.CERBERUS_BASE_URL = cerberus.base;
process.env.CENTURION_URL = centurion.base;
process.env.CENTURION_SSO_SECRET = SECRETO;
process.env.HERMES_SESSION_SECRET ??= 'secreto-de-sesion-de-prueba';

const { authRouter } = await import('./auth.js');

interface Respuesta {
  status: number;
  json: Record<string, unknown> | null;
}

/**
 * ⚠️ **El pedido lleva techo de tiempo, y sin él este test no falla: SE CUELGA.**
 * Sin el `try/catch` del handler, el rechazo deja el pedido sin respuesta para
 * siempre y `fetch` espera para siempre — el runner se queda colgado y no hay
 * error que leer. Con el techo, la ausencia de respuesta se ve como un `status`
 * imposible y la aserción de abajo lo dice con todas las letras.
 */
const TECHO_MS = 5_000;

/** Los rechazos que nadie manejó durante el pedido: si hay uno, el proceso se caía. */
function vigilarRechazos(): { sueltos: unknown[]; soltar: () => void } {
  const sueltos: unknown[] = [];
  const anotar = (razon: unknown) => void sueltos.push(razon);
  // `process.on` y no `once`: se quiere ver TODOS, y en un proceso sin listener
  // propio el default de Node es terminar.
  process.on('unhandledRejection', anotar);
  return { sueltos, soltar: () => void process.off('unhandledRejection', anotar) };
}

async function pedir(ruta: string, body: unknown): Promise<Respuesta> {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TECHO_MS),
    });
    return { status: resp.status, json: (await resp.json().catch(() => null)) as Record<string, unknown> | null };
  } catch {
    // Un pedido que nunca contesta: el síntoma exacto de un handler que rechazó.
    return { status: 0, json: null };
  } finally {
    server.close();
  }
}

/** Deja pasar un par de turnos: un `unhandledRejection` no se emite en el mismo tick. */
async function respirar(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((listo) => setTimeout(listo, 10));
}

test('🔴 con la base caída, /login contesta 5xx y NO deja un rechazo sin manejar', async () => {
  const vigia = vigilarRechazos();
  try {
    const r = await pedir('/api/auth/login', { username: 'betto.romero', password: CLAVE });
    await respirar();

    assert.notEqual(r.status, 0, 'el pedido nunca contestó: el handler rechazó y nadie lo atrapó');
    assert.ok(r.status >= 500, `el fallo de la base tiene que ser un 5xx honesto, y contestó ${r.status}`);
    assert.notEqual(r.status, 401, 'un 401 manda a resetear una clave que funciona');
    assert.ok(typeof r.json?.message === 'string' && r.json.message.length > 0, 'un 5xx mudo no le dice nada a nadie');
    assert.deepEqual(vigia.sueltos, [], 'un rechazo sin manejar en Express 4 se lleva el proceso puesto');
    assert.ok(!JSON.stringify(r.json).includes(CLAVE));
  } finally {
    vigia.soltar();
  }
});

test('🔴 lo mismo por la otra puerta: /centurion también consulta la base', async () => {
  const vigia = vigilarRechazos();
  try {
    const r = await pedir('/api/auth/centurion', { token: tokenDeHandoff() });
    await respirar();

    assert.notEqual(r.status, 0, 'el pedido nunca contestó: el handler rechazó y nadie lo atrapó');
    assert.ok(r.status >= 500, `contestó ${r.status}`);
    assert.notEqual(r.status, 401);
    assert.deepEqual(vigia.sueltos, []);
  } finally {
    vigia.soltar();
  }
});

test('el 5xx de la base NO se confunde con «no tenés línea asignada»', async () => {
  // Los dos casos terminan en «no entrás» y son opuestos: uno se arregla con una
  // fila en `numero_vendedora`, el otro levantando la base. Si el fallo de la
  // consulta se leyera como «cero líneas», soporte buscaría la fila para siempre.
  const r = await pedir('/api/auth/centurion', { token: tokenDeHandoff() });
  assert.notEqual(r.json?.type, 'sin_linea_asignada');
  assert.notEqual(r.status, 403);
});

test.after(() => {
  cerberus.server.close();
  centurion.server.close();
});
