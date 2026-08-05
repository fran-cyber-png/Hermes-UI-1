import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
/**
 * 🔴 EL CORE SE SIRVE DESDE `public/ffmpeg/`, NO SE IMPORTA.
 *
 * `scripts/preparar-ffmpeg.mjs` lo copia ahí desde `node_modules` en `predev` y
 * `prebuild`, y tiene escrito el porqué largo. El corto: tiene que ser el build
 * **ESM** (el worker de @ffmpeg/ffmpeg es `type: "module"` y termina haciendo
 * `import(coreURL)`, que pide un `export default` que el UMD no tiene), y no hay
 * forma de pedirle esa URL al bundler — Vite pre-bundlea el paquete y `?url`
 * deja de devolver una URL.
 *
 * `document.baseURI` y no una ruta absoluta: la cáscara vieja de Electron abre
 * el build por `file://` (de ahí el `base: './'` de `vite.config.ts`), y `/ffmpeg/…`
 * apuntaría a la raíz del disco.
 */
function urlDelCore(archivo: string): string {
  return new URL(`ffmpeg/${archivo}`, document.baseURI).href;
}
import { CODEC_AUDIO, CODEC_VIDEO, type Plan } from './planDeCompresion';

/**
 * EL MOTOR — ffmpeg compilado a WebAssembly, corriendo en la máquina de la
 * vendedora.
 *
 * ── Este archivo NO se importa de forma estática desde ningún lado ────────
 * El core pesa **32 MB**. Entra a la app con `await import('./comprimirVideo')`
 * y solo cuando alguien adjunta un video que no entra — que es una fracción de
 * los envíos. Importarlo arriba de `HiloWhatsapp` sumaría 32 MB a lo que baja
 * por OTA cada vendedora peruana después de cada deploy, para una función que
 * la mayoría de los días no usa.
 *
 * ── Por qué ffmpeg y no lo que trae el navegador ──────────────────────────
 * · **MediaRecorder** produce WebM/VP8-VP9 y el codec de salida no se controla
 *   de forma portable. La Cloud API exige **H.264 + AAC**: habría que esperar
 *   un minuto para que Meta rechace igual, ahora por codec en vez de por peso.
 * · **WebCodecs** da control de codec y usa el encoder por hardware (sería
 *   segundos en vez de un minuto), pero necesita muxer propio y **no se puede
 *   asumir**: de Hermes se reparten `.dmg` de macOS y `Hermes-Windows.zip`, y
 *   además se entra por navegador. Queda como fast-path para más adelante,
 *   detrás de feature-detection — no como el único camino.
 * · **ffmpeg.wasm single-thread corre HOY sin tocar infraestructura**: no hay
 *   CSP en Tauri (`tauri.conf.json` la tiene en `null`), ni en el HTML, ni en
 *   Express. Multi-hilo pediría COOP/COEP —dos headers— y bajaría el tiempo a
 *   la mitad; queda anotado, no hace falta para que esto funcione.
 *
 * ── Self-hosted, no CDN ───────────────────────────────────────────────────
 * El core y el wasm salen de `public/ffmpeg/`, que Vite copia tal cual a `dist/`
 * y sirve el mismo `express.static` que el resto. Un `unpkg.com` en el camino
 * haría que adjuntar un video dependa de que un tercero esté vivo — y la app de
 * la vendedora abre contra VPS1, no contra internet en general.
 */

/** Un solo ffmpeg por sesión: cargar 32 MB dos veces no tiene sentido. */
let instancia: FFmpeg | null = null;
let cargando: Promise<FFmpeg> | null = null;

async function cargarFfmpeg(alProgresarCarga?: (f: number) => void): Promise<FFmpeg> {
  if (instancia) return instancia;
  if (cargando) return cargando;

  cargando = (async () => {
    const ff = new FFmpeg();
    // URLs DIRECTAS, no `toBlobURL`. El helper de @ffmpeg/util existe para
    // cargar el core desde un CDN (cross-origin), y acá el core es nuestro: sale
    // del mismo `express.static` que la app. Con blobs, además, el core ESM
    // pierde su `import.meta.url` —que es como ubica archivos hermanos— y los
    // dos `blob:` terminan en `net::ERR_ABORTED` dentro del worker.
    alProgresarCarga?.(1);
    await ff.load({
      coreURL: urlDelCore('ffmpeg-core.js'),
      wasmURL: urlDelCore('ffmpeg-core.wasm'),
    });
    instancia = ff;
    return ff;
  })();

  try {
    return await cargando;
  } finally {
    cargando = null;
  }
}

export interface OpcionesCompresion {
  /** 0..1. Cubre la carga del motor y el encode, en ese orden. */
  alProgresar?: (fraccion: number) => void;
  /** Para el botón de cancelar: aborta el encode y libera el motor. */
  senal?: AbortSignal;
}

/** Cuánto del progreso total se lleva bajar el motor la primera vez. */
const PESO_CARGA = 0.15;

/**
 * COMPRIME `archivo` SEGÚN `plan` Y DEVUELVE UN `File` NUEVO.
 *
 * ⚠️ **El nombre se conserva exactamente.** No es descuido: el nombre del
 * archivo entra en la versión de la pieza (ADR 0022), y esto sigue siendo el
 * mismo flyer — comprimirlo no lo convierte en una pieza distinta. Renombrarlo
 * a «…-comprimido.mp4» inventaría una versión que nadie editó y partiría en dos
 * las mediciones de una pieza que es una sola.
 */
export async function comprimirVideo(
  archivo: File,
  plan: Extract<Plan, { tipo: 'comprimir' }>,
  opciones: OpcionesCompresion = {},
): Promise<File> {
  const { alProgresar, senal } = opciones;
  const ff = await cargarFfmpeg(() => alProgresar?.(PESO_CARGA));
  if (senal?.aborted) throw new DOMException('cancelado', 'AbortError');

  const entrada = 'entrada';
  const salida = 'salida.mp4';

  const alProgreso = ({ progress }: { progress: number }) => {
    // ffmpeg puede reportar > 1 al final; se acota o la barra retrocede.
    const p = Math.min(Math.max(progress, 0), 1);
    alProgresar?.(PESO_CARGA + p * (1 - PESO_CARGA));
  };
  ff.on('progress', alProgreso);

  const abortar = () => void ff.terminate();
  senal?.addEventListener('abort', abortar, { once: true });

  try {
    await ff.writeFile(entrada, await fetchFile(archivo));

    // `-vf scale` SOLO si hubo que resignar píxeles: pedir una escala igual a la
    // entrada obliga a un filtro que no cambia nada y cuesta tiempo. `-2` deja
    // que ffmpeg calcule el otro lado par (H.264 lo exige) manteniendo el aspecto.
    const escala = plan.bajaResolucion
      ? ['-vf', `scale='if(gt(iw,ih),-2,${plan.ladoCorto})':'if(gt(iw,ih),${plan.ladoCorto},-2)'`]
      : [];

    await ff.exec([
      '-i',
      entrada,
      ...escala,
      '-c:v',
      'libx264',
      // `veryfast` y no `medium`: en wasm cada escalón de preset se paga en
      // minutos de espera de una persona, y la diferencia de calidad al mismo
      // bitrate no se ve en un video de venta.
      '-preset',
      'veryfast',
      '-b:v',
      `${plan.videoKbps}k`,
      '-maxrate',
      `${Math.round(plan.videoKbps * 1.15)}k`,
      '-bufsize',
      `${plan.videoKbps * 2}k`,
      '-c:a',
      'aac',
      '-b:a',
      `${plan.audioKbps}k`,
      // El índice al principio: sin esto, WhatsApp tiene que bajar el archivo
      // entero antes de mostrar el primer cuadro.
      '-movflags',
      '+faststart',
      salida,
    ]);

    if (senal?.aborted) throw new DOMException('cancelado', 'AbortError');

    const datos = (await ff.readFile(salida)) as Uint8Array;
    // Copia al buffer: el `Uint8Array` que devuelve ffmpeg apunta a su heap, y
    // el heap se reusa en la próxima compresión.
    const bytes = new Uint8Array(datos);
    return new File([bytes], archivo.name, { type: 'video/mp4', lastModified: Date.now() });
  } finally {
    ff.off('progress', alProgreso);
    senal?.removeEventListener('abort', abortar);
    // Los archivos temporales viven en el FS virtual de wasm: sin esto, dos
    // videos seguidos se comen la memoria del proceso.
    await ff.deleteFile(entrada).catch(() => {});
    await ff.deleteFile(salida).catch(() => {});
    if (senal?.aborted) instancia = null; // `terminate()` lo dejó inservible.
  }
}

export const CODECS_DE_SALIDA = { video: CODEC_VIDEO, audio: CODEC_AUDIO };
