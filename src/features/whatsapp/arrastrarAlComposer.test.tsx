// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';

/**
 * ARRASTRAR UN ARCHIVO AL CHAT — otra vez el CABLEADO, no la decisión.
 *
 * Qué mime entra y qué tope aplica ya está testeado en `pegarAdjunto.test.ts`, y
 * el arrastre no vuelve a decidirlo: comparte la MISMA función pura. Lo que se
 * fija acá es lo que ningún test puro puede ver:
 *
 *  1. que los listeners estén sobre la VENTANA y no sobre un rectángulo — porque
 *     la vendedora suelta el flyer sobre la conversación, no sobre la cajita;
 *  2. 🔴 que el `drop` quede CANCELADO. Sin eso el webview navega al archivo y
 *     ella se queda afuera de Hermes mirando un JPG a pantalla completa. Es un
 *     defecto que no se ve en una captura ni deja rastro en el DOM, así que se
 *     afirma sobre el evento;
 *  3. que un arrastre SIN archivos —el de las tarjetas del Pipeline— no se
 *     cancele, o esto rompería el drag & drop del embudo desde el otro lado de
 *     la app.
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

let montado: Montado | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.includes('/api/whatsapp/sesion')) {
        return new Response(JSON.stringify({ estado: 'conectado', telefono: NUMERO_PROPIO }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/whatsapp/conversacion/')) {
        return new Response(JSON.stringify({ telefono: TELEFONO, mensajes: [], origen: null }), {
          headers: { 'content-type': 'application/json' },
        });
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

async function abrirChat(): Promise<Montado> {
  const m = montar(<HiloWhatsapp conversacion={CONVERSACION} />);
  await reposar();
  montado = m;
  return m;
}

/**
 * Un `DragEvent` con archivos. jsdom no implementa `DataTransfer`, así que se
 * arma el mínimo que el handler lee: `types` y `files`.
 */
function arrastre(tipo: 'dragover' | 'drop' | 'dragleave', archivos: File[] | null): Event {
  const e = new Event(tipo, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: {
      types: archivos ? ['Files'] : ['text/plain'],
      files: archivos ?? [],
    },
  });
  Object.defineProperty(e, 'relatedTarget', { value: null });
  return e;
}

function captura(nombre = 'image.png', tipo = 'image/png', bytes = 1024): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

describe('arrastrar un archivo al chat', () => {
  test('soltar una imagen en cualquier parte de la ventana la deja como adjunto', async () => {
    const m = await abrirChat();

    window.dispatchEvent(arrastre('dragover', [captura()]));
    await reposar();
    // Mientras cuelga del puntero, la pantalla dice dónde va a caer.
    expect(m.contenedor.textContent).toContain('Soltá acá para adjuntarlo');

    window.dispatchEvent(arrastre('drop', [captura()]));
    await reposar();

    // Quedó en la vista previa, con el nombre genérico renombrado por fecha —
    // exactamente lo mismo que hace ⌘V, porque es la misma función.
    expect(m.contenedor.textContent).toMatch(/captura-\d{4}-\d{2}-\d{2}-\d{4}\.png/);
    // Y el resalte se apagó.
    expect(m.contenedor.textContent).not.toContain('Soltá acá para adjuntarlo');
  });

  test('🔴 el drop queda CANCELADO: sin eso el webview navega al archivo', async () => {
    await abrirChat();
    const e = arrastre('drop', [captura()]);
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  test('🔴 un arrastre SIN archivos no se toca — el del Pipeline tiene que seguir andando', async () => {
    await abrirChat();
    const encima = arrastre('dragover', null);
    window.dispatchEvent(encima);
    await reposar();
    expect(encima.defaultPrevented).toBe(false);

    const soltar = arrastre('drop', null);
    window.dispatchEvent(soltar);
    expect(soltar.defaultPrevented).toBe(false);
  });

  test('un archivo conserva su nombre propio, igual que al pegarlo', async () => {
    // El nombre entra en la versión de la pieza (ADR 0022).
    const m = await abrirChat();
    window.dispatchEvent(arrastre('drop', [captura('flyer-agosto-PRECIO-NUEVO.jpg', 'image/jpeg')]));
    await reposar();
    expect(m.contenedor.textContent).toContain('flyer-agosto-PRECIO-NUEVO.jpg');
  });

  test('lo que WhatsApp no manda se rechaza EN PANTALLA, con la misma redacción que ⌘V', async () => {
    const m = await abrirChat();
    window.dispatchEvent(arrastre('drop', [new File(['x'], 'cosas.zip', { type: 'application/zip' })]));
    await reposar();
    expect(m.contenedor.textContent).toContain('imagen, video, audio o PDF');
  });

  test('EN MODO REVISIÓN el aviso llega ANTES de soltar, no después', async () => {
    const m = montar(
      <HiloWhatsapp
        conversacion={CONVERSACION}
        sugerencia={{
          id: 7,
          texto: 'Hola, gracias por escribirnos.',
          campana: null,
          paso: { actual: 1, total: 3 },
          trabajando: false,
          onAprobar: () => {},
          onDescartar: () => {},
        }}
      />,
    );
    montado = m;
    await reposar();

    window.dispatchEvent(arrastre('dragover', [captura()]));
    await reposar();
    // Descubrirlo recién al soltar sería peor: el gesto ya se hizo.
    expect(m.contenedor.textContent).toContain('estás aprobando un texto preparado');
  });
});
