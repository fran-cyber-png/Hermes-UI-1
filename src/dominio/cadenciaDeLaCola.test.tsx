// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../pruebas/dom';
import { useTiempoReal } from '../lib/datos/tiempoReal';
import { useConversaciones } from './conversaciones';
import { olvidarLatido } from '../lib/datos/latido';

/**
 * 🔴 CON EL PUSH VIVO, LA CONSULTA MÁS CARA DEL SISTEMA DEJA DE CORRER SOLA.
 *
 * ── Lo medido ──
 * 13.152 pedidos a `/api/conversaciones` el 18-ago-2026, **2,4 s cada uno**,
 * contra 220 mensajes reales en todo el día. El SSE ya invalidaba esa clave por
 * cada mensaje: el intervalo era una red corriendo a ritmo de fuente.
 *
 * ── Por qué montado, y con el stream de verdad ──
 * `intervaloDeCola` y `streamVivo` están testeadas puras en
 * `lib/datos/latido.test.ts`. Lo que no se puede ver ahí es la cadena completa,
 * que es donde el defecto se esconde: el keep-alive tiene que llegar como
 * BYTES, `streamAutenticado` tiene que marcarlo (el parser lo tira), y la
 * opción de TanStack tiene que leerlo. Si cualquiera de los tres eslabones se
 * corta, `streamVivo()` da `false` con el stream perfecto, la cola sigue
 * polleando cada 20 s **y no hay ningún error ni ningún log**.
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

/** Un stream sano: abre, late enseguida y sigue latiendo cada 25 s, como el server. */
function streamQueLate(): Response {
  let primero = true;
  const cuerpo = new ReadableStream<Uint8Array>({
    async pull(c) {
      if (!primero) await new Promise((listo) => setTimeout(listo, 25_000));
      primero = false;
      c.enqueue(new TextEncoder().encode(': keep-alive\n\n'));
    },
  });
  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function Anfitrion() {
  useTiempoReal(true);
  useConversaciones();
  return <div>cola</div>;
}

let espia: ReturnType<typeof vi.fn>;
/** Si `false`, el stream nunca conecta: el push no existe. */
let hayStream = true;

beforeEach(() => {
  localStorage.setItem('hermes.token', 'tok');
  hayStream = true;
  // ⚠️ El latido es estado de MÓDULO y el reloj falso no toca `Date.now()`, así
  // que sin esto el latido del caso anterior sobrevive y el caso «sin stream»
  // arranca creyendo que el push está vivo — verde por el motivo equivocado.
  olvidarLatido();
  relojDeMentira();
  espia = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/stream')) {
      if (!hayStream) return new Response('caído', { status: 502 });
      return streamQueLate();
    }
    return new Response(JSON.stringify({ conversaciones: [], hayMas: false, total: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
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

const pedidosDeCola = () =>
  espia.mock.calls.filter(([u]) => String(u).includes('/api/conversaciones')).length;

describe('el ritmo de la cola', () => {
  /**
   * El techo es 2 y no 1 porque `refetchInterval` se recalcula recién cuando su
   * timer vence: si el stream tarda en dar su primer latido más de lo que tarda
   * la cola en asentar su primera respuesta, el intervalo corto que se armó ahí
   * se cobra una vez y recién el siguiente son 5 minutos. Con el ritmo viejo,
   * en 90 s son cuatro o cinco — que es lo que el caso de abajo fija.
   */
  it('con el stream vivo, casi no se pide sola', async () => {
    montado = montar(<Anfitrion />);
    await correrElReloj(0);
    expect(pedidosDeCola()).toBe(1);

    await correrElReloj(90_000);

    expect(pedidosDeCola()).toBeLessThanOrEqual(2);
  });

  /**
   * ⚠️ **El poll no sobra: es la única recuperación de un stream sin replay**, y
   * `refetchOnWindowFocus` está apagado globalmente en Hermes. Sin push, vuelve
   * el ritmo de siempre — con jitter, para que las ~8 pestañas no disparen
   * juntas la consulta más cara del sistema.
   */
  it('sin stream, vuelve el ritmo de siempre', async () => {
    hayStream = false;
    montado = montar(<Anfitrion />);
    await correrElReloj(0);

    await correrElReloj(90_000);

    expect(pedidosDeCola()).toBeGreaterThanOrEqual(4);
  });
});
