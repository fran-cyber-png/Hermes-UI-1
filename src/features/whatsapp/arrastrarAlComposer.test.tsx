// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

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
/** Lo que salió por `/enviar-media`. Sin esto no se puede afirmar que el drop MANDA. */
let enviosMedia: { nombre: string | null; caption: string | null }[] = [];

beforeEach(() => {
  enviosMedia = [];
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
      if (url.includes('/api/whatsapp/enviar-media')) {
        const q = new URL(url, 'http://x').searchParams;
        enviosMedia.push({ nombre: q.get('nombre'), caption: q.get('caption') });
        return new Response(JSON.stringify({ ok: true, idExterno: 'wa:1' }), {
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
/**
 * `tipos` distingue los tres arrastres que importan:
 *   `'archivos'` — del Finder, el caso real;
 *   `'url'`      — desde una web: NO trae `File`, y es el que hacía navegar el webview;
 *   `'dom'`      — el de las tarjetas del Pipeline, que no se toca.
 */
function arrastre(
  tipo: 'dragover' | 'drop' | 'dragleave',
  archivos: File[] | null,
  tipos: 'archivos' | 'url' | 'dom' = archivos ? 'archivos' : 'dom',
): Event {
  const e = new Event(tipo, { bubbles: true, cancelable: true });
  const porTipo = { archivos: ['Files'], url: ['text/uri-list', 'text/plain'], dom: ['text/plain'] };
  Object.defineProperty(e, 'dataTransfer', {
    value: { types: porTipo[tipos], files: archivos ?? [] },
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
    expect(m.contenedor.textContent).toContain('Soltá el archivo acá');

    window.dispatchEvent(arrastre('drop', [captura()]));
    await reposar();

    // Quedó en la vista previa, con el nombre genérico renombrado por fecha —
    // exactamente lo mismo que hace ⌘V, porque es la misma función.
    expect(m.contenedor.textContent).toMatch(/captura-\d{4}-\d{2}-\d{2}-\d{4}\.png/);
    // Y el resalte se apagó.
    expect(m.contenedor.textContent).not.toContain('Soltá el archivo acá');
  });

  test('🔴 el cartel TAPA EL CHAT ENTERO, no una franja sobre el composer', async () => {
    const m = await abrirChat();
    window.dispatchEvent(arrastre('dragover', [captura()]));
    await reposar();

    /**
     * Era una tirita de dos renglones encima de la caja de texto: arrastrando
     * sobre la mitad de arriba del hilo no reaccionaba NADA, y eso se lee como
     * «acá no se puede». El área que responde tiene que ser la que la persona
     * apunta, o sea la columna completa.
     *
     * jsdom no hace layout, así que no se puede medir el rectángulo. Lo que sí
     * se fija es el mecanismo: el cartel es `absolute inset-0` sobre el
     * contenedor del chat, no un hermano del composer.
     */
    const cartel = m.contenedor.querySelector('[data-arrastre-chat]') as HTMLElement;
    expect(cartel, 'no se dibujó el cartel').toBeTruthy();
    expect(cartel.className).toContain('absolute');
    expect(cartel.className).toContain('inset-0');
    expect(cartel.closest('footer'), 'sigue colgando del composer').toBeNull();
  });

  test('🔴 el cartel NO recibe eventos, o rompería el arrastre que anuncia', async () => {
    const m = await abrirChat();
    window.dispatchEvent(arrastre('dragover', [captura()]));
    await reposar();

    /**
     * Los tres listeners viven en `window` y el `drop` decide mirando
     * `e.target`. Con el overlay recibiendo eventos, el `target` de cada
     * `dragover` pasaría a ser ÉL: la guarda `enUnaCaja` —la que deja arrastrar
     * un link adentro del composer— dejaría de reconocer la caja de texto, y el
     * `dragleave` al entrar al overlay haría parpadear el cartel sin parar.
     */
    const cartel = m.contenedor.querySelector('[data-arrastre-chat]') as HTMLElement;
    expect(cartel.className).toContain('pointer-events-none');
  });

  test('el cartel dice a QUIÉN le va a llegar', async () => {
    const m = await abrirChat();
    window.dispatchEvent(arrastre('dragover', [captura()]));
    await reposar();
    // La misma promesa que el pie del composer: se manda a una persona, no en
    // masa. Al soltar un archivo sin querer, eso es lo que hay que haber leído.
    expect(m.contenedor.textContent).toContain('Javier');
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

  test('🔴 soltar una foto SIN escribir nada y mandarla con el botón — el caso real', async () => {
    // Es lo que el dueño pidió con «y que se pueda enviar también»: arrastra una
    // imagen y no escribe una palabra. Si el botón exigiera texto, acá quedaría
    // muerto y el síntoma sería exactamente ése.
    const m = await abrirChat();
    window.dispatchEvent(arrastre('drop', [captura('flyer-agosto.jpg', 'image/jpeg')]));
    await reposar();

    const enviar = [...m.contenedor.querySelectorAll('button')].find(
      (b) => b.getAttribute('title') === 'Enviar' || b.getAttribute('aria-label') === 'Enviar',
    );
    expect(enviar, 'no encontré el botón de enviar').toBeTruthy();
    expect(enviar!.disabled, 'el botón tiene que estar vivo con adjunto y sin texto').toBe(false);

    enviar!.click();
    await reposar();

    expect(enviosMedia).toHaveLength(1);
    expect(enviosMedia[0].nombre).toBe('flyer-agosto.jpg');
    expect(enviosMedia[0].caption).toBeNull();
  });

  test('🔴 soltar y mandar con Enter: el drop deja el foco en la caja', async () => {
    // ⌘V no necesita enfocar porque su handler VIVE en el textarea. El drop
    // escucha en la ventana, así que sin un `focus()` explícito Enter no llega
    // al handler y el reflejo «soltar y apretar Enter» falla mudo.
    const m = await abrirChat();
    const otro = m.contenedor.querySelector('button');
    (otro as HTMLElement | null)?.focus(); // el foco arranca en cualquier lado

    window.dispatchEvent(arrastre('drop', [captura()]));
    await reposar();

    const caja = m.contenedor.querySelector('textarea')!;
    expect(document.activeElement, 'el drop tiene que devolver el foco a la caja').toBe(caja);

    caja.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await reposar();
    expect(enviosMedia).toHaveLength(1);
  });

  test('🔴 una imagen arrastrada desde una WEB no navega, y lo dice', async () => {
    // Sin cancelar el default, el webview se va a la imagen y la vendedora queda
    // afuera de Hermes sin botón de volver. Es el agujero que la guarda de `Files`
    // dejaba abierto justo en el caso que la justifica.
    const m = await abrirChat();
    const e = arrastre('drop', null, 'url');
    window.dispatchEvent(e);
    await reposar();

    expect(e.defaultPrevented, 'el drop de una URL TIENE que cancelarse').toBe(true);
    expect(m.contenedor.textContent).toContain('Bajalo primero');
    expect(enviosMedia).toHaveLength(0);
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
    expect(m.contenedor.textContent).toContain('el adjunto se descarta');
  });
});
