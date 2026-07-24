import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  CODIGO_ERROR_IVI,
  ErrorIvi,
  preguntarleAIvi,
  respuestaIviSchema,
  type RespuestaIvi,
  type TurnoHistorial,
} from './cliente.js';

/**
 * El cliente es la costura hacia Ivi. Lo que importa: arma bien el request (URL,
 * Bearer, body) y traduce CADA clase de fallo a un error distinto — nunca a una
 * respuesta falsa. `fetch` va INYECTADO: cero red de verdad.
 */

// Config obviamente falsa: nunca sale a ningún lado (regla dura #1, ni en tests).
const CONFIG_OK = { iviUrl: 'https://ivi.example.ts.net', token: 'token-de-prueba' };

function respuestaValida(): RespuestaIvi {
  return {
    texto: 'La Escuela cerró 12 ventas esta semana.',
    tipo: 'dato',
    fuentes: [{ titulo: 'ventas_semana', ref: 'cerberus' }],
    groundingOk: true,
    edadDelDato: 'hace 2 horas',
  };
}

interface Llamada {
  url: string;
  init: RequestInit;
}

/** Un `fetch` falso que registra la llamada y devuelve lo que le pidas. */
function fetchQueDevuelve(body: unknown, init: ResponseInit = { status: 200 }) {
  const llamadas: Llamada[] = [];
  const fake: typeof fetch = async (url, opts) => {
    llamadas.push({ url: String(url), init: opts ?? {} });
    const cuerpo = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(cuerpo, { headers: { 'content-type': 'application/json' }, ...init });
  };
  return { fake, llamadas };
}

/** Un `fetch` falso que estalla (para timeout / red). */
function fetchQueEstalla(err: unknown): typeof fetch {
  return async () => {
    throw err;
  };
}

describe('preguntarleAIvi — arma el request', () => {
  test('pega a {IVI_URL}/api/preguntar con Bearer y el body correcto, y devuelve la RespuestaIvi', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaValida());
    const historial: TurnoHistorial[] = [{ rol: 'vendedora', texto: 'hola' }];

    const r = await preguntarleAIvi('¿cuántas ventas?', 'ana', historial, { ...CONFIG_OK, fetch: fake });

    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url, 'https://ivi.example.ts.net/api/preguntar');
    assert.equal(llamadas[0].init.method, 'POST');

    const headers = llamadas[0].init.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer token-de-prueba');
    assert.equal(headers['content-type'], 'application/json');

    const enviado = JSON.parse(String(llamadas[0].init.body));
    assert.equal(enviado.pregunta, '¿cuántas ventas?');
    assert.equal(enviado.usuario, 'ana');
    assert.deepEqual(enviado.historial, [{ rol: 'vendedora', texto: 'hola' }]);

    assert.equal(r.texto, 'La Escuela cerró 12 ventas esta semana.');
    assert.equal(r.groundingOk, true);
  });

  test('sin historial, el body no lleva la clave `historial`', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaValida());
    await preguntarleAIvi('hola', 'ana', undefined, { ...CONFIG_OK, fetch: fake });
    const enviado = JSON.parse(String(llamadas[0].init.body));
    assert.equal('historial' in enviado, false);
  });

  test('recorta la barra final de IVI_URL antes de armar la ruta', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaValida());
    await preguntarleAIvi('hola', 'ana', undefined, {
      iviUrl: 'https://ivi.example.ts.net/',
      token: 'token-de-prueba',
      fetch: fake,
    });
    assert.equal(llamadas[0].url, 'https://ivi.example.ts.net/api/preguntar');
  });
});

describe('preguntarleAIvi — fail-closed y ruidoso', () => {
  test('sin IVI_URL: error de config y NO toca la red', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaValida());
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { iviUrl: '', token: 'token-de-prueba', fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.FALTA_CONFIG,
    );
    assert.equal(llamadas.length, 0, 'no debe salir a la red sin config');
  });

  test('sin IVI_SERVICE_TOKEN: error de config y NO toca la red', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaValida());
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { iviUrl: 'https://ivi.example.ts.net', token: '', fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.FALTA_CONFIG,
    );
    assert.equal(llamadas.length, 0);
  });

  test('401 → CONFIG_HERMES (el token no vale), con el estado', async () => {
    const { fake } = fetchQueDevuelve('', { status: 401 });
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.CONFIG_HERMES && e.estado === 401,
    );
  });

  test('503 → IVI_NO_CONFIGURADO', async () => {
    const { fake } = fetchQueDevuelve('', { status: 503 });
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.IVI_NO_CONFIGURADO && e.estado === 503,
    );
  });

  test('otro estado (500) → HTTP_INESPERADO', async () => {
    const { fake } = fetchQueDevuelve('', { status: 500 });
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.HTTP_INESPERADO && e.estado === 500,
    );
  });

  test('timeout (AbortSignal.timeout) → TIMEOUT', async () => {
    const fake = fetchQueEstalla(new DOMException('tardó demasiado', 'TimeoutError'));
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.TIMEOUT,
    );
  });

  test('fallo de red → RED', async () => {
    const fake = fetchQueEstalla(new TypeError('fetch failed'));
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.RED,
    );
  });

  test('cuerpo que no cumple el contrato → RESPUESTA_INVALIDA (nunca «no hay datos»)', async () => {
    // Falta `groundingOk`: es un fallo, no una respuesta sin datos.
    const { fake } = fetchQueDevuelve({ texto: 'x', tipo: 'dato', fuentes: [], edadDelDato: null });
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.RESPUESTA_INVALIDA,
    );
  });

  test('cuerpo que no es JSON → RESPUESTA_INVALIDA', async () => {
    const { fake } = fetchQueDevuelve('no soy json', { status: 200 });
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.RESPUESTA_INVALIDA,
    );
  });
});

describe('contrato RespuestaIvi', () => {
  test('acepta una respuesta válida', () => {
    assert.equal(respuestaIviSchema.safeParse(respuestaValida()).success, true);
  });

  test('rechaza si falta groundingOk', () => {
    const { groundingOk: _omitido, ...sinGrounding } = respuestaValida();
    assert.equal(respuestaIviSchema.safeParse(sinGrounding).success, false);
  });

  test('rechaza si texto no es string', () => {
    assert.equal(respuestaIviSchema.safeParse({ ...respuestaValida(), texto: 123 }).success, false);
  });

  test('acepta edadDelDato null y numérico', () => {
    assert.equal(respuestaIviSchema.safeParse({ ...respuestaValida(), edadDelDato: null }).success, true);
    assert.equal(respuestaIviSchema.safeParse({ ...respuestaValida(), edadDelDato: 7200 }).success, true);
  });
});
