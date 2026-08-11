import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * EL RUTEO POR CAMPAÑA — «esta campaña cae en esta vendedora».
 *
 * ── Por qué CAMPAÑA y no anuncio (medido el 11-ago-2026) ──
 * Lo único que Meta manda en el `referral` de un click-to-WhatsApp es el
 * **ad_id** (`source_id`) y el titular del creativo. En 30 días llegaron **13
 * anuncios distintos que son 2 campañas**: `[JUL] INTELIGENCIA | WSP` son nueve
 * anuncios y `[AGO] OSINT - INTERACCIONES - 11 - 31` son cuatro. Rutear por
 * anuncio serían trece renglones para dos decisiones, y cada anuncio nuevo de la
 * misma campaña nacería sin regla.
 *
 * 🔴 **Y el TITULAR no sirve como identidad**: el mismo `ad_id`
 * (`120248616484060016`) aparece con dos titulares distintos —«Inteligencia
 * Estratégica» y «I Foro de Estado 2026»— porque el creativo cambió. Agrupar por
 * titular partiría una campaña en dos y juntaría dos en una, sin un solo síntoma.
 */

/**
 * DE QUÉ CAMPAÑA ES CADA ANUNCIO — la copia local de lo que dice Meta.
 *
 * 🔴 **NO es un caché, es una PRECONDICIÓN.** El reparto ocurre adentro del
 * webhook, con un lead esperando del otro lado: ahí no se le puede preguntar
 * nada a la Graph API (una llamada de red que puede tardar o fallar decidiría a
 * quién le cae el lead). Así que el webhook resuelve `ad_id → campaña` **contra
 * esta tabla y nada más**, y un anuncio que no está acá cae a la rueda de
 * siempre — fail-open, como todo el reparto.
 *
 * Se llena con `POST /api/routing/refrescar` (el botón de la pantalla) o con
 * `npm run routing:refrescar`. Nunca desde un GET: una escritura escondida
 * adentro de una lectura hace que mirar la pantalla cambie el estado.
 */
export const campanaAnuncio = pgTable(
  "campana_anuncio",
  {
    /** El `source_id` del referral de Meta. Es la llave que llega en el webhook. */
    adId: text("ad_id").primaryKey(),
    campanaId: text("campana_id").notNull(),
    /** El nombre tal como lo escribió quien armó la pauta (`[AGO] OSINT …`). */
    campanaNombre: text("campana_nombre").notNull(),
    /**
     * El `effective_status` de la CAMPAÑA, crudo (`ACTIVE`, `PAUSED`, …). Se
     * guarda tal cual y se traduce al leer: un estado nuevo de Meta tiene que
     * poder entrar sin una migración.
     */
    estado: text("estado").notNull(),
    /** Cuándo se le preguntó a Meta. Sin esto no se sabe si la foto está vieja. */
    actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campana_anuncio_campana_idx").on(t.campanaId)],
);

/**
 * LA REGLA: qué campaña cae en qué vendedora, por línea.
 *
 * ⚠️ **La tabla arranca VACÍA y eso es el interruptor.** Sin filas, el reparto
 * es exactamente el round-robin de hoy; la primera regla la crea una persona
 * eligiendo en la pantalla. No hace falta una bandera de encendido: elegir *es*
 * encender.
 *
 * ⚠️ **Sigue siendo un FILTRO, no un permiso** (como todo `conversacion_asignada`):
 * decide a quién le APARECE primero y quién queda de responsable, no quién puede
 * abrir el chat.
 *
 * La regla se aplica **una vez, en el primer mensaje**. Cambiarla no reasigna lo
 * ya repartido: una conversación que cambia de manos en medio de la charla es
 * peor que una mal repartida.
 */
export const campanaRuteo = pgTable(
  "campana_ruteo",
  {
    /** La línea que recibe (hoy solo la de Cloud API). */
    numeroPropio: text("numero_propio").notNull(),
    campanaId: text("campana_id").notNull(),
    /** Username de Cerberus, verificado contra los destinos posibles antes de escribir. */
    vendedoraId: text("vendedora_id").notNull(),
    /** Quién la puso. Sin esto una regla es una decisión sin dueño. */
    asignadaPor: text("asignada_por"),
    asignadaEn: timestamp("asignada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.numeroPropio, t.campanaId] })],
);
