// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import { leerBorrador } from './borradorComposer';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * REENVIAR UN MENSAJE — deja el texto en la caja, NO lo manda.
 *
 * ── Qué se fija acá, y por qué se puede perder en un refactor ─────────────
 *
 * 🔴 **Que NO envíe.** Un botón que reenvía de un clic sería un envío sin
 * persona decidiéndolo, y eso cruza ADR 0015 §37 («un envío = una acción
 * humana»). El test mira que después de tocarlo no haya salido ningún `POST`
 * de envío: si alguien "mejora" esto conectándolo a la mutación, se pone rojo.
 *
 * · Va en los **dos sentidos**, como Copiar: repetir lo que dijo el lead es tan
 *   útil como repetir lo nuestro.
 * · **No mira la sesión**: escribir en la caja no manda nada, así que con la
 *   línea caída sigue sirviendo. (Reaccionar sí la mira, y esa asimetría es la
 *   decisión — ver el bloque de acciones de `HiloWhatsapp`.)
 * · **Sin texto no se dibuja**: reenviar la cadena vacía parecería que anduvo.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';
const TEXTO_SALIENTE = 'El diploma sale S/ 450 y se puede pagar en dos cuotas.';
const TEXTO_ENTRANTE = '¿Me pasás el link de pago?';
const AHORA = new Date().toISOString();

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
  ultimo_at: AHORA,
  dias: 0,
  nivel: 0,
} as Conversacion;

const SALIENTE = { id: 1, direccion: 'saliente', autor: 'luz', texto: TEXTO_SALIENTE, occurred_at: AHORA, external_id: 'wa:1' };
const ENTRANTE = { id: 2, direccion: 'entrante', autor: 'persona', texto: TEXTO_ENTRANTE, occurred_at: AHORA, external_id: 'wa:2' };
const SIN_TEXTO = { id: 3, direccion: 'saliente', autor: 'luz', texto: null, occurred_at: AHORA, external_id: 'wa:3' };

let montado: Montado | null = null;
/** Todo lo que la app mandó por POST — el test de «no envía» se apoya acá. */
let posts: string[] = [];

function conMensajes(mensajes: unknown[], estadoSesion = 'conectado') {
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') posts.push(url);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: estadoSesion, telefono: NUMERO_PROPIO });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes, origen: null });
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
}

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function abrir(): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} />);
  await reposar();
  montado = m;
  return m;
}

function botonesReenviar(m: Montado): HTMLButtonElement[] {
  return [...m.contenedor.querySelectorAll<HTMLButtonElement>('button')].filter((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith('Reenviar'),
  );
}

describe('reenviar un mensaje del hilo', () => {
  test('🔴 deja el texto en la caja y NO manda nada', async () => {
    conMensajes([SALIENTE]);
    const m = await abrir();

    tocar(botonesReenviar(m)[0]!);
    await reposar();

    expect(leerBorrador(TELEFONO)).toBe(TEXTO_SALIENTE);
    expect(posts.filter((u) => u.includes('/enviar'))).toEqual([]);
  });

  test('va en los DOS sentidos: también se reenvía lo que dijo el lead', async () => {
    conMensajes([SALIENTE, ENTRANTE]);
    const m = await abrir();

    expect(botonesReenviar(m)).toHaveLength(2);

    tocar(botonesReenviar(m)[1]!);
    await reposar();
    expect(leerBorrador(TELEFONO)).toBe(TEXTO_ENTRANTE);
  });

  test('sin texto no se dibuja: reenviar la cadena vacía parecería que anduvo', async () => {
    conMensajes([SIN_TEXTO]);
    const m = await abrir();
    expect(botonesReenviar(m)).toHaveLength(0);
  });

  test('con la sesión caída sigue estando: escribir en la caja no manda nada', async () => {
    conMensajes([SALIENTE], 'desconectado');
    const m = await abrir();

    expect(botonesReenviar(m)).toHaveLength(1);
    tocar(botonesReenviar(m)[0]!);
    await reposar();
    expect(leerBorrador(TELEFONO)).toBe(TEXTO_SALIENTE);
  });
});
