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

    /**
     * 'entrante' (nos habló) | 'saliente' (le hablamos).
     *
     * Existía un bug: la ingesta DESCARTABA los mensajes salientes de la Página. Resultado: la
     * base no sabía a quién le habíamos respondido, y todo relato sobre "N personas esperando"
     * era indemostrable con nuestros propios datos. Las 94.371 filas viejas son todas entrantes
     * (es lo único que se guardó), así que el default es honesto.
     */
    direccion: text("direccion").notNull().default("entrante"),

    /**
     * Quién escribió: 'persona' | 'pagina' | 'bot'.
     *
     * Revelar que un interlocutor es un bot reduce las compras un 79,7% (Luo, Tong, Fang & Qu,
     * 2019, Marketing Science — experimento de campo, 6.200 clientes reales). Es el efecto más
     * grande y mejor identificado de toda la literatura de conversión.
     *
     * Si no registramos quién respondió, no podemos medir el costo de nuestra propia honestidad.
     */
    autor: text("autor").notNull().default("persona"),

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

/**
 * AUDITORÍA DE ENVÍOS DE WHATSAPP.
 *
 * Cada intento de envío queda acá: quién (vendedora), desde qué número, a quién,
 * qué, y cómo terminó (pendiente → enviado | fallido). Es lo que hace que una
 * comisión sea atribuible y que un envío bloqueado (corta-corriente, ban) deje
 * rastro. SEPARADO de la interacción saliente: la interacción es "qué se dijo en
 * el hilo"; esto es "quién apretó enviar y qué pasó".
 */
export const enviosWa = pgTable(
  "envios_wa",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** El username de Cerberus de la vendedora que mandó. Sin esto no hay envío. */
    vendedoraId: text("vendedora_id").notNull(),
    /** El número propio de Goberna desde el que salió. */
    numeroPropio: text("numero_propio").notNull(),
    telefono: text("telefono").notNull(),
    texto: text("texto").notNull(),
    /** La conversación de referencia: ata el envío a un contexto. */
    referencia: text("referencia").notNull(),
    /** pendiente → enviado | fallido. */
    estado: text("estado").notNull().default("pendiente"),
    /** El id que devolvió el transporte cuando el envío salió (null si falló). */
    idExterno: text("id_externo"),
    /** El motivo cuando falló o quedó bloqueado. */
    motivo: text("motivo"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().default(sql`now()`),
    resueltoAt: timestamp("resuelto_at", { withTimezone: true }),
  },
  (t) => [
    index("envios_wa_vendedora_idx").on(t.vendedoraId),
    index("envios_wa_telefono_idx").on(t.telefono),
  ],
);

/**
 * CONVERSIÓN: un lead de WhatsApp que se volvió venta.
 *
 * Es la captura del embudo que hoy no existe en ningún lado: qué vendedora
 * convirtió a quién, desde qué origen (el anuncio o la landing por donde llegó), y
 * cuándo. La venta EN SÍ se crea en Cerberus (Hermes flaco / Cerberus gordo); acá
 * queda el eslabón que ata el lead de WhatsApp con esa venta, para que Ivi pueda
 * responder "cuánto convierte un lead de WhatsApp" y "qué vendedora cierra más".
 */
export const conversionesWa = pgTable(
  "conversiones_wa",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** La vendedora que registró la venta (username de Cerberus). */
    vendedoraId: text("vendedora_id").notNull(),
    telefono: text("telefono").notNull(),
    nombre: text("nombre"),
    /** El id de cliente en Cerberus, si ya existía (match por teléfono). */
    cerberusClienteId: bigint("cerberus_cliente_id", { mode: "number" }),
    /** De dónde vino el lead (anuncio/landing), tal como se capturó. La atribución. */
    origen: jsonb("origen"),
    iniciadaAt: timestamp("iniciada_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index("conversiones_wa_vendedora_idx").on(t.vendedoraId),
    index("conversiones_wa_telefono_idx").on(t.telefono),
  ],
);
