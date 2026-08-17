// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * LOS ✓✓ EN LA BURBUJA.
 *
 * Lo que importa acá no es que el tilde aparezca: es **qué NO dibuja**. Un
 * mensaje sin estado —todos los anteriores a este frente, cuyos recibos pasaron
 * cuando no los escuchábamos— no puede mostrar un ✓, porque sería afirmar una
 * entrega que nadie confirmó. Y un ENTRANTE no lleva tildes nunca: el estado es
 * de lo que mandamos nosotros.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';
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

const saliente = (id: number, texto: string, entrega?: string, entregaMotivo?: string) => ({
  id,
  direccion: 'saliente',
  autor: 'luz',
  texto,
  occurred_at: AHORA,
  external_id: `wa:${id}`,
  ...(entrega ? { entrega } : {}),
  ...(entregaMotivo ? { entregaMotivo } : {}),
});

/** El hover del triángulo cuando el fallo llegó sin código (o de antes de 0028). */
const SIN_MOTIVO = 'WhatsApp rechazó la entrega y no dijo por qué';

function tildes(m: Montado, titulo: string): number {
  return m.contenedor.querySelectorAll(`[title="${titulo}"]`).length;
}

describe('los cuatro estados', () => {
  test('cada uno dibuja lo suyo, y son distinguibles', async () => {
    conMensajes([
      saliente(1, 'Salió', 'enviado'),
      saliente(2, 'Llegó', 'entregado'),
      saliente(3, 'Lo vio', 'leido'),
      saliente(4, 'Rebotó', 'fallido'),
    ]);
    const m = await abrir();
    expect(tildes(m, 'Salió de Hermes')).toBe(1);
    expect(tildes(m, 'Le llegó')).toBe(1);
    expect(tildes(m, 'Lo leyó')).toBe(1);
    expect(tildes(m, SIN_MOTIVO)).toBe(1);
  });
});

/**
 * EL PORQUÉ DEL TRIÁNGULO (17-ago-2026).
 *
 * El triángulo pelado se leía como «no se mandó», y lo que había pasado era lo
 * contrario: el mensaje SALIÓ y WhatsApp lo rechazó. Lo que estos tests fijan es
 * que el motivo esté **escrito**, no colgado de un hover que nadie visita.
 */
describe('por qué no se entregó', () => {
  test('🔴 la ventana de 24 h se dice con todas las letras', async () => {
    // El caso medido: los dos únicos fallos manuales de dos semanas eran este
    // código, y uno se pasó por media hora. Si esto no se lee en la burbuja, la
    // vendedora vuelve a escribir lo mismo y vuelve a rebotar.
    conMensajes([saliente(1, '¿Aún te interesa?', 'fallido', '131047')]);
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('No se entregó');
    expect(m.contenedor.textContent).toContain('más de 24 h');
    // Y dice qué hacer, no solo qué pasó.
    expect(m.contenedor.textContent).toContain('plantilla aprobada');
  });

  test('🔴 un código DESCONOCIDO no inventa una explicación', async () => {
    // Adivinar «probablemente la ventana» es peor que callarse: la vendedora
    // dejaría de escribirle a alguien que sí podía recibir. El código crudo va al
    // hover, que es donde alguien lo puede leer para agregarlo al diccionario.
    conMensajes([saliente(1, 'Hola', 'fallido', '999999')]);
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('No se entregó');
    expect(m.contenedor.textContent).not.toContain('24 h');
    expect(tildes(m, 'WhatsApp rechazó la entrega (código 999999, sin lectura todavía)')).toBe(1);
  });

  test('sin motivo se comporta como antes del frente: triángulo y línea neutra', async () => {
    // Es el caso mayoritario al principio — todo lo anterior a la migración 0028
    // y todo hilo rehidratado del caché de IndexedDB.
    conMensajes([saliente(1, 'Hola', 'fallido')]);
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('No se entregó');
    expect(tildes(m, SIN_MOTIVO)).toBe(1);
  });

  test('🔴 un mensaje que SÍ se entregó no escribe ningún renglón rojo', async () => {
    // El renglón es la única cosa del hilo que pide una acción. Si apareciera en
    // los entregados, dejaría de significar nada.
    conMensajes([saliente(1, 'Llegó', 'entregado', '131047')]);
    const m = await abrir();
    expect(m.contenedor.textContent).not.toContain('No se entregó');
  });
});

describe('lo que NO se dibuja', () => {
  test('🔴 un mensaje SIN estado no muestra ningún tilde', async () => {
    // Todos los mensajes anteriores a este frente están así: sus recibos
    // pasaron cuando no los escuchábamos. Un ✓ ahí afirmaría una entrega que
    // nadie confirmó — y no hay backfill posible.
    conMensajes([saliente(1, 'Mensaje viejo')]);
    const m = await abrir();
    for (const t of ['Salió de Hermes', 'Le llegó', 'Lo leyó', SIN_MOTIVO]) {
      expect(tildes(m, t)).toBe(0);
    }
    expect(m.contenedor.textContent).toContain('Mensaje viejo');
  });

  test('🔴 un ENTRANTE nunca lleva tildes', async () => {
    // El estado es de lo que mandamos nosotros. Aunque el server mandara el
    // campo por error, la burbuja del lead no debe pintarlo.
    conMensajes([
      { id: 1, direccion: 'entrante', autor: TELEFONO, texto: 'Hola', occurred_at: AHORA, external_id: 'wa:1' },
    ]);
    const m = await abrir();
    for (const t of ['Le llegó', 'Lo leyó']) expect(tildes(m, t)).toBe(0);
  });

  test('un server viejo sin el campo sirve el hilo igual', async () => {
    conMensajes([saliente(1, 'Hola'), saliente(2, 'Chau')]);
    const m = await abrir();
    expect(m.contenedor.textContent).toContain('Hola');
    expect(m.contenedor.textContent).toContain('Chau');
  });
});
