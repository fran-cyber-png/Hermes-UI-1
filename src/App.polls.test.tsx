// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from './pruebas/dom';
import App from './App';

/**
 * 🔴 DETRÁS DEL LOGIN NO SE LE PIDE NADA AL SERVER.
 *
 * ── Lo que estaba mal, medido ──
 * `App` era un solo componente con `useSesionWa`, `useAutoRespuesta`,
 * `useAgenda`, `useDashboard` y el SSE declarados ARRIBA de los early returns —
 * y las reglas de los hooks obligan a eso: un `return` temprano no puede
 * saltearse una llamada. Así que **con la pantalla de Login adelante seguían
 * corriendo cuatro polls** (10 s, 30 s, 30 s y 60 s), todos contestando 401 y
 * ninguno visible para nadie. Una máquina abierta en el Login le pegaba a
 * producción indefinidamente.
 *
 * ── Por qué este test y no `enabled` en cada hook ──
 * `enabled: Boolean(vendedora)` arregla los cuatro que hay hoy y no dice nada
 * del que se agregue mañana. Lo que fija esto es la PROPIEDAD: sin sesión, cero
 * pedidos. Un hook nuevo declarado en el lugar equivocado lo pone rojo, aunque
 * quien lo escribió no supiera que existía esta regla.
 *
 * ── Cómo se cuenta ──
 * Se monta `<App/>` **sin token**, así `useSesion` ni siquiera pregunta
 * `/api/auth/yo` (corta antes: sin token no hay nada que validar), y se dejan
 * correr 90 s de reloj falso — más de un ciclo del más lento de los polls
 * viejos. Cualquier `fetch` que salga es el defecto.
 *
 * ⚠️ Reloj falso ACOTADO a los timers, como en `useAutoguardado.test.tsx`: con
 * todo falseado el scheduler de React no pinta, y `reposar()` no se puede usar
 * porque su `setTimeout(…, 0)` nunca vence.
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

let espia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  relojDeMentira();
  espia = vi.fn(
    async () =>
      new Response('{"ok":false,"message":"el test no levanta server"}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', espia);
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** A dónde se pidió, para que el rojo diga QUÉ hook se coló y no sólo cuántos. */
const urls = () => espia.mock.calls.map(([u]) => String(u));

describe('sin sesión, la app no le pide nada al server', () => {
  it('monta el Login y no dispara un solo pedido', async () => {
    montado = montar(<App />);
    await correrElReloj(0);

    // Es el Login de verdad y no un esqueleto: tiene su caja de usuario.
    expect(montado.contenedor.querySelector('input[placeholder=\'tu usuario\']')).not.toBeNull();
    expect(urls()).toEqual([]);
  });

  /**
   * 90 s: más de un ciclo del más lento de los cuatro polls que corrían acá
   * (la agenda, 60 s). Con el `App` de antes eran ~15 pedidos.
   */
  it('y sigue sin pedir nada después de 90 segundos', async () => {
    montado = montar(<App />);
    await correrElReloj(0);

    await correrElReloj(90_000);

    expect(urls()).toEqual([]);
  });

  /**
   * Y con cinco minutos tampoco: lo que se está fijando no es «tarda en
   * arrancar», es que **no arranca**. Un poll que empieza al minuto y medio se
   * vería igual de bien en el test de arriba.
   */
  it('ni después de cinco minutos', async () => {
    montado = montar(<App />);
    await correrElReloj(0);

    await correrElReloj(5 * 60_000);

    expect(urls()).toEqual([]);
  });
});
