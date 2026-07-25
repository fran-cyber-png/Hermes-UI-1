import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  CODIGO_ERROR_IVI,
  ErrorIvi,
  preguntarleAIvi,
  aParesQA,
  respuestaIviSchema,
  TIMEOUT_MS,
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

/**
 * Lo que Ivi manda POR LA RED: snake_case, tal cual lo emite `contrato_hermes()`
 * (ivi-cerebro/rag/api_contrato.py). Este es el contrato real y el que manda.
 */
function respuestaDeIvi() {
  return {
    texto: 'La Escuela cerró 12 ventas esta semana.',
    tipo: 'dato',
    fuentes: [{ titulo: 'ventas_semana', ref: 'cerberus' }],
    grounding_ok: true,
    edad_del_dato: 'hace 2 horas',
  };
}

/** La forma INTERNA de Hermes, ya traducida. Solo para probar `respuestaIviSchema` directo. */
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

/**
 * Un `fetch` falso que SÍ resuelve con una Response 200, pero cuya lectura del
 * body (`.json()`) es la que estalla — el caso del #98: el mismo AbortSignal
 * sigue armado mientras se lee el body, así que un timeout ahí no es lo mismo
 * que un JSON roto.
 */
function fetchConBodyQueEstalla(err: unknown): typeof fetch {
  return async () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(err);
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
}

describe('preguntarleAIvi — arma el request', () => {
  test('pega a {IVI_URL}/api/preguntar con Bearer y el body correcto, y devuelve la RespuestaIvi', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaDeIvi());
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
    // El historial cruza como [{q, a}]: es lo único que `responder()` de Ivi sabe leer (#142).
    assert.deepEqual(enviado.historial, [{ q: 'hola', a: '' }]);

    assert.equal(r.texto, 'La Escuela cerró 12 ventas esta semana.');
    assert.equal(r.groundingOk, true);
  });

  test('sin historial, el body no lleva la clave `historial`', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaDeIvi());
    await preguntarleAIvi('hola', 'ana', undefined, { ...CONFIG_OK, fetch: fake });
    const enviado = JSON.parse(String(llamadas[0].init.body));
    assert.equal('historial' in enviado, false);
  });

  test('recorta la barra final de IVI_URL antes de armar la ruta', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaDeIvi());
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
    const { fake, llamadas } = fetchQueDevuelve(respuestaDeIvi());
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { iviUrl: '', token: 'token-de-prueba', fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.FALTA_CONFIG,
    );
    assert.equal(llamadas.length, 0, 'no debe salir a la red sin config');
  });

  test('sin IVI_SERVICE_TOKEN: error de config y NO toca la red', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaDeIvi());
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

  test('timeout durante la LECTURA del body → TIMEOUT, no RESPUESTA_INVALIDA (#98)', async () => {
    const fake = fetchConBodyQueEstalla(new DOMException('tardó demasiado', 'TimeoutError'));
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.TIMEOUT,
    );
  });

  test('fallo de red → RED, con la causa original preservada (no se descarta, #98)', async () => {
    const causa = new TypeError('fetch failed');
    const fake = fetchQueEstalla(causa);
    await assert.rejects(
      () => preguntarleAIvi('q', 'ana', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.RED && e.cause === causa,
    );
  });

  test('el presupuesto de tiempo es 30 s — fijado por test, no puede cambiar sin querer (#98)', () => {
    assert.equal(TIMEOUT_MS, 30_000);
  });

  test('cuerpo que no cumple el contrato → RESPUESTA_INVALIDA (nunca «no hay datos»)', async () => {
    // Falta `groundingOk`: es un fallo, no una respuesta sin datos.
    const { fake } = fetchQueDevuelve({ texto: 'x', tipo: 'dato', fuentes: [], edad_del_dato: null });
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

/**
 * LA COSTURA — los dos bugs que tuvieron al puente en 502 desde el día uno (#141, #142).
 *
 * El resto de este archivo construye sus mocks en camelCase, que es la forma INTERNA. Por eso
 * pasaban en verde mientras la ruta real fallaba siempre: el test nunca cruzó la costura.
 *
 * Estos fixtures son lo que Ivi devuelve DE VERDAD: snake_case, tal cual lo emite
 * `contrato_hermes()` (ivi-cerebro/rag/api_contrato.py). Si alguno de los dos lados cambia de
 * convención, estos tests se ponen rojos.
 */
describe('la costura con Ivi (contrato real, snake_case)', () => {
  /** Copia literal de lo que emite `contrato_hermes()` en ivi-cerebro. NO tocar a mano. */
  function respuestaRealDeIvi() {
    return {
      texto: 'En México llevamos 642 ventas cobradas este mes.',
      tipo: 'HECHO',
      modo: 'estructurada',
      fuentes: ['governa.ventas.porPais'],
      grounding_ok: true,
      numeros_no_verificados: [],
      edad_del_dato: 1840,
      redactor: 'bedrock (claude-haiku)',
    };
  }

  test('acepta la respuesta real de Ivi y la traduce a camelCase', async () => {
    const { fake } = fetchQueDevuelve(respuestaRealDeIvi());
    const r = await preguntarleAIvi('¿ventas de México?', 'vendedora-1', undefined, {
      ...CONFIG_OK,
      fetch: fake,
    });
    assert.equal(r.groundingOk, true, 'grounding_ok tiene que llegar como groundingOk');
    assert.equal(r.edadDelDato, 1840, 'edad_del_dato tiene que llegar como edadDelDato');
    assert.equal(r.tipo, 'HECHO');
    assert.deepEqual(r.fuentes, ['governa.ventas.porPais']);
  });

  test('edad_del_dato null sobrevive como null — «no medido» no es «fresco»', async () => {
    const { fake } = fetchQueDevuelve({ ...respuestaRealDeIvi(), edad_del_dato: null });
    const r = await preguntarleAIvi('¿y Perú?', 'vendedora-1', undefined, { ...CONFIG_OK, fetch: fake });
    assert.equal(r.edadDelDato, null);
  });

  test('grounding_ok false no se pierde: la app tiene que poder marcar las cifras', async () => {
    const { fake } = fetchQueDevuelve({ ...respuestaRealDeIvi(), grounding_ok: false });
    const r = await preguntarleAIvi('¿cuánto?', 'vendedora-1', undefined, { ...CONFIG_OK, fetch: fake });
    assert.equal(r.groundingOk, false);
  });

  test('un cuerpo que no es objeto sigue siendo RESPUESTA_INVALIDA, no un objeto vacío', async () => {
    const { fake } = fetchQueDevuelve('"soy un string"');
    await assert.rejects(
      () => preguntarleAIvi('x', 'v', undefined, { ...CONFIG_OK, fetch: fake }),
      (e: unknown) => e instanceof ErrorIvi && e.codigo === CODIGO_ERROR_IVI.RESPUESTA_INVALIDA,
    );
  });

  test('el historial viaja como [{q, a}], que es lo único que Ivi sabe leer', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaRealDeIvi());
    const historial: TurnoHistorial[] = [
      { rol: 'vendedora', texto: '¿ventas de México?' },
      { rol: 'ivi', texto: 'México lleva 642.' },
      { rol: 'vendedora', texto: '¿y Perú?' },
    ];
    await preguntarleAIvi('¿y Ecuador?', 'vendedora-1', historial, { ...CONFIG_OK, fetch: fake });
    const body = JSON.parse(String(llamadas[0]!.init.body));
    assert.deepEqual(body.historial, [
      { q: '¿ventas de México?', a: 'México lleva 642.' },
      { q: '¿y Perú?', a: '' },
    ]);
  });

  test('aParesQA aguanta los casos torcidos sin romperse', () => {
    // dos mensajes seguidos de la vendedora: dos preguntas, la primera sin responder
    assert.deepEqual(
      aParesQA([
        { rol: 'vendedora', texto: 'hola' },
        { rol: 'vendedora', texto: '¿precio?' },
      ]),
      [{ q: 'hola', a: '' }, { q: '¿precio?', a: '' }],
    );
    // un turno de Ivi sin pregunta previa no tiene dónde colgarse: se descarta
    assert.deepEqual(aParesQA([{ rol: 'ivi', texto: 'huérfano' }]), []);
    // dos de Ivi seguidas: la segunda no pisa la respuesta ya puesta
    assert.deepEqual(
      aParesQA([
        { rol: 'vendedora', texto: 'q' },
        { rol: 'ivi', texto: 'a1' },
        { rol: 'ivi', texto: 'a2' },
      ]),
      [{ q: 'q', a: 'a1' }],
    );
    assert.deepEqual(aParesQA([]), []);
  });

  test('sin historial no se manda el campo (no se manda una lista vacía)', async () => {
    const { fake, llamadas } = fetchQueDevuelve(respuestaRealDeIvi());
    await preguntarleAIvi('x', 'v', [], { ...CONFIG_OK, fetch: fake });
    assert.equal('historial' in JSON.parse(String(llamadas[0]!.init.body)), false);
  });
});
