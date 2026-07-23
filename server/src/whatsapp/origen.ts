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

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Busca el externalAdReply a CUALQUIER profundidad del proto — no en tres rutas
 * fijas. WhatsApp lo cuelga del contextInfo de distintos tipos de mensaje (texto,
 * imagen, video…) y a veces dentro de un wrapper (viewOnce). Solo cuenta si trae
 * `sourceId` (el ad_id): sin eso no es un anuncio atribuible. Por no cubrir estas
 * formas, antes «no detectábamos de qué anuncio vino» en unos leads sí y otros no.
 */
function buscarAnuncio(obj: unknown, prof = 0): Record<string, unknown> | null {
  if (obj == null || typeof obj !== 'object' || prof > 6) return null;
  const o = obj as Record<string, unknown>;
  const ad = o.externalAdReply;
  if (ad && typeof ad === 'object') {
    const a = ad as Record<string, unknown>;
    if (texto(a.sourceId ?? a.sourceID)) return a;
  }
  for (const v of Object.values(o)) {
    const encontrado = buscarAnuncio(v, prof + 1);
    if (encontrado) return encontrado;
  }
  return null;
}

export function detectarOrigen(message: Record<string, unknown>, textoMensaje: string | null): Origen | null {
  // 1. Anuncio (Click-to-WhatsApp): el externalAdReply, a cualquier profundidad.
  const a = buscarAnuncio(message);
  if (a) {
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
