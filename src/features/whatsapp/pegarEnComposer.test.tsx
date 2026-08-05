// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { escribir, montar, pegar, reposar, objectUrlsRevocados, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../canales/conversaciones';

/**
 * ⌘V EN EL COMPOSER — el CABLEADO, que es lo que ningún test puro ve.
 *
 * `decidirPegado` está testeada aparte, caso por caso. Lo que este archivo fija
 * es otra cosa, y es exactamente el agujero del ADR 0024: que el handler esté
 * enganchado al textarea que la vendedora usa, y que **el `preventDefault` esté
 * puesto solo donde va**.
 *
 * Ese segundo punto es el que duele: `preventDefault` de más no rompe nada
 * visible en un test de DOM ni en una captura —el textarea sigue ahí, el
 * composer se ve igual— pero en la app real significa que pegar una frase
 * copiada deja de escribir. Sería una regresión de la función más usada de la
 * caja, introducida por la función menos usada. Por eso se afirma sobre el
 * evento (`defaultPrevented`) y no sobre lo que quedó dibujado.
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
  pide_info: false,
  n: 1,
  referencia: 'r1',
  ultimo_at: new Date().toISOString(),
  dias: 0,
  nivel: 0,
} as Conversacion;

let montado: Montado | null = null;
let enviosMedia: { url: string; nombre: string | null; caption: string | null }[] = [];

beforeEach(() => {
  enviosMedia = [];
  objectUrlsRevocados.clear();
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
        enviosMedia.push({ url, nombre: q.get('nombre'), caption: q.get('caption') });
        return new Response(JSON.stringify({ ok: true, idExterno: 'wa:1' }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      // Todo lo demás (foto de perfil, marcar leído) no importa acá.
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

function caja(m: Montado): HTMLTextAreaElement {
  const t = m.contenedor.querySelector('textarea');
  if (!t) throw new Error('no encontré el composer');
  return t;
}

/** Una captura como la que deja el portapapeles: siempre se llama `image.png`. */
function captura(bytes = 1024, tipo = 'image/png', nombre = 'image.png'): File {
  return new File([new Uint8Array(bytes)], nombre, { type: tipo });
}

describe('⌘V en el composer', () => {
  test('🔴 pegar TEXTO no se cancela: el ⌘V de siempre sigue funcionando', async () => {
    const m = await abrirChat();
    const evento = pegar(caja(m), []);
    // Sin esta guarda, adjuntar imágenes rompería pegar frases — que es lo que
    // la vendedora hace cien veces por día.
    expect(evento.defaultPrevented).toBe(false);
  });

  test('pegar una captura la deja como adjunto, y NO la envía', async () => {
    const m = await abrirChat();
    const evento = pegar(caja(m), [captura()]);
    await reposar();

    // Cancelado: si no, Chrome además pega la ruta del archivo como texto.
    expect(evento.defaultPrevented).toBe(true);
    // La vista previa está: el nombre genérico quedó renombrado por fecha.
    expect(m.contenedor.textContent).toMatch(/captura-\d{4}-\d{2}-\d{2}-\d{4}\.png/);
    // PEGAR NO ENVÍA — sale con Enter o con el botón, como cualquier mensaje.
    expect(enviosMedia).toHaveLength(0);
  });

  test('lo que ya estaba escrito se convierte en la leyenda, no se pierde', async () => {
    const m = await abrirChat();
    const t = caja(m);
    escribir(t, 'te mando el flyer');
    await reposar();

    pegar(t, [captura()]);
    await reposar();

    expect(t.value).toBe('te mando el flyer');
    expect(m.contenedor.textContent).toContain('el texto de abajo va como leyenda');
  });

  test('pegar y mandar con Enter: sale UN adjunto, con nombre y leyenda', async () => {
    const m = await abrirChat();
    const t = caja(m);
    escribir(t, 'mirá esto');
    await reposar();
    pegar(t, [captura()]);
    await reposar();

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await reposar();

    expect(enviosMedia).toHaveLength(1);
    expect(enviosMedia[0].nombre).toMatch(/^captura-\d{4}-\d{2}-\d{2}-\d{4}\.png$/);
    expect(enviosMedia[0].caption).toBe('mirá esto');
  });

  test('un archivo copiado del explorador conserva su nombre al salir', async () => {
    // El nombre entra en la versión de la pieza (ADR 0022): en Goberna el
    // precio vive adentro del flyer.
    const m = await abrirChat();
    const t = caja(m);
    pegar(t, [captura(1024, 'image/jpeg', 'flyer-agosto-PRECIO-NUEVO.jpg')]);
    await reposar();

    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await reposar();

    expect(enviosMedia[0].nombre).toBe('flyer-agosto-PRECIO-NUEVO.jpg');
  });

  test('lo que WhatsApp no manda se rechaza EN PANTALLA, no en silencio', async () => {
    const m = await abrirChat();
    pegar(caja(m), [new File(['x'], 'cosas.zip', { type: 'application/zip' })]);
    await reposar();

    expect(m.contenedor.textContent).toContain('imagen, video, audio o PDF');
    expect(enviosMedia).toHaveLength(0);
  });

  test('pegar varias avisa cuál va', async () => {
    const m = await abrirChat();
    pegar(caja(m), [captura(), captura(2048, 'image/jpeg', 'image.jpeg')]);
    await reposar();

    expect(m.contenedor.textContent).toContain('se pegaron 2');
  });

  test('quitar el adjunto suelta su objectURL', async () => {
    // La miniatura creaba un blob por render y no revocaba ninguno: con el
    // clip pasaba poco, con ⌘V pasa todo el tiempo.
    const m = await abrirChat();
    pegar(caja(m), [captura()]);
    await reposar();

    const quitar = [...m.contenedor.querySelectorAll('button')].find(
      (b) => b.getAttribute('title') === 'Quitar adjunto',
    );
    expect(quitar).toBeTruthy();
    quitar!.click();
    await reposar();

    expect(objectUrlsRevocados.size).toBeGreaterThan(0);
    expect(m.contenedor.textContent).not.toContain('el texto de abajo va como leyenda');
  });

  test('EN MODO REVISIÓN pegar una imagen se rechaza: ahí se aprueba un texto', async () => {
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

    const evento = pegar(caja(m), [captura()]);
    await reposar();

    expect(evento.defaultPrevented).toBe(true);
    expect(m.contenedor.textContent).toContain('estás aprobando un texto preparado');
    expect(m.contenedor.textContent).not.toContain('el texto de abajo va como leyenda');
  });
});
