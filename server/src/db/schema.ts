import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * CAPA 1 — EVENT STORE (crudo, append-only, fuente de verdad).
 *
 * Cada interacción que ocurre en cualquier canal aterriza aquí tal como vino,
 * sin interpretar. Nunca se borra ni se pisa: si mañana descubrimos que
 * estábamos normalizando mal, se re-proyecta desde aquí sin perder nada.
 *
 * La idempotencia vive en UNIQUE(source, externalId): reprocesar el mismo
 * lead mil veces nunca lo duplica. Eso es lo que hace que "no perder ningún
 * lead" sea una garantía y no una promesa.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // De dónde vino: 'meta_lead_ad' | 'meta_comment' | 'meta_dm' | 'whatsapp' | ...
    source: text("source").notNull(),

    // El id que le da el sistema de origen (leadgen_id de Meta, etc).
    externalId: text("external_id").notNull(),

    // Cuándo pasó DE VERDAD (created_time de Meta).
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    // Cuándo lo capturamos nosotros. La diferencia contra occurredAt ES,
    // literalmente, cuánto se enfrió el dato — el problema que vinimos a medir.
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    // El payload crudo, completo, tal cual lo devolvió la API.
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    unique("events_source_external_id_uq").on(t.source, t.externalId),
    index("events_occurred_at_idx").on(t.occurredAt),
    index("events_source_idx").on(t.source),
  ],
);

/**
 * CAPA 2 — PROYECCIÓN: leads normalizados.
 *
 * Derivada de `events`, no es la fuente de verdad. Existe para poder
 * consultarla cómodamente (buscar por email, filtrar sin atender, etc).
 * Si se corrompe o cambia el modelo, se reconstruye desde `events`.
 *
 * Meta ya trae la cadena de atribución completa (ad → adset → campaign),
 * así que la arista `Persona → Anuncio → Campaña` sale gratis.
 */
export const leads = pgTable(
  "leads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    // De qué evento salió — la trazabilidad hacia el dato crudo.
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id),

    // leadgen_id de Meta.
    leadId: text("lead_id").notNull().unique(),

    // Origen / atribución (viene entero desde Meta).
    pageId: text("page_id"),
    formId: text("form_id"),
    formName: text("form_name"),
    campaignId: text("campaign_id"),
    campaignName: text("campaign_name"),
    adsetId: text("adset_id"),
    adsetName: text("adset_name"),
    adId: text("ad_id"),
    adName: text("ad_name"),
    platform: text("platform"), // 'fb' | 'ig'
    isOrganic: boolean("is_organic"),

    // Datos de la persona. OJO: los nombres de campo los define quien arma el
    // formulario, así que NO se puede asumir un set fijo. Los conocidos se
    // normalizan aquí; todo lo demás (ej. "¿cuál_es_tu_cargo?") va a customFields.
    fullName: text("full_name"),
    email: text("email"),
    phone: text("phone"),
    country: text("country"),
    customFields: jsonb("custom_fields"),

    createdTime: timestamp("created_time", { withTimezone: true }).notNull(),

    // Estado de atención. Con 679 leads sin tocar, esto es lo que hace visible
    // el problema — y lo que después va a disparar la auto-respuesta.
    status: text("status").notNull().default("nuevo"), // nuevo | contactado | descartado | convertido
  },
  (t) => [
    index("leads_created_time_idx").on(t.createdTime),
    index("leads_campaign_id_idx").on(t.campaignId),
    index("leads_status_idx").on(t.status),
    index("leads_email_idx").on(t.email),
  ],
);

/**
 * CAPA 2 — PROYECCIÓN: interacciones de los canales conversacionales.
 *
 * Un comentario en un anuncio y un mensaje por Messenger son la misma cosa a
 * los ojos del negocio: alguien levantó la mano. La diferencia (comentario vs
 * DM, IG vs Facebook) es de canal, no de intención.
 *
 * Por eso van a UNA tabla y no a tres. La persona es lo que importa; el canal
 * es un atributo suyo. Si esto viviera en tres tablas separadas, unificar a la
 * persona después sería un dolor — y unificarla es todo el punto.
 */
export const interactions = pgTable(
  "interactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id),

    /** El id que le da Meta (comment_id, message_id). Clave de idempotencia. */
    externalId: text("external_id").notNull().unique(),

    canal: text("canal").notNull(), // 'facebook' | 'instagram' | 'whatsapp'
    tipo: text("tipo").notNull(), //   'comentario' | 'mensaje'

    /** Quién. Meta a veces no da el nombre (privacidad) — por eso es nullable. */
    personaId: text("persona_id"),
    personaNombre: text("persona_nombre"),

    texto: text("texto"),

    /** Dónde ocurrió: la publicación comentada, o la conversación. */
    pageId: text("page_id"),
    contextoId: text("contexto_id"),
    /** El texto de la publicación que originó el comentario, para dar contexto. */
    contextoTexto: text("contexto_texto"),

    /** El link para ir a verlo en Facebook/Instagram. Se resuelve a pedido. */
    permalink: text("permalink"),

    /**
     * ¿Meta deja mandarle un mensaje privado a esta persona?
     *
     * Se cachea porque preguntarlo cuesta una llamada a la API. Pero OJO: solo
     * hace falta preguntar para los comentarios de menos de 7 días. Fuera de esa
     * ventana la respuesta es NO, siempre, y se calcula en SQL sin tocar Meta.
     *
     * En números reales: de 14.458 comentarios, solo 21 están dentro de la
     * ventana. Preguntarle a Meta por los otros 14.437 sería tirar 14.437
     * llamadas a la basura.
     */
    puedePrivado: boolean("puede_privado"),
    puedePrivadoAt: timestamp("puede_privado_at", { withTimezone: true }),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),

    /** Mismo ciclo que los leads: nuevo → contactado → descartado → convertido. */
    status: text("status").notNull().default("nuevo"),
  },
  (t) => [
    index("interactions_occurred_at_idx").on(t.occurredAt),
    index("interactions_canal_idx").on(t.canal),
    index("interactions_status_idx").on(t.status),
    // Para agrupar por persona: el corazón del contact merge.
    index("interactions_persona_idx").on(t.canal, t.personaId),
    // El filtro más caliente: los pocos que todavía se pueden rescatar.
    index("interactions_ventana_idx").on(t.tipo, t.occurredAt),
  ],
);
