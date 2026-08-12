// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { escribir, montar, reposar, teclear, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';
import { limpiarPiezas } from './procedenciaComposer';

/**
 * EL `/` EN LA CAJA — el CABLEADO, que es donde vive el defecto que importa.
 *
 * `comandoBarra.ts` ya está testeado puro (cuándo hay comando, qué se ofrece,
 * cómo se reemplaza). Lo que ningún test puro puede ver es lo de acá, y hay uno
 * que se lleva todo el peso:
 *
 * 🔴 **Enter con el selector abierto NO puede mandar el mensaje.** En el composer
 * Enter envía, así que si la rama del selector no va primero, elegir con Enter le
 * dispara al lead lo que haya en la caja —incluido el `/cuo` a medio escribir—.
 * El síntoma lo tiene el lead y acá no se ve nada.
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

const HECHOS = [
  { clave: 'cuotas', rotulo: 'Dos cuotas', texto: 'Se puede pagar en dos cuotas sin interés.', momentos: [], orden: 1, activo: true },
  { clave: 'acceso', rotulo: 'Acceso un año', texto: 'El acceso lo tenés por todo un año.', momentos: [], orden: 2, activo: true },
  { clave: 'apagada', rotulo: 'Vieja', texto: 'Frase que ya no se usa.', momentos: [], orden: 3, activo: false },
];

let montado: Montado | null = null;
let enviados: Record<string, unknown>[] = [];

beforeEach(() => {
  enviados = [];
  limpiarPiezas();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const json = (c: unknown) => new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion')) return json({ estado: 'conectado', telefono: NUMERO_PROPIO });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes: [], origen: null });
      if (url.includes('/api/hechos/catalogo')) return json({ hechos: HECHOS, editable: true, origen: 'tabla' });
      if (url.includes('/api/whatsapp/enviar')) {
        enviados.push(JSON.parse(String(init?.body ?? '{}')));
        return json({ ok: true, idExterno: 'wa:1' });
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

async function abrir(sugerencia?: Parameters<typeof HiloWhatsapp>[0]['sugerencia']): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} sugerencia={sugerencia} />);
  await reposar();
  montado = m;
  return m;
}

const caja = (m: Montado) => m.contenedor.querySelector('textarea')!;
const selector = (m: Montado) => m.contenedor.querySelector('[role="listbox"]');
const opciones = (m: Montado) => [...m.contenedor.querySelectorAll('[role="option"]')];

/** Escribe y avisa dónde quedó el cursor, como haría el navegador. */
async function tipear(m: Montado, valor: string) {
  const t = caja(m);
  escribir(t, valor);
  t.selectionStart = valor.length;
  t.dispatchEvent(new Event('select', { bubbles: true }));
  await reposar();
}

describe('abrir las respuestas rápidas con /', () => {
  test('la barra sola abre el selector con TODO el catálogo activo', async () => {
    const m = await abrir();
    await tipear(m, '/');
    expect(selector(m)).toBeTruthy();
    // Las activas y solo las activas: la apagada no se ofrece.
    expect(opciones(m)).toHaveLength(2);
    expect(m.contenedor.textContent).not.toContain('Frase que ya no se usa');
  });

  test('tipear filtra, y muestra el atajo para que se aprenda', async () => {
    const m = await abrir();
    await tipear(m, '/cuo');
    expect(opciones(m)).toHaveLength(1);
    expect(m.contenedor.textContent).toContain('/cuotas');
  });

  test('🔴 una URL no abre nada: el selector no puede saltar mientras se pega un link', async () => {
    const m = await abrir();
    await tipear(m, 'te dejo https://pagos.goberna.us/x');
    expect(selector(m)).toBeNull();
  });

  test('lo que no coincide dice QUÉ se buscó, en vez de parecer un catálogo vacío', async () => {
    const m = await abrir();
    await tipear(m, '/zzz');
    expect(selector(m)).toBeTruthy();
    expect(opciones(m)).toHaveLength(0);
    expect(m.contenedor.textContent).toContain('/zzz');
  });

  test('EN MODO REVISIÓN no se abre: ahí la caja es para aprobar, no para escribir', async () => {
    const m = await abrir({
      id: 7,
      texto: 'Hola, gracias por escribirnos.',
      campana: null,
      paso: { actual: 1, total: 3 },
      trabajando: false,
      onAprobar: () => {},
      onDescartar: () => {},
    });
    await tipear(m, '/');
    expect(selector(m)).toBeNull();
  });
});

describe('elegir con el teclado', () => {
  test('🔴 Enter ELIGE y NO manda el mensaje', async () => {
    // El defecto que este test existe para impedir: abajo Enter envía. Sin la
    // rama del selector primero, elegir con Enter le manda al lead el `/cuo`.
    const m = await abrir();
    await tipear(m, '/cuo');
    teclear('Enter', { target: caja(m) });
    await reposar();

    expect(enviados).toHaveLength(0);
    expect(caja(m).value).toBe('Se puede pagar en dos cuotas sin interés.');
    expect(selector(m)).toBeNull();
  });

  test('las flechas mueven la marca y Enter toma la marcada', async () => {
    const m = await abrir();
    await tipear(m, '/');
    teclear('ArrowDown', { target: caja(m) });
    await reposar();
    teclear('Enter', { target: caja(m) });
    await reposar();
    expect(caja(m).value).toBe('El acceso lo tenés por todo un año.');
  });

  test('la respuesta se inserta DONDE estaba el comando, sin pisar lo escrito', async () => {
    const m = await abrir();
    await tipear(m, 'Hola Javier, /cuo');
    teclear('Enter', { target: caja(m) });
    await reposar();
    expect(caja(m).value).toBe('Hola Javier, Se puede pagar en dos cuotas sin interés.');
  });

  test('Escape cierra y se lleva el /loquesea: no deja basura en la caja', async () => {
    const m = await abrir();
    await tipear(m, 'Hola /cuo');
    teclear('Escape', { target: caja(m) });
    await reposar();
    expect(selector(m)).toBeNull();
    expect(caja(m).value).toBe('Hola ');
  });
});

describe('la procedencia', () => {
  test('🔴 el envío declara de qué frase salió, y que se editó', async () => {
    // Sin esto la frase sale como línea de base y no se puede medir nunca — que
    // es lo que viene pasando desde que el panel se rediseñó y dejó huérfanos a
    // los dos bloques que ponían texto en la caja.
    const m = await abrir();
    await tipear(m, '/cuo');
    teclear('Enter', { target: caja(m) });
    await reposar();

    const t = caja(m);
    await tipear(m, `${t.value} ¿te sirve?`);
    teclear('Enter', { target: caja(m) });
    await reposar();

    expect(enviados).toHaveLength(1);
    expect(enviados[0].pieza).toMatchObject({ clase: 'hecho', ref: 'cuotas', via: 'panel-datos', editada: true });
  });
});
