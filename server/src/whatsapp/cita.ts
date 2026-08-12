import { externalIdDeWa } from '../reacciones/dominio.js';

/**
 * RESPONDER CITANDO — la tirita gris arriba del mensaje, como en WhatsApp.
 *
 * ── Por qué se parece tanto a las reacciones ─────────────────────────────
 * Es el mismo animal (ADR 0019): una señal que **cuelga de un mensaje**, que
 * llega por DOS canales con dialectos distintos, y que se guarda con el mismo
 * `wa:<id>` con el que se guardan los mensajes. Por eso este módulo copia la
 * forma de `reacciones/dominio.ts`: un traductor por canal, una forma canónica,
 * y la receta del id importada de allá en vez de escrita otra vez — dos recetas
 * hacen que el JOIN dé **cero filas en silencio**, que se lee como «nadie citó
 * nunca a nadie».
 *
 * ── En qué NO se parece ──────────────────────────────────────────────────
 * Una reacción es una entidad aparte (tabla propia, PK `(mensaje, persona)`,
 * estado que se reemplaza). Una cita es un ATRIBUTO del mensaje que la trae: no
 * cambia nunca, no existe sin él, y muere con él. Por eso viaja como una clave
 * más del crudo (`events.payload.cita`, al lado de `media` y `origen`) y **este
 * frente no lleva migración**.
 *
 * ══ 🔴 LA GRAFÍA DEL CAMPO: `stanzaID`, CON D MAYÚSCULA ═══════════════════
 *
 * Los tipos publicados del paquete MIENTEN. `@whatsmeow-node/whatsmeow-node`
 * declara `ContextInfo.stanzaId` (`dist/index.d.ts`) y su ejemplo
 * `reply-and-mentions.ts` usa la misma grafía. El binario Go que realmente
 * serializa el proto dice otra cosa — verificado el 12-ago-2026 sobre
 * `@whatsmeow-node/darwin-arm64/bin/whatsmeow-node`:
 *
 *     strings <binario> | grep -c '^stanzaID$'   → 13
 *     strings <binario> | grep -c '^stanzaId$'   → 0
 *     json:"stanzaID,omitempty"                  → 3 structs
 *
 * O sea: seguir el `.d.ts` manda un campo que el wrapper **descarta sin un solo
 * error**, y la cita sale como un mensaje normal. Como el wrapper usa
 * `encoding/json` (los tags lo delatan) y `encoding/json` **ignora las claves
 * que no conoce**, emitir las dos grafías es gratis y es la defensa barata. El
 * precedente de la casa es `origen.ts:39` (`sourceId ?? sourceID`).
 *
 * **Al leer se aceptan las dos; al escribir manda la que el binario entiende.**
 */

/** El dialecto muere acá: lo que llega, ya en vocabulario Hermes. */
export interface CitaEntrante {
  /** El `external_id` del mensaje citado, con la receta de siempre (`wa:<id>`). */
  mensajeExternalId: string;
}

/**
 * Lo que sale: la cita que acompaña a un envío nuestro.
 *
 * Lleva el id CRUDO (sin `wa:`) porque es lo que WhatsApp entiende, y lleva
 * `esNuestro` porque el `participant` del proto es **de quién era el mensaje
 * citado** — no de quien responde. Con el nuestro puesto ahí, el cliente del
 * lead dibuja la tirita atribuida a la persona equivocada.
 */
export interface CitaSaliente {
  /** El id de WhatsApp del mensaje citado, sin el prefijo `wa:`. */
  mensajeId: string;
  /** ¿El mensaje citado lo mandamos NOSOTROS? Decide el `participant`. */
  esNuestro: boolean;
  /** Lo que decía. Va en `quotedMessage` para que la tirita llegue con texto. */
  texto?: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Las dos grafías, en el orden en que hay que creerles: primero la del binario. */
function idDeContexto(c: Record<string, unknown>): string | null {
  return texto(c.stanzaID) ?? texto(c.stanzaId);
}

/**
 * Busca el `contextInfo` con cita a CUALQUIER profundidad — no en tres rutas
 * fijas. Es el mismo patrón (y el mismo motivo) que `buscarAnuncio` en
 * `origen.ts`: WhatsApp cuelga el `contextInfo` del proto del tipo de mensaje
 * que sea (texto, imagen, video, sticker) y a veces de un wrapper (`viewOnce`),
 * así que mirar solo `extendedTextMessage` perdería toda cita a un adjunto.
 *
 * ⚠️ **El de AFUERA gana.** Se mira `o.contextInfo` ANTES de recorrer los hijos,
 * y eso importa: dentro de `contextInfo.quotedMessage` puede venir el mensaje
 * citado ENTERO, con su propio `contextInfo` de cuando él citó a otro. Sin este
 * orden, responder a una respuesta apuntaría dos escalones más atrás.
 */
function buscarContexto(obj: unknown, prof = 0): Record<string, unknown> | null {
  if (obj == null || typeof obj !== 'object' || prof > 6) return null;
  const o = obj as Record<string, unknown>;
  const ctx = o.contextInfo;
  if (ctx && typeof ctx === 'object' && idDeContexto(ctx as Record<string, unknown>)) {
    return ctx as Record<string, unknown>;
  }
  for (const v of Object.values(o)) {
    const encontrado = buscarContexto(v, prof + 1);
    if (encontrado) return encontrado;
  }
  return null;
}

/**
 * ── WHATSMEOW ──
 * `message.<loQueSea>.contextInfo = { stanzaID, participant, quotedMessage }`.
 *
 * Un `contextInfo` SIN `stanzaID` no es una cita: es el que trae el
 * `externalAdReply` del Click-to-WhatsApp (ver `origen.ts`), que acompaña al
 * primer mensaje de medio mundo. Tratarlo como cita colgaría una tirita vacía de
 * cada lead que vino de un anuncio.
 */
export function citaDeWhatsmeow(message: Record<string, unknown>): CitaEntrante | null {
  const ctx = buscarContexto(message);
  const id = ctx ? idDeContexto(ctx) : null;
  return id ? { mensajeExternalId: externalIdDeWa(id) } : null;
}

/**
 * ── CLOUD API ──
 * `{ context: { id, from } }` en el mensaje entrante. Meta manda `context`
 * también para reenvíos (`forwarded`) y para el referral de un anuncio, y en
 * esos casos **no hay `id`** — sin id no hay a qué colgarse, y una cita colgada
 * de la nada es peor que ninguna.
 */
export function citaDeCloudApi(m: { context?: { id?: string } | null } | null | undefined): CitaEntrante | null {
  const id = texto(m?.context?.id);
  return id ? { mensajeExternalId: externalIdDeWa(id) } : null;
}

/**
 * EL PROTO DE SALIDA de whatsmeow — `extendedTextMessage.contextInfo`.
 *
 * Puro y con nombre propio para poder interrogarlo: la grafía correcta del campo
 * es exactamente el tipo de detalle que un test tiene que poder fijar, porque
 * equivocarse **no da error** (el mensaje sale, sin cita).
 *
 * `quotedMessage` solo va si tenemos el texto. Mandarlo vacío no ayuda a nadie:
 * el link real lo hace el `stanzaID`, y el cliente del lead ya tiene el mensaje
 * citado guardado. Un `{ conversation: '' }` solo agregaría una tirita en blanco.
 */
export function contextInfoDeCita(
  cita: CitaSaliente,
  jids: { propio: string; contacto: string },
): Record<string, unknown> {
  return {
    // 🔴 Las DOS grafías. La que el binario Go lee es `stanzaID`; `stanzaId` es la
    // que declara el `.d.ts` y la que `encoding/json` descarta sin decir nada. Se
    // mandan las dos porque descartar una clave desconocida es gratis y adivinar
    // mal cuesta el frente entero. Ver el encabezado de este archivo.
    stanzaID: cita.mensajeId,
    stanzaId: cita.mensajeId,
    participant: cita.esNuestro ? jids.propio : jids.contacto,
    ...(cita.texto ? { quotedMessage: { conversation: cita.texto } } : {}),
  };
}
