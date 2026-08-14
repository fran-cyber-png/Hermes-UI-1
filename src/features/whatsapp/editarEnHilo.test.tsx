// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { escribir, montar, reposar, tocar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';

/**
 * EDITAR UN MENSAJE — corrige el texto que YA SALIÓ, en el propio WhatsApp
 * del lead. A diferencia de Reenviar (que solo carga la caja), esto sí manda
 * un `POST /api/whatsapp/editar`.
 *
 * ── Lo que este test vigila, y por qué se puede perder en un refactor ─────
 * 🔴 **Feature-detectado por `sesion.puedeEditar`.** Es un permiso de
 * protocolo que la Cloud API de Meta no tiene: sin la bandera (el caso de la
 * línea del bot), el botón NO PUEDE estar, o prometería algo que el 409 del
 * server desmentiría después.
 * · Solo en mensajes SALIENTES: nadie edita lo que dijo el lead.
 * · Con la sesión caída, tampoco: el mismo criterio que Reaccionar.
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';
const TEXTO_ORIGINAL = 'El diploma sale S/ 450';
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

const SALIENTE = { id: 1, direccion: 'saliente', autor: 'luz', texto: TEXTO_ORIGINAL, occurred_at: AHORA, external_id: 'wa:1' };
const ENTRANTE = { id: 2, direccion: 'entrante', autor: 'persona', texto: '¿cuánto cuesta?', occurred_at: AHORA, external_id: 'wa:2' };

let montado: Montado | null = null;
let posts: { url: string; body: unknown }[] = [];

function conMensajes(
  mensajesIniciales: Array<Record<string, unknown>>,
  sesion: Record<string, unknown> = { estado: 'conectado', puedeEditar: true },
) {
  posts = [];
  // ESTATEFUL a propósito: `onSettled` invalida la query y dispara un refetch
  // dentro de la misma `reposar()`. Con un mock que siempre devuelve el array
  // original, ese refetch pisaba el update optimista con el texto viejo — el
  // servidor real sí devuelve la edición aplicada, y el mock tiene que hacer
  // lo mismo o el test de «optimista» miente sobre lo que pasa de verdad.
  const mensajes = mensajesIniciales.map((m) => ({ ...m }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        posts.push({ url, body });
        if (url.includes('/api/whatsapp/editar') && body) {
          const fila = mensajes.find((m) => m.external_id === body.mensajeId);
          if (fila) fila.editado = { texto: body.texto, editadoEn: new Date().toISOString() };
        }
      }
      if (url.includes('/api/whatsapp/sesion')) return json({ telefono: NUMERO_PROPIO, ...sesion });
      if (url.includes('/api/whatsapp/conversacion/')) return json({ telefono: TELEFONO, mensajes, origen: null });
      if (url.includes('/api/whatsapp/editar')) return json({ ok: true });
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

function botonesEditar(m: Montado): HTMLButtonElement[] {
  return [...m.contenedor.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.getAttribute('aria-label') === 'Editar este mensaje',
  );
}

describe('editar un mensaje saliente', () => {
  test('🔴 sin `puedeEditar` (Cloud API) el botón no existe', async () => {
    conMensajes([SALIENTE], { estado: 'conectado', puedeEditar: false });
    const m = await abrir();
    expect(botonesEditar(m)).toHaveLength(0);
  });

  test('🔴 un server viejo (sin la bandera) tampoco lo ofrece', async () => {
    conMensajes([SALIENTE], { estado: 'conectado' }); // sin `puedeEditar`
    const m = await abrir();
    expect(botonesEditar(m)).toHaveLength(0);
  });

  test('solo en lo SALIENTE: lo que dijo el lead no se edita', async () => {
    conMensajes([SALIENTE, ENTRANTE]);
    const m = await abrir();
    expect(botonesEditar(m)).toHaveLength(1);
  });

  test('con la sesión caída, tampoco — mismo criterio que Reaccionar', async () => {
    conMensajes([SALIENTE], { estado: 'desconectado', puedeEditar: true });
    const m = await abrir();
    expect(botonesEditar(m)).toHaveLength(0);
  });

  test('tocar Editar abre un editor con el texto actual, cargado', async () => {
    conMensajes([SALIENTE]);
    const m = await abrir();

    tocar(botonesEditar(m)[0]!);
    await reposar();

    const caja = m.contenedor.querySelector('textarea');
    expect(caja).not.toBeNull();
    expect(caja!.value).toBe(TEXTO_ORIGINAL);
  });

  test('Cancelar no manda nada, y cierra el editor (vuelve a quedar solo el composer)', async () => {
    conMensajes([SALIENTE]);
    const m = await abrir();

    // Antes de abrir el editor, la única caja de texto es la del composer.
    expect(m.contenedor.querySelectorAll('textarea')).toHaveLength(1);

    tocar(botonesEditar(m)[0]!);
    await reposar();
    expect(m.contenedor.querySelectorAll('textarea')).toHaveLength(2); // + el editor

    const cancelar = [...m.contenedor.querySelectorAll('button')].find((b) => b.textContent === 'Cancelar');
    tocar(cancelar!);
    await reposar();

    expect(posts.filter((p) => p.url.includes('/editar'))).toEqual([]);
    expect(m.contenedor.querySelectorAll('textarea')).toHaveLength(1); // el editor se fue
  });

  test('Guardar manda el POST con el mensaje, el teléfono y la línea correctos', async () => {
    conMensajes([SALIENTE]);
    const m = await abrir();

    tocar(botonesEditar(m)[0]!);
    await reposar();

    const caja = m.contenedor.querySelector('textarea')!;
    escribir(caja, 'El diploma sale S/ 400');
    const guardar = [...m.contenedor.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar'));
    tocar(guardar!);
    await reposar();

    const orden = posts.find((p) => p.url.includes('/editar'));
    expect(orden?.body).toEqual({
      numeroPropio: NUMERO_PROPIO,
      telefono: TELEFONO,
      mensajeId: 'wa:1',
      texto: 'El diploma sale S/ 400',
    });
  });

  test('optimista: la burbuja muestra el texto nuevo y «Editado» antes de que vuelva el server', async () => {
    conMensajes([SALIENTE]);
    const m = await abrir();

    tocar(botonesEditar(m)[0]!);
    await reposar();
    escribir(m.contenedor.querySelector('textarea')!, 'El diploma sale S/ 400');
    tocar([...m.contenedor.querySelectorAll('button')].find((b) => b.textContent?.includes('Guardar'))!);
    await reposar();

    expect(m.contenedor.textContent).toContain('El diploma sale S/ 400');
    expect(m.contenedor.textContent).toContain('Editado');
  });
});
