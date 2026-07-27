import { etiquetaDeMedia } from './etiquetaMedia';

/**
 * QUÉ LLEGÓ — la línea que resume un mensaje en una lista, con su cadena de
 * respaldo cuando no hay texto que mostrar.
 *
 * Vivía suelta dentro del JSX de `FilaConversacion.tsx` (la cola de Mensajes).
 * Sale para acá al aparecer el segundo consumidor —la fila del radar (#20)— y no
 * después: dos pantallas que describen el MISMO mensaje con dos cadenas escritas
 * a mano terminan diciendo cosas distintas, y nadie se entera hasta que una
 * vendedora ve «(sin texto)» en un lado y «📷 Foto» en el otro. Es la lección de
 * #37 aplicada a una línea de texto.
 *
 * El ORDEN de la cadena es la decisión, y va de lo más específico a lo más
 * genérico:
 *   1. lo que la persona escribió — si hay palabras, mandan;
 *   2. qué clase de archivo mandó — «📷 Foto» dice bastante más que «(sin texto)»;
 *   3. de dónde vino — un primer contacto de Click-to-WhatsApp puede llegar sin
 *      texto ni media, y «vino del anuncio» sigue siendo información;
 *   4. la rendición honesta.
 *
 * Nunca devuelve cadena vacía: la fila siempre tiene algo que decir, aunque sea
 * que no sabe.
 */
export interface DatosPreview {
  texto?: string | null;
  /** La clase de media (`imagen`, `audio`…) del MISMO mensaje que `texto`. */
  clase?: string | null;
  /** El origen de ese mensaje. Solo se mira `fuente === 'anuncio'`. */
  origen?: { fuente?: string } | null;
}

export const SIN_TEXTO = '(sin texto)';

export function textoDePreview({ texto, clase, origen }: DatosPreview): string {
  const dicho = texto?.trim();
  if (dicho) return dicho;

  const media = etiquetaDeMedia(clase);
  if (media) return media;

  if (origen?.fuente === 'anuncio') return '📣 Vino del anuncio';

  return SIN_TEXTO;
}
