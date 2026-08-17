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

const segmentos = (m: Montado) => [...m.contenedor.querySelectorAll('[role="radio"]')];
const puesto = (m: Montado) => segmentos(m).find((b) => b.getAttribute('aria-checked') === 'true');

describe('el chip le pega a /api/bot — el agujero de #389', () => {
  it('pregunta por el estado apenas monta', async () => {
    servidor({ estado: VIVO });
    await abrir();
    expect(pedidos.map((p) => p.url).some((u) => u.includes('/api/bot/estado'))).toBe(true);
  });

  it('muestra los tres modos, con el efectivo puesto', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    expect(segmentos(m).map((b) => b.textContent)).toEqual(['Apagado', 'Sombra', 'Automático']);
    expect(puesto(m)?.textContent).toBe('Automático');
  });

  it('🔴 apagar manda el PUT: es el click que antes era un curl con Bearer a las 2 AM', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    tocar(segmentos(m)[0]!);
    await reposar();

    const put = pedidos.find((p) => p.metodo === 'PUT');
    expect(put?.url).toMatch(/\/api\/bot\/modo$/);
    expect(put?.cuerpo).toEqual({ modo: 'apagado' });
  });

  it('después de escribir RELEE del server: lo que vale es lo que quedó guardado', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    const antes = pedidos.filter((p) => p.url.includes('/api/bot/estado')).length;
    tocar(segmentos(m)[0]!);
    await reposar();
    expect(pedidos.filter((p) => p.url.includes('/api/bot/estado')).length).toBeGreaterThan(antes);
  });

  it('el segmento puesto no se puede volver a tocar (no manda un PUT que no cambia nada)', async () => {
    servidor({ estado: VIVO });
    const m = await abrir();
    expect(puesto(m)).toHaveProperty('disabled', true);
  });
});

describe('🔴 lo ILEGIBLE no se dibuja como apagado', () => {
  it('con el server caído dice «sin señal» y NO deja ningún segmento puesto', async () => {
    servidor({ status: 500 });
    const m = await abrir();

    expect(m.contenedor.textContent).toMatch(/sin señal/i);
    // Lo que no puede pasar de ninguna manera: que se lea «apagado».
    expect(m.contenedor.textContent).not.toMatch(/apagado/i);
    expect(puesto(m)).toBeUndefined();
  });

  it('con el server caído tampoco se ofrece cambiar de modo: no hay de dónde partir', async () => {
    servidor({ status: 500 });
    const m = await abrir();
    expect(segmentos(m)).toHaveLength(0);
  });

  it('sin la migración (`bot_estado` ausente) el bot NO aparece apagado: manda el entorno', async () => {
    // Es lo que contesta el server real sin la tabla: `leerEstadoLinea` degrada a
    // «la base no opina» y el efectivo sale del `.env`.
    servidor({ estado: { ...VIVO, modoDeLaBase: null, modoEfectivo: 'automatico' } });
    const m = await abrir();
    expect(puesto(m)?.textContent).toBe('Automático');
    expect(m.contenedor.textContent).toMatch(/BOT_MODO=automatico/);
  });

  it('un modo que esta app no conoce se dice, y el kill-switch SIGUE sirviendo', async () => {
    servidor({ estado: { ...VIVO, modoEfectivo: 'automatiko' } });
    const m = await abrir();

    expect(m.contenedor.textContent).toMatch(/modo raro/i);
    expect(puesto(m)).toBeUndefined();
    // Los tres destinos siguen ahí: es cuando MÁS falta hace poder apagar.
    expect(segmentos(m)).toHaveLength(3);

    tocar(segmentos(m)[0]!);
    await reposar();
    expect(pedidos.find((p) => p.metodo === 'PUT')?.cuerpo).toEqual({ modo: 'apagado' });
  });

  it('el server SIN la ruta no dibuja nada (front por N4, server por N5)', async () => {
    servidor({ status: 404 });
    const m = await abrir();
    expect(m.contenedor.textContent).toBe('');
  });
});

describe('el freno', () => {
  it('se ve, dice el motivo y se suelta desde acá', async () => {
    servidor({ estado: { ...VIVO, frenado: true, frenadoMotivo: 'temporary_ban' } });
    const m = await abrir();

    // 🔴 El modo sigue puesto en «Automático» —al soltar el freno vuelve ahí— así
    // que sin el rótulo de arriba el chip se leería como «está mandando».
    expect(puesto(m)?.textContent).toBe('Automático');
    expect(m.contenedor.textContent).toMatch(/frenado/i);

    const soltar = m.contenedor.querySelector('button:not([role="radio"])');
    expect(soltar?.textContent).toMatch(/temporary_ban · soltar/);

    tocar(soltar!);
    await reposar();
    const put = pedidos.find((p) => p.metodo === 'PUT');
    expect(put?.url).toMatch(/\/api\/bot\/freno$/);
    expect(put?.cuerpo).toEqual({ frenado: false });
  });
});

describe('🔴 un cambio que FALLÓ no puede parecer aplicado', () => {
  it('el 503 de «falta la tabla» se dice, en vez de dar un OK falso', async () => {
    servidor({ estado: VIVO }, { status: 503 });
    const m = await abrir();

    tocar(segmentos(m)[0]!);
    await reposar();

    expect(m.contenedor.textContent).toMatch(/NO se guardó/);
    expect(m.contenedor.textContent).toMatch(/bot_estado/);
  });
});
