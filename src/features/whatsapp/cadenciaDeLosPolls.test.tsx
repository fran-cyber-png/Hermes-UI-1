// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, type Montado } from '../../pruebas/dom';
import { useConversacionWa, useSesionWa } from './conversacionWa';

/**
 * LOS DOS POLLS DE `conversacionWa.ts`, CONTADOS DE VERDAD.
 *
 * ── Por qué montado y no razonado ──
 * `intervaloDelHilo` e `intervaloDeLaSesion` están testeadas puras en
 * `cadencia.test.ts`. Lo que ningún test puro puede ver es el **cableado**: que
 * el hook le pase el último mensaje y no el primero, que le pase el error de la
 * query y no otra cosa, y sobre todo que TanStack de verdad deje de disparar el
 * timer. La forma que tuvo el defecto original fue exactamente ésa —una opción
 * bien escrita que no producía el efecto que decía— y por eso acá se cuentan
 * `fetch`, que es la unidad en la que el problema se midió: **41.973 pedidos
 * del hilo y 58.429 de la sesión en un día, contra 220 mensajes reales**.
 *
 * ⚠️ Dos trampas del reloj falso, las mismas que `useAutoguardado.test.tsx`:
 * se falsean SOLO los timers (con todo falseado, el scheduler de React no
 * pinta) y **no se puede usar `reposar()`** — su `setTimeout(…, 0)` no vence
 * nunca con el reloj detenido. Acá se asienta adelantando el reloj.
 */

let montado: Montado | null = null;

/** Sólo los timers: `refetchInterval` de TanStack usa `setInterval`. */
function relojDeMentira() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

async function correrElReloj(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const TELEFONO = '51999888777';
const LINEA = '51984429504';

/** Cuántas veces se pidió algo que contiene `parte`. */
function pedidos(espia: ReturnType<typeof vi.fn>, parte: string): number {
  return espia.mock.calls.filter(([url]) => String(url).includes(parte)).length;
}

function servidor(responder: (url: string) => Response) {
  const espia = vi.fn(async (url: string) => responder(String(url)));
  vi.stubGlobal('fetch', espia);
  return espia;
}

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

/** Un hilo cuyo ÚLTIMO mensaje es de hace `haceMs`. El server los sirve ASC. */
function hiloConUltimoDe(haceMs: number) {
  const viejo = new Date(Date.now() - haceMs - 60_000).toISOString();
  const ultimo = new Date(Date.now() - haceMs).toISOString();
  return {
    telefono: TELEFONO,
    origen: null,
    mensajes: [
      { id: 1, direccion: 'entrante', autor: 'lead', texto: 'hola', occurred_at: viejo, external_id: 'wa:1' },
      { id: 2, direccion: 'saliente', autor: 'ana', texto: 'hola!', occurred_at: ultimo, external_id: 'wa:2' },
    ],
  };
}

function AnfitrionHilo() {
  useConversacionWa(TELEFONO);
  return <div>hilo</div>;
}

function AnfitrionSesion({ linea }: { linea?: string }) {
  useSesionWa(linea);
  return <div>sesión</div>;
}

beforeEach(() => {
  localStorage.setItem('hermes.token', 'tok');
  relojDeMentira();
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('el hilo se pide según qué tan viva está la conversación', () => {
  /**
   * 🔴 EL CASO QUE PAGA EL FRENTE. `989270836` se pidió **6.644 veces para UN
   * mensaje**, en una línea muerta hacía 28 días — y 19.234 de los 41.973
   * pedidos del día (46 %) son cinco conversaciones así.
   */
  it('una conversación de hace un mes: un pedido por minuto, no doce', async () => {
    const espia = servidor(() => json(hiloConUltimoDe(30 * 24 * 60 * 60_000)));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);
    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBe(1);

    await correrElReloj(90_000);

    // Con los 5 s de antes serían 19. Con el escalón frío: el inicial + uno por minuto.
    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBe(2);
  });

  it('una conversación de hace media hora: cada 15 s', async () => {
    const espia = servidor(() => json(hiloConUltimoDe(30 * 60_000)));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);

    await correrElReloj(60_000);

    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBe(5); // inicial + 4
  });

  /**
   * Y la conversación que está pasando AHORA conserva los 5 s: acá no se ahorra
   * nada, porque es el único momento en que el poll compite con el push.
   */
  it('una conversación viva conserva los 5 s de siempre', async () => {
    const espia = servidor(() => json(hiloConUltimoDe(10_000)));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);

    await correrElReloj(60_000);

    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBe(13); // inicial + 12
  });

  /**
   * ⚠️ Y el cableado tiene que mirar el ÚLTIMO mensaje, no el primero. El server
   * sirve el hilo ASC (`whatsapp/hilo.ts`), así que leer `mensajes[0]` daría la
   * cadencia de una conversación vieja sobre una que está pasando ahora — un
   * defecto que ningún test puro puede ver y que se lee como «el chat se
   * cuelga».
   */
  it('mira el ÚLTIMO mensaje del hilo, no el primero', async () => {
    // El primero es de hace un mes; el último, de recién.
    const espia = servidor(() =>
      json({
        telefono: TELEFONO,
        origen: null,
        mensajes: [
          {
            id: 1,
            direccion: 'entrante',
            autor: 'lead',
            texto: 'hola',
            occurred_at: new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
            external_id: 'wa:1',
          },
          {
            id: 2,
            direccion: 'entrante',
            autor: 'lead',
            texto: '¿sigue el curso?',
            occurred_at: new Date(Date.now() - 5_000).toISOString(),
            external_id: 'wa:2',
          },
        ],
      }),
    );
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);

    await correrElReloj(30_000);

    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBeGreaterThan(4);
  });

  /**
   * 🔴 UN `refetchInterval` NO PUEDE TIRAR: CORRE ADENTRO DEL RENDER.
   *
   * TanStack lo evalúa en `QueryObserver.setOptions`, que `useBaseQuery` llama
   * **durante el render** — así que una excepción ahí no degrada el poll: se
   * lleva puesta la pantalla entera.
   *
   * Y el tipo no alcanza para garantizarlo. `query.state.data` está declarado
   * `HiloWa | undefined`, pero en runtime puede ser cualquier cosa: una
   * respuesta rehidratada del caché de IndexedDB (ADR 0007) escrita por una
   * versión anterior, o un server que contesta otro cuerpo. Acá se sirve el
   * caso mínimo —un objeto SIN `mensajes`— porque es el que ya rompió: el
   * candado del marcado optimista (`leidoInstantaneo.test.tsx`) usa un stub que
   * contesta `{ok:true,cursor:true}` a TODA URL, incluida la del hilo, y este
   * cableado se cayó con `Cannot read properties of undefined (reading 'at')`.
   *
   * Lo que se fija es que **la sonda sigue viva** y en el escalón más rápido,
   * que es la degradación que la regla promete cuando no se sabe nada.
   */
  it('un cuerpo sin `mensajes` no tumba el render: cae al escalón más rápido', async () => {
    const espia = servidor(() => json({ ok: true, cursor: true }));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);

    // Sigue montada: si `refetchInterval` tirara, el árbol se habría caído.
    expect(montado.contenedor.textContent).toContain('hilo');

    await correrElReloj(30_000);

    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBeGreaterThan(4);
    expect(montado.contenedor.textContent).toContain('hilo');
  });

  it.each([
    ['`mensajes` en null', { telefono: TELEFONO, origen: null, mensajes: null }],
    ['`mensajes` que no es un arreglo', { telefono: TELEFONO, origen: null, mensajes: 'dos' }],
    ['un cuerpo que no es un objeto', 'listo'],
  ])('%s tampoco', async (_que, cuerpo) => {
    servidor(() => json(cuerpo));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);
    await correrElReloj(10_000);

    expect(montado.contenedor.textContent).toContain('hilo');
  });

  /**
   * 🔴 SIN DATOS, EL ESCALÓN MÁS RÁPIDO. Con el server caído el hilo nunca trae
   * `data`, y ahí la cadencia tiene que degradar hacia MÁS frecuente: quedarse
   * en 60 s dejaría el chat sin recuperarse durante un minuto entero después de
   * cada parpadeo.
   */
  it('con el server caído sigue reintentando rápido', async () => {
    const espia = servidor(() => json({ ok: false }, 503));
    montado = montar(<AnfitrionHilo />);
    await correrElReloj(0);

    await correrElReloj(30_000);

    expect(pedidos(espia, '/api/whatsapp/conversacion/')).toBeGreaterThan(4);
  });
});

describe('el estado de la línea', () => {
  /**
   * 🔴 EL 404 SE DEJA DE PEDIR. `esa línea no está corriendo` sólo cambia cuando
   * alguien monta la línea, y **ahí el server lo empuja por el SSE**. El 18-ago
   * eso fueron **19.313 pedidos** que no podían contestar otra cosa.
   */
  it('un 404 se pide UNA vez y no se repregunta nunca más', async () => {
    const espia = servidor(() => json({ ok: false, message: 'esa línea no está corriendo' }, 404));
    montado = montar(<AnfitrionSesion linea={LINEA} />);
    await correrElReloj(0);

    await correrElReloj(5 * 60_000);

    // Uno solo: ni el intervalo ni el `retry: 1` del default global lo repiten.
    expect(pedidos(espia, '/api/whatsapp/sesion')).toBe(1);
  });

  it('una línea que sí corre se repregunta cada minuto, no cada diez segundos', async () => {
    const espia = servidor(() => json({ estado: 'conectado', telefono: LINEA }));
    montado = montar(<AnfitrionSesion linea={LINEA} />);
    await correrElReloj(0);

    await correrElReloj(5 * 60_000);

    // Con los 10 s de antes serían 31.
    expect(pedidos(espia, '/api/whatsapp/sesion')).toBe(6); // inicial + 5
  });

  /**
   * ⚠️ Y un 503 SÍ se sigue repreguntando: una caída se arregla sola, y
   * congelar ahí dejaría el semáforo del header apagado hasta que llegue un
   * evento del stream… que con el server caído tampoco llega.
   */
  it('un 503 se sigue repreguntando: eso sí se arregla solo', async () => {
    const espia = servidor(() => json({ ok: false }, 503));
    montado = montar(<AnfitrionSesion linea={LINEA} />);
    await correrElReloj(0);

    await correrElReloj(3 * 60_000);

    expect(pedidos(espia, '/api/whatsapp/sesion')).toBeGreaterThan(3);
  });

  /**
   * ⚠️ `['wa','sesion','']` y `['wa','sesion',numeroPropio]` son claves
   * DISTINTAS a propósito: la primera es el semáforo global y la segunda
   * gobierna si el composer de ESA conversación deja mandar. Colapsarlas
   * dejaría habilitado el composer de una línea caída porque otra está viva —
   * y no rompe ningún test que mire una sola.
   */
  it('el semáforo global y la línea concreta no comparten caché', async () => {
    const espia = servidor((url) =>
      url.includes('numeroPropio')
        ? json({ ok: false, message: 'esa línea no está corriendo' }, 404)
        : json({ estado: 'conectado', telefono: 'otra' }),
    );
    montado = montar(
      <>
        <AnfitrionSesion />
        <AnfitrionSesion linea={LINEA} />
      </>,
    );
    await correrElReloj(0);

    expect(pedidos(espia, '/api/whatsapp/sesion?')).toBe(1);
    expect(espia.mock.calls.filter(([u]) => /\/api\/whatsapp\/sesion$/.test(String(u)))).toHaveLength(1);
  });
});
