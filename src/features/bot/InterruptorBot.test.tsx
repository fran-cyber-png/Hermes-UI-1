// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { InterruptorBot } from './InterruptorBot';
import type { RespuestaBotApi } from './estado';

/**
 * EL CABLEADO, que es justo lo que faltaba.
 *
 * `estado.ts` estaba escrito y **no lo llamaba nadie**: un `estado.ts` sin
 * consumidor es exactamente la anti-pieza que el issue #389 denuncia. Los tests
 * puros de al lado fijan la decisión; estos fijan que el chip **le pegue de
 * verdad a `/api/bot`** — que era el defecto entero: la ruta montada, la lógica
 * escrita y cero `fetch` saliendo hacia ahí.
 *
 * Por eso lo que se mide acá son las URLs y los cuerpos que salen, y no cómo se
 * ve: una regresión de cableado no la puede ver ningún test puro.
 *
 * ⚠️ **20-ago-2026: el selector pasó de tres segmentos (`role="radio"`) a un
 * solo botón circular que avanza un escalón por clic** (apagado → sombra →
 * automático → apagado). `anillo()` reemplaza a los viejos `segmentos()`/
 * `puesto()`: ya no hay «el segmento activo» que buscar, solo un botón cuyo
 * `aria-label` dice el modo actual y a cuál pasa el próximo clic.
 */

let montado: Montado | null = null;
let pedidos: { url: string; metodo: string; cuerpo: unknown }[] = [];

/** Qué contesta `GET /api/bot/estado` en este caso. */
type Respuesta = { estado: RespuestaBotApi } | { status: number };

function servidor(get: Respuesta, escritura: { status: number } = { status: 200 }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      pedidos.push({
        url,
        metodo: init?.method ?? 'GET',
        cuerpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const cabeceras = { 'content-type': 'application/json' };
      if (url.includes('/api/bot/estado')) {
        if ('status' in get) return new Response('{}', { status: get.status, headers: cabeceras });
        return new Response(JSON.stringify(get.estado), { headers: cabeceras });
      }
      if (url.includes('/api/bot/')) {
        return new Response(JSON.stringify({ error: 'sin_tabla' }), {
          status: escritura.status,
          headers: cabeceras,
        });
      }
      return new Response('{}', { status: 404, headers: cabeceras });
    }),
  );
}

const VIVO: RespuestaBotApi = {
  numero: '51984429504',
  habilitada: true,
  modoEfectivo: 'automatico',
  modoDeLaBase: null,
  modoDelEntorno: 'automatico',
  frenado: false,
  frenadoMotivo: null,
};

beforeEach(() => {
  pedidos = [];
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

/**
 * ⚠️ Se espera hasta que el esqueleto se vaya, no un turno fijo.
 *
 * El chip arranca en `cargando` y la respuesta llega varios turnos después
 * (fetch → parseo → repintado de TanStack). Con un solo `reposar()` el mismo caso
 * pasaba unas veces y otras no: el test quedaba verde o rojo por el motivo
 * equivocado, midiendo el esqueleto en vez del chip.
 */
async function abrir(): Promise<Montado> {
  const m = montar(<InterruptorBot />);
  montado = m;
  for (let i = 0; i < 20 && m.contenedor.querySelector('.animate-pulse'); i++) await reposar();
  return m;
}

/** El único botón del anillo — `null` cuando `puedeCambiar` es falso. */
const anillo = (m: Montado) => m.contenedor.querySelector('button[aria-label*="Modo del bot"]');

describe('el chip le pega a /api/bot — el agujero de #389', () => {
  it('pregunta por el estado apenas monta', async () => {
    servidor({ estado: VIVO });
    await abrir();
    expect(pedidos.map((p) => p.url).some((u) => u.includes('/api/bot/estado'))).toBe(true);
  });

  it('el anillo dice el modo efectivo y a cuál pasa el próximo clic', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    const boton = anillo(m);
    expect(boton).not.toBeNull();
    // VIVO trae `automatico`: el ciclo (apagado → sombra → automático → apagado)
    // vuelve a apagado.
    expect(boton?.getAttribute('aria-label')).toMatch(/Automático/);
    expect(boton?.getAttribute('aria-label')).toMatch(/pasar a Apagado/);
  });

  it('🔴 apagar manda el PUT: es el click que antes era un curl con Bearer a las 2 AM', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    tocar(anillo(m)!);
    await reposar();

    const put = pedidos.find((p) => p.metodo === 'PUT');
    expect(put?.url).toMatch(/\/api\/bot\/modo$/);
    expect(put?.cuerpo).toEqual({ modo: 'apagado' });
  });

  it('después de escribir RELEE del server: lo que vale es lo que quedó guardado', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    const antes = pedidos.filter((p) => p.url.includes('/api/bot/estado')).length;
    tocar(anillo(m)!);
    await reposar();
    expect(pedidos.filter((p) => p.url.includes('/api/bot/estado')).length).toBeGreaterThan(antes);
  });

  // 🔴 El test viejo («el segmento activo no se puede volver a tocar») medía una
  // trampa que ya no existe: con tres botones sueltos, tocar el que YA estaba
  // puesto mandaba un PUT que no cambiaba nada. Un solo botón que avanza un
  // escalón no puede pedir el valor donde ya está — `siguiente` siempre es
  // OTRO modo — así que la garantía queda en el diseño del control, no en un
  // `disabled` que haya que probar.
});

describe('🔴 lo ILEGIBLE no se dibuja como apagado', () => {
  it('con el server caído dice «sin señal» y el anillo no queda con ningún modo puesto', async () => {
    servidor({ status: 500 });
    const m = await abrir();

    expect(m.contenedor.textContent).toMatch(/sin señal/i);
    // Lo que no puede pasar de ninguna manera: que se lea «apagado».
    expect(m.contenedor.textContent).not.toMatch(/apagado/i);
    expect(anillo(m)).toBeNull();
  });

  it('con el server caído tampoco se ofrece cambiar de modo: no hay de dónde partir', async () => {
    servidor({ status: 500 });
    const m = await abrir();
    expect(anillo(m)).toBeNull();
  });

  it('sin la migración (`bot_estado` ausente) el bot NO aparece apagado: manda el entorno', async () => {
    // Es lo que contesta el server real sin la tabla: `leerEstadoLinea` degrada a
    // «la base no opina» y el efectivo sale del `.env`.
    servidor({ estado: { ...VIVO, modoDeLaBase: null, modoEfectivo: 'automatico' } });
    const m = await abrir();
    expect(anillo(m)?.getAttribute('aria-label')).toMatch(/Automático/);
  });

  it('un modo que esta app no conoce se dice, y el kill-switch SIGUE sirviendo', async () => {
    servidor({ estado: { ...VIVO, modoEfectivo: 'automatiko' } });
    const m = await abrir();

    // El anillo sigue ahí — es cuando MÁS falta hace poder apagar — pero sin
    // modo legible arranca vacío, como apagado.
    const boton = anillo(m);
    expect(boton).not.toBeNull();
    expect(boton?.getAttribute('aria-label')).toMatch(/sin modo puesto/);

    tocar(boton!);
    await reposar();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.cuerpo).toEqual({ modo: 'apagado' });
  });

  it('el server SIN la ruta no dibuja nada (front por N4, server por N5)', async () => {
    servidor({ status: 404 });
    const m = await abrir();
    expect(m.contenedor.textContent).toBe('');
  });
});

// 🔴 **La UI de soltar el freno se retiró con el recorte a solo-anillo**
// (20-ago-2026, pedido explícito del dueño). Antes «el freno» tenía su propio
// describe acá: probaba el rótulo rojo «frenado», el botón «temporary_ban ·
// soltar» y el PUT a `/api/bot/freno` que dispara. **Ese botón ya no existe en
// ningún lado del header** — con el bot frenado, el anillo se ve y se comporta
// exactamente igual que sin frenar (mismo `aria-label`, mismo ciclo), y no hay
// forma de soltar el freno desde acá. La única cobertura que sigue teniendo
// sentido es que el anillo no se rompe con `frenado:true`:
describe('el freno', () => {
  it('con el bot frenado, el anillo sigue mostrando el modo y sigue siendo clickeable', async () => {
    servidor({ estado: { ...VIVO, frenado: true, frenadoMotivo: 'temporary_ban' } });
    const m = await abrir();

    // 🔴 El modo sigue puesto en «Automático» —al soltar el freno (ahora
    // imposible desde acá) volvería ahí—, y sin el aviso rojo que existía
    // antes, esto se lee como «está mandando». Es el costo aceptado del recorte.
    expect(anillo(m)?.getAttribute('aria-label')).toMatch(/Automático/);
    expect(anillo(m)).not.toBeNull();
  });
});

// 🔴 **El aviso visible de «NO se guardó» también se retiró con el mismo
// recorte.** Antes esta prueba comprobaba que un 503 al guardar se LEÍA en
// pantalla («NO se guardó: falta bot_estado»); ahora esa lectura no existe en
// ningún lado del DOM — el único rastro es la consulta de `/api/bot/estado`
// que `onSettled` dispara igual, tenga éxito o no el PUT. Lo que queda para
// probar es que un fallo no deja el anillo en un estado roto ni finge que
// cambió (relee del server, que sigue diciendo el modo de antes).
describe('🔴 un cambio que FALLÓ no puede parecer aplicado', () => {
  it('el 503 de «falta la tabla» no rompe el anillo ni finge que el modo cambió', async () => {
    servidor({ estado: VIVO }, { status: 503 });
    const m = await abrir();

    tocar(anillo(m)!);
    await reposar();

    // Relee del server pase lo que pase (onSettled): el modo sigue siendo el
    // de VIVO, «Automático» — nunca lo que el clic pedía.
    expect(anillo(m)?.getAttribute('aria-label')).toMatch(/Automático/);
  });
});
