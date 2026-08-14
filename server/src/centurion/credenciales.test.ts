import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import {
  CODIGO_ERROR_CREDENCIALES,
  TTL_SERVICIO_S,
  consultarCredencialesEnCenturion,
  firmarTokenDeServicio,
  loginDirectoDeCenturionConfigurado,
} from './credenciales.js';

/**
 * EL CLIENTE HACIA CENTURIÓN. Dos cosas se fijan acá y las dos son de
 * seguridad: que el secreto se use como FIRMA y nunca como Bearer, y que la
 * contraseña no se escriba en ningún log en ninguna de las ocho ramas de error.
 */

const USUARIO = 'betto.romero';
const CLAVE = 'la-clave-que-nunca-se-loguea';
const SECRETO = 'secreto-compartido-de-prueba';
const URL_CENTURION = 'https://centurion.example';

interface Espia {
  llamadas: { url: string; init: RequestInit }[];
  fetch: typeof fetch;
}

/** Un `fetch` de mentira que anota lo que se le pidió y contesta lo que se le diga. */
function espiar(responder: () => Response | Promise<Response>): Espia {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const fetchFalso = (async (entrada: Parameters<typeof fetch>[0], init?: RequestInit) => {
    llamadas.push({ url: String(entrada), init: init ?? {} });
    return responder();
  }) as typeof fetch;
  return { llamadas, fetch: fetchFalso };
}

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
}

/** Corre algo con la consola capturada y devuelve todo lo que se escribió, aplanado. */
async function conConsolaCapturada<T>(fn: () => Promise<T>): Promise<{ valor: T; consola: string }> {
  const originales = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  const escrito: string[] = [];
  const anotar = (...args: unknown[]) => {
    for (const a of args) {
      try {
        escrito.push(typeof a === 'string' ? a : JSON.stringify(a) ?? String(a));
      } catch {
        escrito.push(String(a));
      }
    }
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

function bearerDe(espia: Espia): string {
  const headers = espia.llamadas[0].init.headers as Record<string, string>;
  return headers.authorization.replace('Bearer ', '');
}

// ── El token de servicio ────────────────────────────────────────────────────

test('el token de servicio es un JWT HS256 firmado con el secreto: aud=centurion, iss=hermes, 60 s', () => {
  const ahoraMs = 1_760_000_000_000;
  const jwt = firmarTokenDeServicio(SECRETO, ahoraMs);
  const [encabezado, cuerpo, firma] = jwt.split('.');

  assert.deepEqual(JSON.parse(Buffer.from(encabezado, 'base64url').toString()), { alg: 'HS256', typ: 'JWT' });

  const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  const iat = Math.floor(ahoraMs / 1000);
  assert.equal(payload.aud, 'centurion');
  assert.equal(payload.iss, 'hermes');
  assert.equal(payload.iat, iat);
  assert.equal(payload.exp, iat + TTL_SERVICIO_S);
  assert.equal(TTL_SERVICIO_S, 60);

  const esperada = createHmac('sha256', SECRETO).update(`${encabezado}.${cuerpo}`).digest('base64url');
  assert.equal(firma, esperada);
});

test('🔴 el secreto NUNCA viaja como Bearer: el header lleva la firma, no la llave', async () => {
  const espia = espiar(() => json({ ok: true, token: 'token-de-handoff' }));
  await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: URL_CENTURION,
    secreto: SECRETO,
  });

  const bearer = bearerDe(espia);
  assert.notEqual(bearer, SECRETO);
  assert.ok(!bearer.includes(SECRETO), 'el secreto no puede aparecer dentro del Bearer');
  // Y lo que viaja verifica CON ese secreto: es firma, no ruido.
  const [enc, cue, fir] = bearer.split('.');
  assert.equal(fir, createHmac('sha256', SECRETO).update(`${enc}.${cue}`).digest('base64url'));
});

test('pega en POST /svc/hermes/api/credenciales, sin duplicar la barra de la URL base', async () => {
  const espia = espiar(() => json({ ok: true, token: 't' }));
  await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: `${URL_CENTURION}/`,
    secreto: SECRETO,
  });
  assert.equal(espia.llamadas[0].url, `${URL_CENTURION}/svc/hermes/api/credenciales`);
  assert.equal(espia.llamadas[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(espia.llamadas[0].init.body)), { usuario: USUARIO, password: CLAVE });
});

// ── Los desenlaces ──────────────────────────────────────────────────────────

test('200 { ok, token } devuelve el token de handoff', async () => {
  const espia = espiar(() => json({ ok: true, token: 'token-de-handoff' }));
  const r = await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: URL_CENTURION,
    secreto: SECRETO,
  });
  assert.deepEqual(r, { ok: true, token: 'token-de-handoff' });
});

test('401 credenciales_invalidas: se distingue, y NO se loguea (es la persona tecleando mal)', async () => {
  const espia = espiar(() => json({ ok: false, code: 'credenciales_invalidas' }, 401));
  const { valor, consola } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.deepEqual(valor, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.CREDENCIALES_INVALIDAS, estado: 401 });
  assert.equal(consola, '', 'una clave mal escrita no puede llenar el log');
});

test('401 servicio_no_autorizado: se distingue de la clave mala y SÍ se loguea (es config nuestra)', async () => {
  const espia = espiar(() => json({ ok: false, code: 'servicio_no_autorizado' }, 401));
  const { valor, consola } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.deepEqual(valor, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.SERVICIO_NO_AUTORIZADO, estado: 401 });
  assert.match(consola, /CENTURION_SSO_SECRET/);
});

test('503 sso_no_configurado del otro lado', async () => {
  const espia = espiar(() => json({ ok: false, code: 'sso_no_configurado' }, 503));
  const { valor } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.deepEqual(valor, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.SSO_NO_CONFIGURADO, estado: 503 });
});

test('un 401 con un `code` desconocido NO se adivina: cae en http_inesperado y hace ruido', async () => {
  const espia = espiar(() => json({ ok: false, code: 'algo_nuevo' }, 401));
  const { valor, consola } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.deepEqual(valor, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.HTTP_INESPERADO, estado: 401 });
  assert.match(consola, /inesperado/);
});

test('un 200 con { ok: false } es contrato roto, no un éxito raro', async () => {
  const espia = espiar(() => json({ ok: false, code: 'credenciales_invalidas' }));
  const { valor } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.equal(valor.ok, false);
  assert.equal(valor.ok === false && valor.codigo, CODIGO_ERROR_CREDENCIALES.RESPUESTA_INVALIDA);
});

test('un 200 con token vacío tampoco pasa', async () => {
  const espia = espiar(() => json({ ok: true, token: '' }));
  const { valor } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espia.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.equal(valor.ok === false && valor.codigo, CODIGO_ERROR_CREDENCIALES.RESPUESTA_INVALIDA);
});

test('timeout y red se distinguen: el nombre del error decide', async () => {
  const seTermino = Object.assign(new Error('agotado'), { name: 'TimeoutError' });
  const espiaTimeout = espiar(() => {
    throw seTermino;
  });
  const { valor: porTimeout } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espiaTimeout.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.equal(porTimeout.ok === false && porTimeout.codigo, CODIGO_ERROR_CREDENCIALES.TIMEOUT);

  const espiaRed = espiar(() => {
    throw new TypeError('fetch failed');
  });
  const { valor: porRed } = await conConsolaCapturada(() =>
    consultarCredencialesEnCenturion(USUARIO, CLAVE, {
      fetch: espiaRed.fetch,
      centurionUrl: URL_CENTURION,
      secreto: SECRETO,
    }),
  );
  assert.equal(porRed.ok === false && porRed.codigo, CODIGO_ERROR_CREDENCIALES.RED);
});

test('🔴 sin config no sale UN SOLO BYTE a la red: falta_config y cero llamadas', async () => {
  const espia = espiar(() => json({ ok: true, token: 'no-deberia-llegar-acá' }));

  const sinUrl = await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: '',
    secreto: SECRETO,
  });
  const sinSecreto = await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: URL_CENTURION,
    secreto: '',
  });

  assert.deepEqual(sinUrl, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.FALTA_CONFIG });
  assert.deepEqual(sinSecreto, { ok: false, codigo: CODIGO_ERROR_CREDENCIALES.FALTA_CONFIG });
  assert.equal(espia.llamadas.length, 0, 'la clave no puede viajar a un entorno sin este login habilitado');
});

// ── La contraseña ───────────────────────────────────────────────────────────

test('🔴 la contraseña no aparece en NINGÚN log, en ninguna de las ramas', async () => {
  const ramas: (() => Response | Promise<Response>)[] = [
    () => json({ ok: true, token: 't' }),
    () => json({ ok: false, code: 'credenciales_invalidas' }, 401),
    () => json({ ok: false, code: 'servicio_no_autorizado' }, 401),
    () => json({ ok: false, code: 'sso_no_configurado' }, 503),
    () => json({ ok: false, code: 'lo_que_sea' }, 418),
    () => json({ hola: 'mundo' }),
    // Un proxy que devuelve el eco de la petición: el caso que haría que un log
    // del cuerpo crudo escriba la contraseña en el archivo.
    () => json({ usuario: USUARIO, password: CLAVE }),
    () => new Response('esto no es json', { status: 200 }),
    () => {
      throw Object.assign(new Error(`no pude POSTear ${JSON.stringify({ usuario: USUARIO, password: CLAVE })}`), {
        name: 'TypeError',
      });
    },
  ];

  for (const responder of ramas) {
    const espia = espiar(responder);
    const { valor, consola } = await conConsolaCapturada(() =>
      consultarCredencialesEnCenturion(USUARIO, CLAVE, {
        fetch: espia.fetch,
        centurionUrl: URL_CENTURION,
        secreto: SECRETO,
      }),
    );
    assert.ok(!consola.includes(CLAVE), `la contraseña se filtró al log: ${consola}`);
    assert.ok(!JSON.stringify(valor).includes(CLAVE), `la contraseña se filtró al resultado: ${JSON.stringify(valor)}`);
  }
});

test('la contraseña viaja UNA sola vez: en el cuerpo del POST y en ningún header', async () => {
  const espia = espiar(() => json({ ok: true, token: 't' }));
  await consultarCredencialesEnCenturion(USUARIO, CLAVE, {
    fetch: espia.fetch,
    centurionUrl: URL_CENTURION,
    secreto: SECRETO,
  });
  const { url, init } = espia.llamadas[0];
  assert.ok(!url.includes(CLAVE), 'nunca en la URL: quedaría en el log de acceso de cualquier proxy');
  assert.ok(!JSON.stringify(init.headers).includes(CLAVE));
  assert.ok(String(init.body).includes(CLAVE));
});

// ── El interruptor del entorno ──────────────────────────────────────────────

test('hacen falta las DOS variables para que el login directo esté prendido', () => {
  const antesUrl = process.env.CENTURION_URL;
  const antesSecreto = process.env.CENTURION_SSO_SECRET;
  try {
    delete process.env.CENTURION_URL;
    delete process.env.CENTURION_SSO_SECRET;
    assert.equal(loginDirectoDeCenturionConfigurado(), false);

    process.env.CENTURION_SSO_SECRET = SECRETO;
    assert.equal(loginDirectoDeCenturionConfigurado(), false, 'con el secreto solo, no alcanza');

    process.env.CENTURION_URL = URL_CENTURION;
    assert.equal(loginDirectoDeCenturionConfigurado(), true);

    delete process.env.CENTURION_SSO_SECRET;
    assert.equal(loginDirectoDeCenturionConfigurado(), false, 'con la URL sola, tampoco');
  } finally {
    if (antesUrl === undefined) delete process.env.CENTURION_URL;
    else process.env.CENTURION_URL = antesUrl;
    if (antesSecreto === undefined) delete process.env.CENTURION_SSO_SECRET;
    else process.env.CENTURION_SSO_SECRET = antesSecreto;
  }
});
