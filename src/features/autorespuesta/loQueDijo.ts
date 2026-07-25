import type { MensajeHilo } from '../whatsapp/conversacionWa';

/**
 * QUÉ DIJO LA PERSONA — el dato que convierte «aprobar» en «supervisar»
 * (ADR 0018).
 *
 * La plantilla es la misma para toda la campaña, así que leerla cuarenta veces
 * no agrega nada. Lo único que cambia entre aprobar a ciegas y supervisar de
 * verdad es poder leer, **al lado del texto que se va a mandar, lo que esa
 * persona escribió**. Si preguntó «¿va dirigido a policías o a cualquiera?» y el
 * acuse le manda el flyer genérico, se ve en un segundo y se edita — que es la
 * mitad de por qué existe el modo supervisado.
 *
 * ── La distinción que cambia la decisión ──
 * #153 midió que **el 90% de los primeros mensajes no los escribió nadie**: son
 * el copy pre-rellenado del anuncio de click-to-WhatsApp, 161 veces la misma
 * frase exacta. Eso es un CLIC, no una frase. Mostrarlo como «lo que preguntó»
 * haría creer que hubo una conversación donde no hubo ninguna — y ahí la
 * plantilla genérica es exactamente lo correcto. Cuando en cambio escribió algo
 * suyo, la plantilla probablemente no le contesta, y eso hay que mirarlo.
 *
 * ── Hacia dónde falla ──
 * Ante la duda: **propio**. Marcar de más como «es solo el copy» haría que la
 * vendedora deje de leer justo lo que tiene que leer. El error barato es que
 * mire una frase de más.
 */

export type LoQueDijo =
  /** Nunca escribió nada. La plantilla genérica es lo correcto. */
  | { clase: 'nada' }
  /** Mandó audio/imagen y no hay texto que leer. Hermes no lo puede leer; ella sí. */
  | { clase: 'sin-texto'; cuando: string }
  /** El pre-rellenado del anuncio: un clic, no una pregunta. */
  | { clase: 'copy-del-anuncio'; texto: string; cuando: string }
  /** Escribió algo suyo. Esto es lo que hay que leer antes de aprobar. */
  | { clase: 'propio'; texto: string; cuando: string };

/**
 * El pre-rellenado de click-to-WhatsApp: «hola» + pedido de información.
 *
 * Deliberadamente NO es una lista de textos exactos: el copy cambia con cada
 * anuncio. Lo que se repite es la forma, y esa forma es corta por diseño —Meta
 * la pre-llena para que la persona solo tenga que apretar «enviar».
 */
const COPY_DEL_ANUNCIO =
  /^\s*hola[,.]?\s*(me\s+interesa|quiero|quisiera|deseo|necesito)?\s*(saber\s+)?(m[aá]s\s+)?(informaci[oó]n|info|informes)\b/i;

/**
 * LO QUE DELATA QUE DEJÓ DE SER EL COPY. Detrás del pedido de información, el
 * pre-rellenado solo nombra el curso («…del Diploma de Inteligencia»). Si en
 * cambio aparece un signo de pregunta o una palabra de pregunta, la persona
 * agregó algo suyo — y eso es exactamente lo que hay que leer antes de aprobar
 * una plantilla que quizá no lo contesta.
 *
 * La lista es corta a propósito: cada palabra de más es una frase que la
 * vendedora deja de mirar. Ante la duda se falla hacia «propio».
 */
const AGREGO_ALGO_SUYO =
  /[?¿]|\b(si|cu[aá]l|cu[aá]les|cu[aá]nto|cu[aá]nta|c[oó]mo|cu[aá]ndo|d[oó]nde|qu[eé]|qui[eé]n|tiene|tienen|sirve|puedo|puede|hay|vale|cuesta|precio|costo|cuota|beca|descuento|certificad|requisit)/i;

/** Un muro de texto nunca es el pre-rellenado, aunque empiece igual. */
const LARGO_MAXIMO_DEL_COPY = 160;

export function loQueDijo(mensajes: readonly MensajeHilo[]): LoQueDijo {
  const entrantes = mensajes.filter((m) => m.direccion === 'entrante');
  const conTexto = entrantes.filter((m) => (m.texto ?? '').trim().length > 0);

  const ultimo = conTexto[conTexto.length - 1];
  if (!ultimo) {
    // Sin una sola palabra: puede ser que no haya escrito nunca, o que lo que
    // mandó sea una nota de voz. No es lo mismo y no se dice igual.
    const conMedia = entrantes.filter((m) => m.media);
    const ultimaMedia = conMedia[conMedia.length - 1];
    return ultimaMedia ? { clase: 'sin-texto', cuando: ultimaMedia.occurred_at } : { clase: 'nada' };
  }

  const texto = (ultimo.texto ?? '').trim();
  const esElCopy =
    texto.length <= LARGO_MAXIMO_DEL_COPY && COPY_DEL_ANUNCIO.test(texto) && !AGREGO_ALGO_SUYO.test(texto);

  return {
    clase: esElCopy ? 'copy-del-anuncio' : 'propio',
    texto,
    cuando: ultimo.occurred_at,
  };
}
