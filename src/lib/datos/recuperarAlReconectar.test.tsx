// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { useTiempoReal } from './tiempoReal';
import { useSesionWa } from '../../features/whatsapp/conversacionWa';
import { useConversaciones } from '../../dominio/conversaciones';

/**
 * 🔴 EL STREAM NO TIENE REPLAY, ASÍ QUE RECONECTAR ES RECUPERAR.
 *
 * ── Por qué este candado existe ──
 * Bajarle ritmo a los polls (el hilo, la cola, la sesión) sólo es correcto
 * mientras el push sea la fuente. Lo que pagaba el hueco antes era el poll
 * rápido: mientras el stream estuvo cortado no llegó ni un aviso, y
 * `routes/stream.ts` no reenvía lo perdido al reconectar.
 *
 * Y **`refetchOnWindowFocus` está apagado globalmente** en Hermes
 * (`lib/datos/cliente.ts`), así que la salida habitual —«al volver a la pestaña
 * se refresca solo»— acá no existe. La red tiene que ser explícita.
 *
 * ── El caso que lo hace obligatorio, y es el que se prueba ──
 * `useSesionWa` deja de repreguntar un 404 («esa línea no está corriendo»)
 * porque es una respuesta estable: cambia cuando alguien monta la línea, y ahí
 * el server emite un `estado`. Pero si la línea se monta **mientras el front
 * está desconectado**, ese evento no le llega a nadie — y sin la invalidación
 * del reconecte la pantalla se quedaría en su 404 congelado para siempre, sin
 * un solo síntoma.
 *
 * Los dos mecanismos son inseparables: por eso se prueban juntos y no cada uno
 * con su mock.
 */

let montado: Montado | null = null;

function relojDeMentira() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

async function correrElReloj(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const LINEA = '51984429504';

/** Cuánto tarda el server en aceptar el stream, en este test. Ver `espia`. */
const TARDANZA_DEL_STREAM_MS = 1_000;

/** Un stream que abre, manda un keep-alive y se corta — como un deploy. */
function streamQueSeCorta(): Response {
  const cuerpo = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
      c.close();
    },
  });
  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function Anfitrion() {
  useTiempoReal(true);
  useSesionWa(LINEA);
  return <div>anfitrión</div>;
}

let espia: ReturnType<typeof vi.fn>;
/** Cuántas veces se montó la línea del otro lado. Arranca en «no corre». */
let lineaMontada = false;

beforeEach(() => {
  localStorage.setItem('hermes.token', 'tok');
  lineaMontada = false;
  relojDeMentira();
  espia = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/stream')) {
      // Tarda a propósito: así el 404 de la sesión YA está asentado cuando el
      // stream abre por primera vez. Sin esa separación, la invalidación de una
      // primera conexión caería sobre una query todavía en vuelo y no
      // produciría un segundo pedido — o sea que el test de «la primera no
      // invalida nada» pasaría con la guarda puesta Y sacada, que es
      // exactamente lo que un candado no puede hacer.
      await new Promise((listo) => setTimeout(listo, TARDANZA_DEL_STREAM_MS));
      return streamQueSeCorta();
    }
    if (u.includes('/api/whatsapp/sesion')) {
      return lineaMontada
        ? new Response(JSON.stringify({ estado: 'conectado', telefono: LINEA }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ ok: false, message: 'esa línea no está corriendo' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
    }
    return new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', espia);
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const pedidosDeSesion = () =>
  espia.mock.calls.filter(([u]) => String(u).includes('/api/whatsapp/sesion')).length;

describe('lo que se perdió mientras el stream estuvo cortado', () => {
  it('al reconectar, la línea congelada en 404 se vuelve a preguntar', async () => {
    montado = montar(<Anfitrion />);
    await correrElReloj(0);
    expect(pedidosDeSesion()).toBe(1); // el 404 congela: no se repregunta sola

    // El stream abre por primera vez y el server lo corta enseguida (un deploy).
    await correrElReloj(TARDANZA_DEL_STREAM_MS);
    // Mientras el front está desconectado, alguien monta la línea. Ese `estado`
    // no le llega a nadie: el stream no reenvía lo perdido.
    lineaMontada = true;
    expect(pedidosDeSesion()).toBe(1);

    // El reintento del stream (3 s) reconecta, y esa segunda apertura recupera.
    await correrElReloj(3_000 + TARDANZA_DEL_STREAM_MS);

    expect(pedidosDeSesion()).toBe(2);
  });

  /**
   * ⚠️ Y la PRIMERA conexión no recupera nada: ahí las queries recién se montan
   * y piden solas. Invalidar en la primera sería un pedido de más por cada
   * pantalla, en el momento más caro (el arranque).
   */
  it('la primera conexión no invalida nada', async () => {
    montado = montar(<Anfitrion />);
    await correrElReloj(0);
    expect(pedidosDeSesion()).toBe(1);

    // Alcanza para que el stream abra por PRIMERA vez y se corte, y se queda
    // corto del reintento de 3 s. Si la primera apertura invalidara, acá ya
    // habría un segundo pedido.
    await correrElReloj(TARDANZA_DEL_STREAM_MS + 500);

    expect(pedidosDeSesion()).toBe(1);
  });

  /**
   * Y la cola también se recupera — pero NO en el acto: pasa por la misma
   * ventana agrupada que los mensajes (`lib/datos/agrupador.ts`), que es lo que
   * la bajó de ~36 invalidaciones por minuto a 4.
   *
   * ⚠️ **Que la recuperación pague la ventana es deliberado y es el caso que
   * más la necesita**: un deploy corta el stream de las ~8 pestañas a la vez, o
   * sea que todas reconectan dentro de la misma ventana de 3 s y sin esto
   * dispararían juntas la consulta más cara del sistema — justo cuando el
   * server acaba de arrancar y está frío. El jitter las separa entre sí; la
   * ventana acota a cada una.
   */
  it('la cola se recupera también, al vencer la ventana agrupada', async () => {
    montado = montar(<AnfitrionConCola />);
    await correrElReloj(0);
    const cuantas = () =>
      espia.mock.calls.filter(([u]) => String(u).includes('/api/conversaciones')).length;
    const antes = cuantas();

    // Primera apertura + corte + reintento de 3 s + segunda apertura. Con eso
    // el reconecte ya PIDIÓ la invalidación, pero la ventana no venció.
    await correrElReloj(2 * TARDANZA_DEL_STREAM_MS + 3_000 + 100);
    expect(cuantas()).toBe(antes);

    // Y al vencer (15 s de ventana + hasta 4 de jitter), sí.
    await correrElReloj(19_100);
    expect(cuantas()).toBeGreaterThan(antes);
  });
});

function AnfitrionConCola() {
  useTiempoReal(true);
  useConversaciones();
  return <div>anfitrión</div>;
}
