/**
 * LO QUE HAY QUE SABER DEL VIDEO ANTES DE DECIDIR — y SIN tocar ffmpeg.
 *
 * ── Por qué vive aparte de `comprimirVideo.ts` ───────────────────────────
 * La duración y las dimensiones salen del `<video>` del navegador: cero
 * dependencias, milisegundos. Es todo lo que `planDeCompresion` necesita, así
 * que la decisión —incluido «esto no se puede achicar»— se toma antes de bajar
 * un byte del motor.
 *
 * Estaba adentro de `comprimirVideo.ts` y eso lo ataba al import del core de 32
 * MB: analizar y comprimir quedaban en el mismo chunk, y **un fallo al resolver
 * el wasm se reportaba como «no se pudo leer el video»** — un mensaje sobre el
 * archivo de la vendedora cuando el problema era nuestro empaquetado. Lo
 * encontró la primera corrida contra el video real, no un test.
 */

export interface MetadatosVideo {
  duracionSeg: number;
  /** El lado más corto en píxeles — un vertical de 1080×1920 es «1080». */
  ladoCorto: number;
}

export function leerMetadatosVideo(archivo: File): Promise<MetadatosVideo> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const v = document.createElement('video');
    v.preload = 'metadata';
    const limpiar = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
    };
    v.onloadedmetadata = () => {
      const dato: MetadatosVideo = {
        duracionSeg: v.duration,
        ladoCorto: Math.min(v.videoWidth, v.videoHeight),
      };
      limpiar();
      resolver(dato);
    };
    v.onerror = () => {
      limpiar();
      // No se inventa una duración: `planDeCompresion` sabe qué hacer con un
      // `NaN` y lo dice en pantalla. Un número supuesto acá saldría como un
      // bitrate supuesto, y eso es un archivo que rebota después de esperar.
      rechazar(new Error('no se pudo leer el video'));
    };
    v.src = url;
  });
}
