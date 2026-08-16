// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { montar, reposar, type Montado } from '../../pruebas/dom';
import { HiloWhatsapp } from './HiloWhatsapp';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * EL RUTEO DE UN ADJUNTO QUE NO ENTRA — el cableado, no la regla.
 *
 * `planDeCompresion` está testeada hasta el hueso aparte. Lo que se fija acá es
 * la bifurcación del composer, que es pura conexión y por eso ningún test puro
 * la ve: **un VIDEO pesado abre el flujo de achicar; cualquier otra cosa pesada
 * sigue siendo un aviso a secas**.
 *
 * Es la clase de cosa que un refactor rompe sin que se note: las dos ramas
 * dibujan una banda ámbar en el mismo lugar, y la diferencia —que una tenga
 * salida y la otra no— no se ve en una captura.
 *
 * El motor NO se toca: `leerMetadatosVideo` usa un `<video>` que jsdom no sabe
 * cargar, así que el flujo se queda en «Viendo si se puede achicar…». Eso es
 * exactamente lo que hay que verificar — que se ENTRÓ al flujo. Lo que pasa
 * después necesita un encoder de verdad y está verificado con Playwright sobre
 * el video real (`docs/evidencia/comprimir-*.png`).
 */

const TELEFONO = '51987654321';
const NUMERO_PROPIO = '51984429504';
const MB = 1024 * 1024;

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

/** La línea del bot: Cloud API, con los topes de Meta. */
const LIMITES_CLOUD_API = { imagen: 5 * MB, video: 16 * MB, audio: 16 * MB, documento: 64 * MB };

let montado: Montado | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      const json = (c: unknown) =>
        new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/whatsapp/sesion'))
        return json({
          estado: 'conectado',
          telefono: NUMERO_PROPIO,
          transporte: 'cloud-api',
          limitesMedia: LIMITES_CLOUD_API,
        });
      if (url.includes('/api/whatsapp/conversacion/'))
        return json({ telefono: TELEFONO, mensajes: [], origen: null });
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

/** Elegir un archivo por el clip, que es por donde entró el video del reporte. */
async function elegirPorElClip(m: Montado, archivo: File) {
  const input = m.contenedor.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) throw new Error('no encontré el clip');
  Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await reposar();
}

/**
 * Un archivo del tamaño que se quiera, sin ocuparlo: el `size` de un `File` es
 * de solo lectura, y crear 18 MB en memoria por test no aporta nada — lo que se
 * prueba es la decisión sobre el número.
 */
function archivoDe(tipo: string, mb: number, nombre: string): File {
  const f = new File([new Uint8Array(1)], nombre, { type: tipo });
  Object.defineProperty(f, 'size', { value: Math.round(mb * MB), configurable: true });
  return f;
}

describe('un adjunto que no entra por la línea', () => {
  test('🔴 un VIDEO pesado abre el flujo de achicar, no un cartel', async () => {
    const m = await abrirChat();
    await elegirPorElClip(
      m,
      archivoDe('video/mp4', 17.9, 'WhatsApp Video 2026-08-05.mp4'),
    );

    const texto = m.contenedor.textContent ?? '';
    // El motivo sigue estando (pesa X, entran Y)…
    expect(texto).toContain('17,9 MB');
    expect(texto).toContain('16 MB');
    // …pero ahora con salida: se entró al flujo.
    expect(texto).toContain('Viendo si se puede achicar');
  });

  test('🔴 lo que NO es video sigue siendo un aviso a secas', async () => {
    // Comprimir un PDF de 70 MB no es lo mismo que comprimir un video, y
    // ofrecerlo prometería algo que el motor no hace.
    const m = await abrirChat();
    await elegirPorElClip(m, archivoDe('application/pdf', 70, 'temario.pdf'));

    const texto = m.contenedor.textContent ?? '';
    expect(texto).toContain('El archivo pesa 70 MB');
    expect(texto).not.toContain('Viendo si se puede achicar');
    expect(texto).not.toContain('Achicarlo acá');
  });

  test('una imagen pesada tampoco ofrece achicar', async () => {
    // El tope de imagen de la Cloud API es 5 MB y es otro frente (otro encoder,
    // otra aritmética). Ofrecerlo acá sería prometer lo que no existe.
    const m = await abrirChat();
    await elegirPorElClip(m, archivoDe('image/png', 9, 'flyer.png'));

    const texto = m.contenedor.textContent ?? '';
    expect(texto).toContain('La imagen pesa 9 MB');
    expect(texto).not.toContain('Viendo si se puede achicar');
  });

  test('un video que SÍ entra va derecho al composer, sin pasar por achicar', async () => {
    const m = await abrirChat();
    await elegirPorElClip(m, archivoDe('video/mp4', 10, 'corto.mp4'));

    const texto = m.contenedor.textContent ?? '';
    expect(texto).toContain('el texto de abajo va como leyenda');
    expect(texto).not.toContain('Viendo si se puede achicar');
    expect(texto).not.toContain('por esta línea entran hasta');
  });

  test('🔴 con un server viejo (sin `limitesMedia`) NO se frena de más', async () => {
    // El campo es opcional a propósito: sin él, el front se comporta como antes
    // y la garantía la pone el 409 del server. Frenar acá rechazaría envíos que
    // por una línea whatsmeow salen bien.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        const json = (c: unknown) =>
          new Response(JSON.stringify(c), { headers: { 'content-type': 'application/json' } });
        if (url.includes('/api/whatsapp/sesion')) return json({ estado: 'conectado', telefono: NUMERO_PROPIO });
        if (url.includes('/api/whatsapp/conversacion/'))
          return json({ telefono: TELEFONO, mensajes: [], origen: null });
        return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      }),
    );
    const m = await abrirChat();
    await elegirPorElClip(m, archivoDe('video/mp4', 17.9, 'video.mp4'));

    const texto = m.contenedor.textContent ?? '';
    expect(texto).toContain('el texto de abajo va como leyenda');
    expect(texto).not.toContain('por esta línea entran hasta');
  });
});
