/**
 * LA TIRITA GRIS — cómo se ROTULA un mensaje citado.
 *
 * Dos decisiones que parecen una sola y no lo son: **de quién era** y **qué
 * decía**. Viven juntas en una función porque se deciden juntas —el caso del
 * mensaje que Hermes no encontró apaga las dos a la vez— y viven FUERA del JSX
 * porque son lo único de este frente que se puede interrogar sin montar nada.
 *
 * El mismo rótulo se dibuja en DOS lugares: adentro de la burbuja (lo que ya
 * pasó) y arriba del composer (lo que se está por mandar). Con dos redacciones,
 * la vendedora elige una cita que dice «Foto» y manda una que dice «(no es
 * texto)» — #37 en su versión más barata de cometer.
 */

/**
 * El mensaje citado tal como lo sirve el server, y también tal como se elige en
 * la pantalla. **La misma forma para los dos usos**: elegir una cita es apuntar a
 * un mensaje del hilo, así que fabricar un tipo distinto para el composer sería
 * copiar cuatro campos para poder desincronizarlos.
 */
export interface CitaHilo {
  /** El `external_id` del citado. Es lo ÚNICO que viaja de vuelta al server. */
  mensajeExternalId: string;
  /** Qué decía. `null` = Hermes no lo tiene (no es lo mismo que «no decía nada»). */
  texto: string | null;
  /** Quién lo dijo. `null` = no se encontró; **no se adivina**. */
  direccion: 'entrante' | 'saliente' | null;
  /** El citado era un adjunto: su clase. Para poder decir «Foto» en vez de nada. */
  mediaClase?: string | null;
}

/** Cuánto se muestra del citado. Una tirita es una pista, no el mensaje otra vez. */
export const TOPE_EXTRACTO = 120;

/** Cómo se nombra un adjunto sin texto. Palabras y no íconos: esto es una línea. */
const PALABRA_DE_MEDIA: Record<string, string> = {
  imagen: 'Foto',
  video: 'Video',
  audio: 'Audio',
  documento: 'Documento',
  sticker: 'Sticker',
};

/**
 * EL HUECO HONESTO. Se dice cuando el mensaje citado no está en Hermes —porque
 * es anterior a la vinculación del número, o de antes de que se capturaran las
 * citas—, y **no se esconde la cita por eso**: el mensaje sigue siendo una
 * respuesta a algo, y dibujarlo suelto lo haría ilegible.
 */
export const CITADO_DESCONOCIDO = 'Un mensaje anterior';

/**
 * El par (de quién, qué decía) de una cita.
 *
 * `autor: null` significa **no lo sabemos**, y por eso no se dibuja ningún
 * nombre: poner «Esta persona» sobre un mensaje que no encontramos sería
 * afirmar de quién era sin haberlo mirado.
 */
export function rotuloDeCita(
  cita: CitaHilo,
  nombreContacto: string | null,
): { autor: string | null; extracto: string } {
  const autor =
    cita.direccion === 'saliente'
      ? 'Vos'
      : cita.direccion === 'entrante'
        ? (nombreContacto?.trim() || 'Esta persona')
        : null;

  return { autor, extracto: extractoDeCita(cita) };
}

/**
 * Lo que se muestra del citado, en una línea.
 *
 * Los saltos de línea se aplastan a propósito: la tirita tiene una altura fija y
 * un mensaje de ocho renglones se vería como uno vacío. El corte va con `…` —
 * cortar sin marca hace parecer que el mensaje terminaba ahí.
 */
export function extractoDeCita(cita: Pick<CitaHilo, 'texto' | 'mediaClase'>): string {
  const limpio = (cita.texto ?? '').replace(/\s+/g, ' ').trim();
  if (limpio) {
    return limpio.length > TOPE_EXTRACTO ? `${limpio.slice(0, TOPE_EXTRACTO).trimEnd()}…` : limpio;
  }
  // Sin texto: un adjunto se nombra por lo que es. Una clase que no conocemos cae
  // en «Adjunto» y nunca en un throw — el server manda la clase cruda, y una
  // nueva no puede romper el hilo entero.
  if (cita.mediaClase) return PALABRA_DE_MEDIA[cita.mediaClase] ?? 'Adjunto';
  return CITADO_DESCONOCIDO;
}

/**
 * ¿Se puede citar este mensaje?
 *
 * Se pide texto o adjunto, y no es capricho: la tirita de un mensaje que no tiene
 * ninguna de las dos cosas sale en blanco, y una cita en blanco no señala nada.
 * El caso real es la burbuja de «Vino del anuncio», que no es un mensaje que
 * alguien escribió sino una marca que Hermes dibuja.
 */
export function sePuedeCitar(m: { texto?: string | null; media?: { clase: string } | null }): boolean {
  return Boolean(m.texto?.trim() || m.media);
}
