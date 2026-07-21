/**
 * DE DÓNDE VINO EL LEAD.
 *
 * Un mensaje de WhatsApp puede traer, en su primer contacto, la marca de por
 * dónde llegó la persona. Detectarlo es la captura del embudo que hoy no existe
 * en ningún lado: saber que "Rosa te escribió porque vio el anuncio X" o "vino de
 * la landing del diplomado".
 *
 *   · ANUNCIO (Click-to-WhatsApp): WhatsApp adjunta `externalAdReply` al primer
 *     mensaje, con `sourceId` (= el ad_id de Meta) y `ctwaClid` (el id del click).
 *     Con el ad_id, la Graph API resuelve el nombre del anuncio y la campaña.
 *   · LANDING: un `wa.me` no lleva referral oculto — la señal es el TEXTO
 *     prefijado que la landing puso en el link. Cada landing usa un código entre
 *     corchetes, ej. "Hola, me interesa [clandestinas]".
 *
 * Esta función es pura: mira el proto crudo del mensaje y el texto, y dice el
 * origen. No llama a nadie (el enriquecimiento con Meta va aparte).
 */

export type Origen =
  | { fuente: 'anuncio'; adId: string; ctwaClid: string | null; titulo: string | null; url: string | null }
  | { fuente: 'landing'; ref: string };

/** Navega un objeto anidado de forma segura, tolerando que no exista. */
function cavar(obj: unknown, ...claves: string[]): unknown {
  let actual = obj;
  for (const k of claves) {
    if (actual == null || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string, unknown>)[k];
  }
  return actual;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function detectarOrigen(message: Record<string, unknown>, textoMensaje: string | null): Origen | null {
  // 1. Anuncio: el externalAdReply vive en el contextInfo del extendedTextMessage
  //    (a veces bajo otros tipos de mensaje; probamos los dos más comunes).
  const ad =
    cavar(message, 'extendedTextMessage', 'contextInfo', 'externalAdReply') ??
    cavar(message, 'imageMessage', 'contextInfo', 'externalAdReply') ??
    cavar(message, 'contextInfo', 'externalAdReply');

  if (ad && typeof ad === 'object') {
    const a = ad as Record<string, unknown>;
    const adId = texto(a.sourceId ?? a.sourceID);
    // El ctwaClid es el oro para atribución 1-a-1; el sourceId ya alcanza para el anuncio.
    if (adId) {
      return {
        fuente: 'anuncio',
        adId,
        ctwaClid: texto(a.ctwaClid),
        titulo: texto(a.title),
        url: texto(a.sourceUrl),
      };
    }
  }

  // 2. Landing: un código entre corchetes en el texto del primer mensaje.
  //    Ej: "Hola, me interesa el diplomado [clandestinas]" → ref = "clandestinas".
  if (textoMensaje) {
    const m = textoMensaje.match(/\[([a-z0-9][a-z0-9_-]{1,40})\]/i);
    if (m) return { fuente: 'landing', ref: m[1].toLowerCase() };
  }

  return null;
}
