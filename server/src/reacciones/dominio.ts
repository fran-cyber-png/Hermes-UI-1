/**
 * UNA REACCIÓN NO ES UN MENSAJE — es algo que le pasa a un mensaje.
 *
 * ── Por qué esto importa antes que cualquier otra cosa ───────────────────
 * Las reacciones se descartaban a propósito (`whatsapp/contenido.ts`), y el
 * motivo era bueno: entraban a `interactions` como cualquier otro entrante y la
 * UI las dibujaba como una burbuja vacía que decía «(no es texto)» — un contacto
 * que nunca escribió aparecía con un mensaje fantasma (#70).
 *
 * La respuesta correcta no es «dejarlas entrar»: es **no meterlas donde nunca
 * fueron**. Un 👍 no ocupa un renglón del hilo, cuelga del mensaje al que
 * reacciona. Por eso viven en su propia tabla y `tieneContenido` sigue
 * devolviendo `false` para ellas: si algún día alguien la relaja, vuelve el
 * fantasma.
 *
 * ── La semántica de WhatsApp, que no es obvia ────────────────────────────
 * Una persona tiene UNA reacción por mensaje. Reaccionar de nuevo **reemplaza**
 * la anterior, y reaccionar con vacío **la quita**. No es un log de eventos: es
 * un estado por (mensaje, persona). Modelarlo como historial daría un mensaje
 * con 👍❤️😮 de la misma persona, que en el teléfono se ve como uno solo.
 */

/** Lo que llega, ya traducido — el dialecto de cada canal queda en su traductor. */
export interface ReaccionEntrante {
  /** El `external_id` del mensaje al que reacciona, en formato de Hermes (`wa:<id>`). */
  mensajeExternalId: string;
  /** Quién reaccionó: el teléfono normalizado, o el número propio si fuimos nosotros. */
  dePersona: string;
  /** El emoji tal cual. Vacío = la quitó. */
  emoji: string;
  cuando: Date;
}

export type AccionReaccion =
  | { tipo: 'poner'; emoji: string }
  | { tipo: 'quitar' };

/**
 * Un emoji vacío, `null` o solo espacios significa **quitar**, no «reaccionar
 * con nada». Es la forma que usa WhatsApp para desreaccionar y llega por el
 * mismo camino que una reacción normal: tratarla como `poner('')` dejaría una
 * píldora vacía colgando de la burbuja para siempre.
 */
export function leerReaccion(emoji: string | null | undefined): AccionReaccion {
  const limpio = (emoji ?? '').trim();
  return limpio === '' ? { tipo: 'quitar' } : { tipo: 'poner', emoji: limpio };
}

/** El `external_id` con el que Hermes guarda un mensaje de WhatsApp. */
export function externalIdDeWa(idDeWhatsapp: string): string {
  return `wa:${idDeWhatsapp}`;
}

/**
 * ── CLOUD API ──
 * `{ type: 'reaction', reaction: { message_id, emoji }, from, timestamp }`.
 *
 * Devuelve `null` si el mensaje no es una reacción o si le falta el
 * `message_id`: sin saber a QUÉ reaccionó, el dato no sirve para nada y
 * guardarlo colgado de la nada es peor que perderlo.
 */
export function reaccionDeCloudApi(m: {
  type?: string;
  from?: string;
  timestamp?: string | number;
  reaction?: { message_id?: string; emoji?: string | null };
}): ReaccionEntrante | null {
  if (m?.type !== 'reaction') return null;
  const idMensaje = m.reaction?.message_id;
  const de = m.from;
  if (!idMensaje || !de) return null;
  return {
    mensajeExternalId: externalIdDeWa(idMensaje),
    dePersona: String(de).replace(/\D/g, ''),
    emoji: (m.reaction?.emoji ?? '').trim(),
    cuando: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
  };
}

/**
 * ── WHATSMEOW ──
 * `message.reactionMessage = { key: { id, fromMe }, text, senderTimestampMs }`.
 *
 * `text` es el emoji (vacío al quitar). El teléfono NO sale de acá: lo pone el
 * transporte, que es el único que sabe resolver un `@lid` a un número real.
 */
export function reaccionDeWhatsmeow(
  message: Record<string, unknown>,
  contexto: { dePersona: string; cuando: Date },
): ReaccionEntrante | null {
  const r = message?.reactionMessage as
    | { key?: { id?: string }; text?: string | null; senderTimestampMs?: number | string }
    | undefined;
  if (!r) return null;
  const idMensaje = r.key?.id;
  if (!idMensaje || !contexto.dePersona) return null;

  // El sello propio de la reacción gana sobre el del sobre: el segundo es
  // cuándo LLEGÓ, y con el server caído un rato se agrupan todas en el mismo
  // instante — que es justo cuando el orden importa.
  const propio = Number(r.senderTimestampMs);
  const cuando = Number.isFinite(propio) && propio > 0 ? new Date(propio) : contexto.cuando;

  return {
    mensajeExternalId: externalIdDeWa(idMensaje),
    dePersona: contexto.dePersona,
    emoji: (r.text ?? '').trim(),
    cuando,
  };
}

/**
 * ¿Es este proto SOLO una reacción?
 *
 * Se pregunta antes de descartar el mensaje por «sin contenido», y no después:
 * el descarte es el que hoy se come las reacciones. `messageContextInfo`
 * acompaña y no cuenta, igual que en `contenido.ts`.
 */
export function esSoloReaccion(message: Record<string, unknown>): boolean {
  const claves = Object.keys(message ?? {}).filter((k) => k !== 'messageContextInfo');
  return claves.length > 0 && claves.every((k) => k === 'reactionMessage');
}
