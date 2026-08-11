// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';

/**
 * LAS REACCIONES, DIBUJADAS — y sobre todo, NO dibujadas como un mensaje.
 *
 * El defecto que esto vigila no es que falte el emoji: es que vuelva a
 * aparecer como burbuja. Durante meses las reacciones se descartaron enteras
 * porque entraban a `interactions` y la UI las pintaba como un mensaje vacío
 * que decía «(no es texto)» (#70). Un contacto que solo había reaccionado
 * aparecía con un mensaje fantasma.
 *
 * Por eso el test más importante de acá es el que cuenta BURBUJAS.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';

const CONVERSACION = {
  clave: `conv:whatsapp:${TELEFONO}:${NUMERO_PROPIO}`,
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: TELEFONO,
  persona_nombre: 'Javier',
  numero_propio: NUMERO_PROPIO,
  texto: 'hola',
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 1,
  referencia: 'r1',
  ultimo_at: new Date().toISOString(),
  dias: 0,
  nivel: 0,
} as Conversacion;

const AHORA = new Date().toISOString();

let montado: Montado | null = null;

function conMensajes(mensajes: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: 'conectado', telefono: NUMERO_PROPIO });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes, origen: null });
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

async function abrir(): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} />);
  await reposar();
  montado = m;
  return m;
}

/** Las burbujas de mensaje del hilo, por su forma redondeada característica. */
function burbujas(m: Montado): number {
  return m.contenedor.querySelectorAll('.rounded-br-md, .rounded-bl-md').length;
}

describe('reacciones en el hilo', () => {
  beforeEach(() => {
    conMensajes([
      {
        id: 1,
        direccion: 'saliente',
        autor: 'luz',
        texto: 'Te paso el temario',
        occurred_at: AHORA,
        external_id: 'wa:1',
        reacciones: [{ emoji: '👍', nuestra: false }],
      },
      { id: 2, direccion: 'entrante', autor: TELEFONO, texto: 'Gracias', occurred_at: AHORA, external_id: 'wa:2' },
    ]);
  });

  test('el emoji se ve', async () => {
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('👍');
  });

  test('🔴 una reacción NO agrega una burbuja al hilo', async () => {
    // Dos mensajes → dos burbujas. Si la reacción se dibujara como mensaje
    // serían tres, y la tercera diría «(no es texto)».
    const m = await abrir();
    expect(burbujas(m)).toBe(2);
    expect(m.contenedor.textContent).not.toContain('no es texto');
  });
});

describe('cómo se agrupan y de quién son', () => {
  test('el mismo emoji dos veces se cuenta, no se repite', async () => {
    conMensajes([
      {
        id: 1,
        direccion: 'entrante',
        autor: TELEFONO,
        texto: 'Perfecto',
        occurred_at: AHORA,
        external_id: 'wa:1',
        reacciones: [
          { emoji: '🙌', nuestra: false },
          { emoji: '🙌', nuestra: true },
        ],
      },
    ]);
    const m = await abrir();
    const texto = m.contenedor.textContent ?? '';
    expect(texto).toContain('🙌');
    expect(texto).toContain('2');
    // Una sola píldora, no dos.
    expect((texto.match(/🙌/g) ?? []).length).toBe(1);
  });

  test('la reacción propia se distingue de la del lead', async () => {
    conMensajes([
      {
        id: 1,
        direccion: 'entrante',
        autor: TELEFONO,
        texto: 'Gracias',
        occurred_at: AHORA,
        external_id: 'wa:1',
        reacciones: [{ emoji: '❤️', nuestra: true }],
      },
    ]);
    const m = await abrir();
    const propia = [...m.contenedor.querySelectorAll('span[title]')].find(
      (e) => e.getAttribute('title') === 'Reaccionaste vos',
    );
    expect(propia).toBeTruthy();
  });
});

describe('degradación', () => {
  test('🔴 un server sin reacciones sirve el hilo igual', async () => {
    // El campo es opcional a propósito: un server viejo no lo manda y la
    // migración puede no estar aplicada. Sin él, el hilo es el de siempre.
    conMensajes([
      { id: 1, direccion: 'entrante', autor: TELEFONO, texto: 'Hola', occurred_at: AHORA, external_id: 'wa:1' },
    ]);
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('Hola');
    expect(burbujas(m)).toBe(1);
  });

  test('un array vacío no dibuja una píldora fantasma', async () => {
    conMensajes([
      {
        id: 1,
        direccion: 'entrante',
        autor: TELEFONO,
        texto: 'Hola',
        occurred_at: AHORA,
        external_id: 'wa:1',
        reacciones: [],
      },
    ]);
    const m = await abrir();
    expect(m.contenedor.querySelectorAll('span[title^="Reaccion"]').length).toBe(0);
  });
});
