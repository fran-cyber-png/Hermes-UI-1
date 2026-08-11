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
 *   0. **¿lo escribió la persona?** — si el texto lo puso el anuncio, no cuenta
 *      como algo dicho (ver abajo);
 *   1. lo que la persona escribió — si hay palabras, mandan;
 *   2. qué clase de archivo mandó — «📷 Foto» dice bastante más que «(sin texto)»;
 *   3. de dónde vino — un primer contacto de Click-to-WhatsApp puede llegar sin
 *      texto ni media, y «vino del anuncio» sigue siendo información;
 *   4. la rendición honesta.
 *
 * ── 🔴 EL PASO 0, Y POR QUÉ ES UN PASO Y NO UNA PÍLDORA ──────────────────────
 *
 * Cuando alguien toca el botón de un anuncio click-to-WhatsApp, **WhatsApp le
 * escribe el mensaje**: «Hola Quiero más información del Diploma de Inteligencia
 * y Contrainteligencia». Medido en producción el 11-ago-2026: **563 de 3.995
 * conversaciones** (14 % de la mesa) tienen exactamente eso como último entrante,
 * 424 de ellas con el mismo texto palabra por palabra.
 *
 * La fila mostraba esa frase como preview, así que la vendedora leía una
 * pregunta donde no la hubo y **contestaba como si respondiera** — cuando lo que
 * tiene delante es una conversación que todavía no empezó y hay que ABRIR. La
 * primera idea fue una píldora «Solo hizo clic» al lado; no sirve, por dos
 * razones: el renglón 2 ya reparte su lugar entre el chip del bot, el del curso
 * y las categorías —y estas filas casi siempre traen curso, porque vienen de un
 * anuncio de un programa—, y sobre todo **una etiqueta al lado de la mentira no
 * la corrige, la acompaña**.
 *
 * Se arregla donde nace: ese texto no es algo que la persona haya dicho, así que
 * no es preview. Se cae al peldaño 3 de la misma cadena, que ya tenía la frase
 * exacta para esto («📣 Vino del anuncio») desde antes de este frente. El texto
 * no se pierde: está en el chat, a un clic.
 */
export interface DatosPreview {
  texto?: string | null;
  /** La clase de media (`imagen`, `audio`…) del MISMO mensaje que `texto`. */
  clase?: string | null;
  /** El origen de ese mensaje. Solo se mira `fuente === 'anuncio'`. */
  origen?: { fuente?: string } | null;
  /**
   * ¿El texto lo escribió el ANUNCIO y no la persona? Lo decide el server
   * (`server/src/cola/pregunta.ts`), no una comparación de cadenas acá: el
   * predicado ya vive allá con su test de paridad, y copiarlo al navegador sería
   * la misma regla en dos lados (#37).
   *
   * AUSENTE = el server no lo manda (o la respuesta salió del caché de IndexedDB,
   * ADR 0007) y entonces se comporta como antes de este frente: se muestra el
   * texto. Degrada hacia lo viejo, nunca hacia una fila muda.
   */
  soloClic?: boolean;
}

export const SIN_TEXTO = '(sin texto)';
export const DEL_ANUNCIO = '📣 Vino del anuncio';

export function textoDePreview({ texto, clase, origen, soloClic }: DatosPreview): string {
  if (soloClic) return DEL_ANUNCIO;

  const dicho = texto?.trim();
  if (dicho) return dicho;

  const media = etiquetaDeMedia(clase);
  if (media) return media;

  if (origen?.fuente === 'anuncio') return DEL_ANUNCIO;

  return SIN_TEXTO;
}
