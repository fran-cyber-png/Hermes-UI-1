import type { InteraccionDeMeta } from "../meta/proyectarInteraccion.js";

/**
 * ══ EL WEBHOOK DE META — comentarios de FB/IG y DMs de Messenger, en vivo ══
 *
 * ── QUÉ PASABA ANTES (medido en VPS1 el 7-ago-2026) ───────────────────────
 * La app tenía la UI de FB/IG entera y cableada (`ConversacionActiva` →
 * `ResponderPanel` + `HiloMessenger`), la cola sabía ordenarlos (nivel 2,
 * `EXPIRA`) y el token de Meta veía **12 Páginas y 9 cuentas de Instagram**.
 * Y en la base de producción había **cero** eventos `meta_comment_fb`,
 * `meta_comment_ig` y `meta_message_fb`. Ni uno.
 *
 * El motivo no era un bug: la captura era un **script manual**
 * (`npm run ingest:interactions`) que nadie corría —sin cron ni timer en
 * VPS1— y **no existía webhook**. `/webhook` montaba `whatsapp`, `cerberus` y
 * `landing`, y nada más. La app estaba esperando datos que nadie le mandaba.
 * Las 12 Páginas tenían `subscribed_apps` VACÍO.
 *
 * ── LA TRADUCCIÓN VA PURA, AFUERA DEL EXPRESS ─────────────────────────────
 * `interpretar()` toma el body y devuelve la lista de interacciones a escribir,
 * sin tocar la base ni la red. Es lo que permite testear los payloads reales de
 * Meta —el eco de nuestro propio mensaje, el `verb: 'remove'`, el comentario sin
 * texto— sin levantar nada. El handler solo hace ack, escribe y loguea.
 *
 * ── IDEMPOTENTE CONTRA EL POLLING, A PROPÓSITO ────────────────────────────
 * Escribe con `guardarInteraccion`, la MISMA función que usa
 * `meta/interactionsIngestor.ts`, y con el MISMO `external_id`: el `mid` del
 * webhook de Messenger es el id que devuelve `conversations{messages{id}}`, y el
 * `comment_id` de `feed` es el `id` de `posts{comments{id}}`. Por eso los dos
 * caminos pueden convivir: el webhook trae lo de ahora, el polling sigue siendo
 * la red que recupera lo que se perdió y la única forma de traer lo viejo.
 *
 * ── PREREQUISITOS QUE NO SON CÓDIGO ───────────────────────────────────────
 *  · declarar esta URL como callback de los objetos `page` e `instagram` en el
 *    dashboard de la app de Meta (app_id `1958308695630264`), con el mismo
 *    `WHATSAPP_VERIFY_TOKEN` — es el App Secret de la MISMA app que ya firma el
 *    webhook de WhatsApp, así que la firma HMAC se reusa tal cual;
 *  · suscribir cada Página: `npm run meta:suscribir` (dry-run por default).
 * Los permisos ya estaban concedidos el 7-ago-2026 (`pages_manage_metadata`,
 * `pages_read_user_content`, `pages_messaging`, `instagram_manage_comments`,
 * `instagram_manage_messages`), así que no hace falta revisión de app.
 */

/** El `source` de cada clase de evento — el mismo vocabulario que el polling. */
export const FUENTE = {
  comentarioFb: "meta_comment_fb",
  mensajeFb: "meta_message_fb",
  comentarioIg: "meta_comment_ig",
} as const;

/**
 * Cuándo pasó. Meta manda segundos en unos campos y milisegundos en otros
 * (`entry.time` y `messaging[].timestamp` son ms; `feed.created_time` es s), y
 * el webhook de comentarios de Instagram **no manda hora ninguna**.
 *
 * Sin este cuidado el error no se ve: un timestamp en segundos leído como ms cae
 * en enero de 1970, y esa fila queda fuera de la ventana de 30 días de la cola —
 * o sea que el comentario se guarda y **no aparece en ninguna pantalla**.
 */
export function momento(segundos: unknown, respaldoMs: unknown): Date {
  const s = Number(segundos);
  if (Number.isFinite(s) && s > 0) return new Date(s * 1000);
  const ms = Number(respaldoMs);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  return new Date();
}

/** Un comentario en una publicación de una Página de Facebook (`field: 'feed'`). */
function comentarioDeFacebook(
  value: Record<string, any>,
  pageId: string,
  entryTime: unknown,
): InteraccionDeMeta | null {
  // El campo `feed` trae TODO lo que pasa en el muro: posts, reacciones,
  // compartidos. Solo el comentario es una persona hablándonos.
  if (value?.item !== "comment") return null;
  // `remove`/`hide` no son contenido nuevo. Se ignoran en vez de guardarse
  // vacíos: una fila sin texto se pinta como una burbuja muda en el hilo, que es
  // exactamente el fantasma que el fix #70 sacó de la UI.
  if (value?.verb !== "add" && value?.verb !== "edited") return null;
  const id = value?.comment_id;
  if (!id) return null;

  return {
    source: FUENTE.comentarioFb,
    raw: value,
    proyeccion: {
      externalId: String(id),
      canal: "facebook",
      tipo: "comentario",
      personaId: value.from?.id ? String(value.from.id) : null,
      // Meta oculta el nombre de quien comenta salvo que la app tenga permisos
      // avanzados. Sin nombre igual sirve: el comentario existe.
      personaNombre: value.from?.name ?? null,
      texto: value.message ?? null,
      pageId,
      contextoId: value.post_id ? String(value.post_id) : null,
      // El texto del post NO viene en el webhook (el polling sí lo trae, porque
      // pide el post entero). Se deja null antes que inventar: `contexto_texto`
      // es lo que la fila muestra como «en "…"», y un texto equivocado ahí es
      // peor que ninguno.
      contextoTexto: null,
      occurredAt: momento(value.created_time, entryTime),
    },
  };
}

/** Un comentario en una publicación de Instagram (`field: 'comments'`). */
function comentarioDeInstagram(
  value: Record<string, any>,
  pageId: string,
  entryTime: unknown,
): InteraccionDeMeta | null {
  const id = value?.id;
  if (!id) return null;

  return {
    source: FUENTE.comentarioIg,
    raw: value,
    proyeccion: {
      externalId: String(id),
      canal: "instagram",
      tipo: "comentario",
      personaId: value.from?.id ? String(value.from.id) : null,
      // En Instagram el @usuario suele ser lo único que da Meta — y alcanza para
      // responderle. Mismo orden de precedencia que el polling.
      personaNombre: value.from?.username ?? value.username ?? null,
      texto: value.text ?? null,
      pageId,
      contextoId: value.media?.id ? String(value.media.id) : null,
      contextoTexto: null,
      // El webhook de comentarios de IG no manda hora: se usa la del `entry`.
      occurredAt: momento(undefined, entryTime),
    },
  };
}

/**
 * Un mensaje de Messenger o de un DM de Instagram (`entry[].messaging[]`).
 *
 * ⚠️ **`is_echo` es NUESTRO propio mensaje**, no uno del lead: Meta nos devuelve
 * por el webhook todo lo que la Página manda, incluso desde la Bandeja de
 * Entrada de Business Suite. Tratarlo como entrante haría que la cola contara
 * como «deuda» las respuestas que ya dimos, y `respondida` diría lo contrario de
 * lo que pasó. Se guarda igual —marcado saliente— porque el polling ya aprendió
 * que tirar nuestras propias respuestas deja la base sin saber a quién le
 * contestamos.
 */
function mensajeDeMeta(
  m: Record<string, any>,
  pageId: string,
  canal: "facebook" | "instagram",
): InteraccionDeMeta | null {
  const mid = m?.message?.mid;
  if (!mid) return null; // acuses de lectura, entregas, postbacks: no son mensajes

  const esDeLaPagina = Boolean(m.message?.is_echo) || String(m.sender?.id ?? "") === pageId;
  const personaId = esDeLaPagina ? m.recipient?.id : m.sender?.id;

  return {
    source: FUENTE.mensajeFb,
    raw: m,
    proyeccion: {
      externalId: String(mid),
      canal,
      tipo: "mensaje",
      direccion: esDeLaPagina ? "saliente" : "entrante",
      // Hoy todo lo saliente por acá es humano. El día que se prenda un bot en
      // Messenger, esto se marca 'bot' y recién ahí se puede medir si vende
      // mejor o peor que una persona.
      autor: esDeLaPagina ? "pagina" : "persona",
      personaId: esDeLaPagina ? null : (personaId ? String(personaId) : null),
      personaNombre: null, // el webhook no manda el perfil; se resuelve aparte
      texto: m.message?.text ?? null,
      pageId,
      // La conversación (`t_...`) no viaja en el webhook: viene el PSID, que es
      // lo que agrupa igual. El polling guarda el `conversation_id`; acá se deja
      // null antes que poner otra cosa con el mismo nombre.
      contextoId: null,
      contextoTexto: null,
      occurredAt: momento(undefined, m.timestamp),
    },
  };
}

/**
 * QUÉ HAY QUE ESCRIBIR — puro. Devuelve la lista de interacciones que el body
 * contiene, en orden. Un payload que no entendemos devuelve `[]`, nunca tira: el
 * webhook tiene que responder 200 igual, o Meta reintenta y termina
 * desactivando la suscripción.
 */
export function interpretar(body: unknown): InteraccionDeMeta[] {
  const b = body as Record<string, any> | null;
  const objeto = b?.object;
  if (objeto !== "page" && objeto !== "instagram") return [];
  const canal = objeto === "instagram" ? "instagram" : "facebook";

  const salida: InteraccionDeMeta[] = [];

  for (const entry of b?.entry ?? []) {
    const pageId = String(entry?.id ?? "");
    if (!pageId) continue;

    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value) continue;
      const item =
        change.field === "feed"
          ? comentarioDeFacebook(value, pageId, entry?.time)
          : change.field === "comments"
            ? comentarioDeInstagram(value, pageId, entry?.time)
            : null;
      if (item) salida.push(item);
    }

    for (const m of entry?.messaging ?? []) {
      const item = mensajeDeMeta(m, pageId, canal);
      if (item) salida.push(item);
    }
  }

  return salida;
}
