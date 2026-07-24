import { describe, expect, test } from 'vitest';
import { consumirStream } from './streamAutenticado';

/**
 * La distinción que estos tests fijan: **red caída ≠ sesión muerta**. Un fallo
 * de red se reintenta (el server puede estar en medio de un deploy); un 401 NO
 * — martillar cada 3s con un token muerto no lo revive, hay que cortar y
 * disparar la re-validación de sesión. Si esto se confunde, o el tiempo real
 * muere para siempre por un parpadeo de red, o el server público come un
 * request inútil cada 3 segundos por cada sesión vencida abierta.
 */

function fetchFalso(res: Response | Error): typeof fetch {
  return () => (res instanceof Error ? Promise.reject(res) : Promise.resolve(res));
}

function streamDe(...trozos: string[]): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(controlador) {
      const codificador = new TextEncoder();
      for (const t of trozos) controlador.enqueue(codificador.encode(t));
      controlador.close();
    },
  });
  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const senal = () => new AbortController().signal;

describe('consumirStream', () => {
  test('entrega cada evento data y termina en «cerrado» cuando el server corta', async () => {
    const datos: string[] = [];
    const fin = await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: (d) => datos.push(d),
      fetchImpl: fetchFalso(streamDe('retry: 3000\n\n', 'data: {"tipo":"estado"}\n\n', 'data: {"tipo":"mensaje"}\n\n')),
    });
    expect(datos).toEqual(['{"tipo":"estado"}', '{"tipo":"mensaje"}']);
    expect(fin).toBe('cerrado');
  });

  test('un 401 es «no-autorizado»: el que llama corta el loop, no reintenta', async () => {
    const datos: string[] = [];
    const fin = await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok-vencido',
      senal: senal(),
      onData: (d) => datos.push(d),
      fetchImpl: fetchFalso(new Response('{"ok":false}', { status: 401 })),
    });
    expect(fin).toBe('no-autorizado');
    expect(datos).toEqual([]);
  });

  test('la red caída es «fallo»: eso SÍ se reintenta', async () => {
    const fin = await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchFalso(new TypeError('fetch failed')),
    });
    expect(fin).toBe('fallo');
  });

  test('un 500 del server también es «fallo» reintentabile, no una sesión muerta', async () => {
    const fin = await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchFalso(new Response('boom', { status: 500 })),
    });
    expect(fin).toBe('fallo');
  });

  test('manda el Bearer — sin esto el perímetro lo rebota siempre', async () => {
    let auth: string | null = null;
    const fetchEspia: typeof fetch = (_url, init) => {
      auth = new Headers(init?.headers).get('authorization');
      return Promise.resolve(streamDe());
    };
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok-123',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchEspia,
    });
    expect(auth).toBe('Bearer tok-123');
  });
});
