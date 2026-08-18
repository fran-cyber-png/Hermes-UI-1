// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import type { Conversacion } from '../../dominio/conversaciones';
import { FichaRapida } from './FichaRapida';

/**
 * EL CABLEADO DEL REGISTRO RÁPIDO — lo que ningún test puro puede ver.
 *
 * `prellenar` está testeada aparte (`fichaLocal.test.ts`); lo que se fija acá es
 * que ese prellenado LLEGUE A LOS CAMPOS y que lo que se guarda sea lo que la
 * vendedora ve. Un formulario que calcula bien y pinta vacío se lee, en la
 * pantalla, exactamente igual que uno roto.
 */

const CONVERSACION: Conversacion = {
  clave: 'conv:whatsapp:51984429504:51955950559',
  canal: 'whatsapp',
  tipo: 'mensaje',
  persona_id: '51955950559',
  persona_nombre: 'Jorge Martin - JM RUSH AUTOMOTRIZ',
  numero_propio: '51984429504',
  texto: null,
  contexto_texto: null,
  respondida: false,
  ventana_abierta: true,
  pregunto: false,
  n: 1,
  referencia: '2026-08-18T16:09:00.000Z',
  ultimo_at: '2026-08-18T16:09:00.000Z',
  dias: 0,
  nivel: 5,
};

let montado: Montado | null = null;
let pedidos: { url: string; body: unknown }[] = [];

beforeEach(() => {
  pedidos = [];
  // Nadie está registrado y Cerberus no contesta: el caso normal de un lead
  // nuevo, que es justamente cuando este drawer tiene que servir solo.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).includes('/api/contactos/registro')) {
        return new Response(JSON.stringify({ ficha: null }), { status: 200 });
      }
      return new Response('{}', { status: 503 });
    }),
  );
});

afterEach(() => {
  montado?.desmontar();
  montado = null;
  vi.unstubAllGlobals();
});

function campo(m: Montado, etiqueta: string): HTMLInputElement {
  const i = m.contenedor.querySelector<HTMLInputElement>(`input[aria-label="${etiqueta}"]`);
  if (!i) throw new Error(`no encontré el campo «${etiqueta}»`);
  return i;
}

describe('FichaRapida', () => {
  test('abre con lo que el chat ya sabe: nombre, apellido, empresa y teléfono', async () => {
    montado = montar(<FichaRapida conversacion={CONVERSACION} onCerrar={() => {}} />);
    await reposar();

    expect(campo(montado, 'Nombre').value).toBe('Jorge');
    expect(campo(montado, 'Apellido').value).toBe('Martin');
    expect(campo(montado, 'Empresa').value).toBe('JM RUSH AUTOMOTRIZ');
    expect(campo(montado, 'Teléfono').value).toBe('51955950559');
  });

  test('guardar manda la clave de la conversación y lo que está en pantalla', async () => {
    const alCerrar = vi.fn();
    montado = montar(<FichaRapida conversacion={CONVERSACION} onCerrar={alCerrar} />);
    await reposar();

    const boton = [...montado.contenedor.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Registrar contacto',
    );
    boton!.click();
    await reposar();

    const post = pedidos.find((p) => p.body != null);
    expect(post?.body).toMatchObject({
      clave: CONVERSACION.clave,
      nombre: 'Jorge',
      apellido: 'Martin',
      empresa: 'JM RUSH AUTOMOTRIZ',
      telefono: '51955950559',
    });
  });

  test('sin nombre ni teléfono el botón no deja guardar: una ficha vacía no es una ficha', async () => {
    montado = montar(
      <FichaRapida
        conversacion={{ ...CONVERSACION, persona_id: null, persona_nombre: null }}
        onCerrar={() => {}}
      />,
    );
    await reposar();

    const boton = [...montado.contenedor.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Registrar contacto',
    );
    expect(boton?.disabled).toBe(true);
  });
});
