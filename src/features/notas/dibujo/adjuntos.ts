import { API_URL } from '../../../config';
import { tokenGuardado } from '../../../lib/datos/token';

/**
 * LAS IMÁGENES DE LA CAPA — subirlas, bajarlas y tenerlas listas para pintar.
 *
 * ══ POR QUÉ NO SE USA EL `api()` DE LA CASA ═════════════════════════════════
 *
 * `lib/datos/cliente.ts` fuerza `content-type: application/json` y termina en
 * `res.json()`. Acá lo que viaja son BYTES en los dos sentidos: el cuerpo de la
 * subida es el archivo crudo (así lo espera `express.raw`, y así esquiva el
 * límite de 100 KB que `express.json()` le pone a toda la app) y la bajada es un
 * `Blob`. Se reusa lo que importa —la URL base y el mismo Bearer— y nada más.
 *
 * ══ POR QUÉ SE BAJAN CON `fetch` Y NO CON UN `<img src>` ════════════════════
 *
 * 🔴 Es lo que mantiene las imágenes DENTRO del perímetro. `/api/*` exige el
 * token de la vendedora y una etiqueta `<img>` no manda cabeceras, así que el
 * camino habitual sería abrir la ruta o meter un token en la URL — las dos cosas
 * dejan las capturas de una libreta privada al alcance de cualquiera que vea el
 * link.
 *
 * Como la capa pinta en un `<canvas>`, no hace falta ninguna etiqueta: se baja
 * con `fetch` + `Authorization`, se convierte a `ImageBitmap` y se dibuja. Las
 * imágenes quedan tan cerradas como el texto de la página.
 *
 * ══ EL CACHÉ NO ES UNA OPTIMIZACIÓN ═════════════════════════════════════════
 *
 * `pintar` corre en cada movimiento del puntero y necesita el bitmap YA, de
 * forma síncrona. Sin un caché en memoria habría que decodificar la imagen en
 * cada cuadro — o peor, pintar un hueco mientras se decodifica, que se ve como
 * la imagen parpadeando mientras se la arrastra.
 */

/** Los formatos que el server acepta. Se repite acá para poder avisar ANTES de subir. */
export const TIPOS_ACEPTADOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** Lo que se le pasa a un `<input type="file">`. */
export const ACEPTA_ARCHIVOS = TIPOS_ACEPTADOS.join(',');

export interface Adjunto {
  archivo: string;
  ancho: number;
  alto: number;
}

/**
 * EL CACHÉ, por nombre de archivo.
 *
 * Es de módulo y no de componente a propósito: al cambiar de página y volver, la
 * imagen ya está decodificada. El valor es la PROMESA y no el bitmap, para que
 * dos figuras que usan el mismo archivo —una copia y su original— disparen una
 * sola descarga en vez de dos.
 */
const cache = new Map<string, Promise<ImageBitmap | null>>();

/** Lo ya resuelto, para que `pintar` pueda leerlo sin `await`. */
const listas = new Map<string, ImageBitmap>();

/** El bitmap si ya está decodificado, o `null`. Síncrono: lo llama el pintor. */
export function bitmapDe(archivo: string): ImageBitmap | null {
  return listas.get(archivo) ?? null;
}

/**
 * Se asegura de que el archivo esté bajado y decodificado. Devuelve el bitmap, o
 * `null` si no se pudo.
 *
 * **No lanza.** Una imagen que ya no está en el disco (o una red caída) no puede
 * ser el motivo por el que la página entera deje de pintarse: se devuelve `null`
 * y el pintor dibuja el hueco con su marco, que es información honesta.
 */
export function traerBitmap(archivo: string): Promise<ImageBitmap | null> {
  const yaEsta = cache.get(archivo);
  if (yaEsta) return yaEsta;

  const promesa = (async (): Promise<ImageBitmap | null> => {
    try {
      const token = tokenGuardado();
      const res = await fetch(`${API_URL}/api/notas/adjuntos/${encodeURIComponent(archivo)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const bitmap = await createImageBitmap(await res.blob());
      listas.set(archivo, bitmap);
      return bitmap;
    } catch {
      return null;
    }
  })();

  cache.set(archivo, promesa);
  return promesa;
}

/** Mete en el caché un bitmap que ya tenemos —el de la imagen recién pegada—. */
export function sembrarBitmap(archivo: string, bitmap: ImageBitmap): void {
  listas.set(archivo, bitmap);
  cache.set(archivo, Promise.resolve(bitmap));
}

export class ErrorDeAdjunto extends Error {}

/**
 * SUBE UNA IMAGEN y devuelve su nombre y sus medidas naturales.
 *
 * Las medidas se sacan ACÁ, del bitmap ya decodificado, y no del server: el
 * server tendría que decodificar la imagen solo para eso, y el navegador ya la
 * tiene abierta porque la va a pintar en el mismo segundo.
 *
 * El bitmap se siembra en el caché antes de devolver: la imagen recién pegada se
 * ve en el acto, sin un viaje de vuelta al server para bajar lo que se acaba de
 * subir.
 */
export async function subirImagen(datos: Blob): Promise<Adjunto> {
  const tipo = datos.type || 'image/png';
  if (!TIPOS_ACEPTADOS.includes(tipo as (typeof TIPOS_ACEPTADOS)[number])) {
    throw new ErrorDeAdjunto(`«${tipo}» no se puede pegar. Solo PNG, JPG, WEBP o GIF.`);
  }

  // Se decodifica ANTES de subir: si el archivo está roto conviene saberlo sin
  // haber escrito nada en el disco del server.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(datos);
  } catch {
    throw new ErrorDeAdjunto('Esa imagen no se pudo leer.');
  }

  const token = tokenGuardado();
  const res = await fetch(`${API_URL}/api/notas/adjuntos`, {
    method: 'POST',
    headers: { 'content-type': tipo, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: datos,
  });

  if (!res.ok) {
    const cuerpo = await res.json().catch(() => ({}));
    throw new ErrorDeAdjunto(cuerpo.message ?? `No se pudo subir la imagen (${res.status}).`);
  }

  const { adjunto } = (await res.json()) as { adjunto: { archivo: string } };
  sembrarBitmap(adjunto.archivo, bitmap);
  return { archivo: adjunto.archivo, ancho: bitmap.width, alto: bitmap.height };
}

/**
 * LA IMAGEN QUE HAY EN UN PORTAPAPELES, o `null`.
 *
 * Se mira `items` y no `files` porque una captura de pantalla llega como un ítem
 * sin nombre de archivo, y `files` a veces viene vacío para ella. Se recorre en
 * orden y se toma la PRIMERA imagen: pegar desde una página web suele traer
 * además el HTML y el texto del mismo contenido, y quedarse con la última
 * elegiría cualquier cosa.
 */
export function imagenDelPortapapeles(datos: DataTransfer | null): File | null {
  if (!datos) return null;
  for (const item of Array.from(datos.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const archivo = item.getAsFile();
      if (archivo) return archivo;
    }
  }
  for (const archivo of Array.from(datos.files ?? [])) {
    if (archivo.type.startsWith('image/')) return archivo;
  }
  return null;
}

/**
 * A QUÉ TAMAÑO ENTRA UNA IMAGEN RECIÉN PEGADA.
 *
 * Una captura de pantalla moderna mide 3.000 px de ancho y la columna de la
 * Libreta unos 700: pegarla a tamaño natural la deja desbordando la página y con
 * los tiradores fuera de la vista, o sea imposible de achicar. Se reduce para que
 * entre en una fracción del ancho disponible, conservando la proporción, y nunca
 * se AGRANDA — una imagen chica pegada a lo grande sale borrosa.
 */
export function medidaAlPegar(
  natural: { ancho: number; alto: number },
  anchoDisponible: number,
  fraccion = 0.7,
): { ancho: number; alto: number } {
  const tope = Math.max(80, anchoDisponible * fraccion);
  const escala = Math.min(1, tope / natural.ancho);
  return { ancho: Math.round(natural.ancho * escala), alto: Math.round(natural.alto * escala) };
}
