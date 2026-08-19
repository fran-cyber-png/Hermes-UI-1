import { beforeEach, describe, expect, test } from 'vitest';
import { consumirStream } from './streamAutenticado';
import { olvidarLatido, streamVivo } from './latido';

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

/**
 * 🔴 EL LATIDO SE MARCA CON LOS BYTES, NO CON LOS EVENTOS.
 *
 * El server manda `: keep-alive\n\n` cada 25 s para que el otro lado sepa que
 * sigue vivo cuando no pasa nada — y el parser lo TIRA (`sse.ts` se queda sólo
 * con las líneas `data:`). Un latido leído desde `onData` estaría muerto
 * exactamente en el caso que existe para cubrir: un stream sano y callado.
 *
 * De acá cuelga que la cola deje de pollear cada 20 s: si el keep-alive no
 * marcara, `streamVivo()` daría `false` con el stream perfecto y el ahorro
 * entero no ocurriría — sin un solo error y sin un log.
 */
describe('el latido del stream', () => {
  beforeEach(() => olvidarLatido());

  test('un keep-alive SIN ningún evento ya cuenta como vivo', async () => {
    const datos: string[] = [];
    let vivoDuranteElStream = false;
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: (d) => datos.push(d),
      // El que llama se entera de que abrió; ahí adentro ya se leyó el primer chunk.
      onAbierto: () => {},
      fetchImpl: () => {
        // Se mira DENTRO del stream: al cerrar, `consumirStream` olvida el
        // latido a propósito, así que preguntar después daría siempre falso.
        //
        // El turno de espera no es magia negra: el `pull` del segundo chunk lo
        // dispara el propio `read()` ANTES de que su continuación corra, así que
        // sin ese turno se preguntaría justo un microtask antes de que el latido
        // se marque — el test daría rojo con el código bien.
        let paso = 0;
        const cuerpo = new ReadableStream<Uint8Array>({
          async pull(c) {
            if (paso++ === 0) {
              c.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
              return;
            }
            await new Promise((listo) => setTimeout(listo, 0));
            vivoDuranteElStream = streamVivo();
            c.close();
          },
        });
        return Promise.resolve(
          new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        );
      },
    });
    expect(datos).toEqual([]); // el parser no vio ningún evento…
    expect(vivoDuranteElStream).toBe(true); // …y el stream estaba vivo igual
  });

  test('avisa cuando el stream QUEDA ABIERTO, y una sola vez', async () => {
    let abrio = 0;
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      onAbierto: () => abrio++,
      fetchImpl: fetchFalso(streamDe('data: {"tipo":"mensaje"}\n\n', ': keep-alive\n\n')),
    });
    expect(abrio).toBe(1);
  });

  test('un 401 NO avisa de apertura: no hay stream que recuperar', async () => {
    let abrio = 0;
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'muerto',
      senal: senal(),
      onData: () => {},
      onAbierto: () => abrio++,
      fetchImpl: fetchFalso(new Response('{"ok":false}', { status: 401 })),
    });
    expect(abrio).toBe(0);
  });

  /**
   * Al cortarse, el latido se OLVIDA en el acto en vez de esperar el
   * vencimiento: si no, la cola se quedaría hasta un minuto creyendo que el
   * push sigue vivo justo cuando dejó de estarlo.
   */
  test('al cerrar el stream, el latido se olvida', async () => {
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchFalso(streamDe('data: {"tipo":"mensaje"}\n\n')),
    });
    expect(streamVivo()).toBe(false);
  });

  test('y una red caída tampoco deja el latido puesto', async () => {
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchFalso(streamDe('data: {"tipo":"mensaje"}\n\n')),
    });
    await consumirStream({
      url: 'http://x/api/stream',
      token: 'tok',
      senal: senal(),
      onData: () => {},
      fetchImpl: fetchFalso(new TypeError('fetch failed')),
    });
    expect(streamVivo()).toBe(false);
  });
});
