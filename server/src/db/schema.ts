import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
    /**
     * ¿Lo mandó la AUTO-RESPUESTA fuera de horario (#125, ADR 0015) en vez de
     * una persona? Default `false`: todo lo que existía es humano, y lo sigue
     * siendo salvo que se diga lo contrario. Esta columna es la que hace
     * auditable la excepción a «un envío = una acción humana»: sin ella,
     * dentro de un mes nadie podría distinguir qué mandó la máquina. También
     * es la que le pone la marca a la burbuja en el hilo.
     */
    automatico: boolean("automatico").notNull().default(false),
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

/**
 * LA AGENDA DE LA VENDEDORA — seguimientos agendados a mano.
 *
 * "Lo llamo mañana", "le mando el temario el lunes". Cada fila es UNA promesa
 * de la vendedora consigo misma, atada a una conversación. Un recordatorio
 * JAMÁS envía nada solo (invariante de Hermes): cuando vence, aparece en la
 * vista Agenda — el envío sigue siendo una acción humana.
 */
export const recordatorios = pgTable(
  "recordatorios",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** De quién es la promesa. Cada vendedora ve SU agenda. */
    vendedoraId: text("vendedora_id").notNull(),
    /** La conversación de referencia (la clave de la cola) + lo mínimo para reabrirla. */
    clave: text("clave").notNull(),
    canal: text("canal").notNull(),
    personaId: text("persona_id"),
    personaNombre: text("persona_nombre"),
    numeroPropio: text("numero_propio"),
    /** Qué prometió hacer: "llamarla", "mandarle el temario"… */
    nota: text("nota").notNull(),
    /** Cuándo. Con hora: la agenda es un calendario, no una lista de deseos. */
    cuando: timestamp("cuando", { withTimezone: true }).notNull(),
    /** pendiente | hecho. Se marca a mano, como todo lo que importa. */
    estado: text("estado").notNull().default("pendiente"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("recordatorios_agenda_idx").on(t.vendedoraId, t.estado, t.cuando)],
);

/**
 * EL REGISTRO DE GESTIÓN — la bitácora comercial de cada conversación.
 *
 * Cada vez que la vendedora trabaja un contacto, registra: en qué ETAPA del
 * embudo quedó, cuál es la PRÓXIMA ACCIÓN (wsp de seguimiento, llamada, correo,
 * reunión) y las NOTAS de acuerdos. Append-only como todo lo que importa: la
 * etapa actual de una conversación es la de su ÚLTIMA gestión — el historial
 * completo queda como auditoría de cómo se trabajó el lead.
 */
export const gestiones = pgTable(
  "gestiones",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    vendedoraId: text("vendedora_id").notNull(),
    /** La conversación (clave de la cola) + lo mínimo para reabrirla. */
    clave: text("clave").notNull(),
    canal: text("canal").notNull(),
    personaId: text("persona_id"),
    personaNombre: text("persona_nombre"),
    numeroPropio: text("numero_propio"),
    /** nuevo | contactado | interesado | cotizado | venta | perdido. */
    etapa: text("etapa").notNull(),
    /** wsp | llamada | correo | reunion — null si no hay próxima acción. */
    proximaAccion: text("proxima_accion"),
    proximaFecha: timestamp("proxima_fecha", { withTimezone: true }),
    /** Acuerdos y comentarios de esta gestión. */
    notas: text("notas"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // (clave, creado_at DESC): el orden EXACTO del DISTINCT ON canónico de
    // `cola/etapaEfectivaSql.ts` (ultimasGestionesSql) — la última gestión por
    // conversación sale del índice, sin sort. También sirve al historial de
    // una clave (`GET /api/gestiones/de/:clave`, ORDER BY creado_at DESC).
    index("gestiones_conversacion_idx").on(t.clave.asc(), t.creadoAt.desc()),
    index("gestiones_vendedora_idx").on(t.vendedoraId, t.creadoAt),
  ],
);

/**
 * ETIQUETAS DE CONVERSACIÓN — compartidas por el equipo.
 *
 * Pocas, de colores, para marcar lo que importa ("interesada", "precio",
 * "reclamo"). Viven por conversación (la clave de la cola) y las ve todo el
 * equipo: son coordinación, no notas privadas.
 */
export const etiquetas = pgTable(
  "etiquetas",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** La conversación etiquetada (clave de la cola). */
    clave: text("clave").notNull(),
    etiqueta: text("etiqueta").notNull(),
    /** Quién la puso — para saber a quién preguntarle. */
    vendedoraId: text("vendedora_id").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clave, t.etiqueta), index("etiquetas_clave_idx").on(t.clave)],
);

/**
 * INTERESES — qué curso(s) quiere esta persona. Puede tener varios.
 *
 * Es la compuerta honesta del embudo: a "cotizado" no se llega sin saber QUÉ
 * se está cotizando. Se registran a mano (la vendedora lo escuchó) o solos al
 * registrar una cotización/venta (los productos de la orden SON el interés).
 */
export const intereses = pgTable(
  "intereses",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** La conversación (clave de la cola). */
    clave: text("clave").notNull(),
    /** El nombre del producto/curso tal como está en Cerberus. */
    curso: text("curso").notNull(),
    vendedoraId: text("vendedora_id").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.clave, t.curso), index("intereses_clave_idx").on(t.clave)],
);

/**
 * CORREOS ENVIADOS — la auditoría del canal email.
 *
 * Un correo = UNA vendedora, UN destinatario, una acción humana — la misma
 * filosofía que EnvioControlado. Acá queda quién mandó qué a quién y si salió,
 * incluidos los intentos fallidos. Sin listas, sin campañas: eso es otra
 * herramienta y otra política.
 */
export const correos = pgTable(
  "correos",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    vendedoraId: text("vendedora_id").notNull(),
    para: text("para").notNull(),
    asunto: text("asunto").notNull(),
    cuerpo: text("cuerpo").notNull(),
    /** La conversación de origen, si vino de un chat (ata el correo al lead). */
    clave: text("clave"),
    /** enviado | fallido. */
    estado: text("estado").notNull(),
    motivo: text("motivo"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("correos_vendedora_idx").on(t.vendedoraId, t.creadoAt)],
);

/**
 * CACHE DE FOTOS DE PERFIL — la foto de WhatsApp de cada contacto, traída una vez.
 *
 * Pedirle la foto a WhatsApp cuesta una llamada por contacto; sin cache, cada vez
 * que la vendedora abre una ficha se vuelve a pedir (rate-limit, riesgo de ban).
 * Acá queda qué se trajo y cuándo. Los bytes viven en disco como la media
 * (`RUTA_MEDIA`); esta fila dice dónde y —clave— si el contacto NO tiene foto
 * (`archivo` null tras preguntar), para no volver a preguntar en cada render.
 */
export const fotosPerfil = pgTable("fotos_perfil", {
  /** Teléfono normalizado del contacto (la clave con la que llega a la interfaz). */
  telefono: text("telefono").primaryKey(),
  /** El id de la foto en WhatsApp: cambia al cambiarla (sirve para refrescar). */
  fotoId: text("foto_id"),
  /** Nombre del archivo local con los bytes; null = ya preguntamos y NO tiene foto. */
  archivo: text("archivo"),
  mime: text("mime"),
  actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * NÚMEROS PROPIOS DE WHATSAPP — el registro de qué números atiende Hermes y qué
 * significa cada uno. Es una COPIA local: la fuente humana es Cerberus (el panel),
 * que la empuja por `PUT /api/admin/numeros/:numero`. Hermes la necesita para
 * etiquetar la cola y para rutear los envíos por el número correcto.
 *
 * NO guarda credenciales: la sesión de WhatsApp vive en `.wa-sessions/<numero>.db`
 * (gitignored). Acá solo vive el SIGNIFICADO del número.
 */
export const numerosWa = pgTable("numeros_wa", {
  /** Canónico: solo dígitos con código de país (`51986394450`). */
  numero: text("numero").primaryKey(),
  /** Nombre visible: «Escuela — línea principal», «Campaña diplomado». */
  etiqueta: text("etiqueta").notNull(),
  /** escuela | campana | vendedora. Categoriza el número; NO es la asignación. */
  proposito: text("proposito").notNull().default("escuela"),
  /** Solo `campana`: a qué campaña/anuncio ata (adId). */
  referencia: text("referencia"),
  activo: boolean("activo").notNull().default(true),
  /** Cuándo quedó vinculada la sesión `.db` (null si nunca se vinculó). */
  vinculadoAt: timestamp("vinculado_at", { withTimezone: true }),
  creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * MAPA NÚMERO ↔ VENDEDORA — muchos-a-muchos, SOLO etiqueta y atribución.
 *
 * Decisión de Estephano (2026-07-24): la cola NO se filtra por vendedora, sigue
 * siendo una sola pantalla compartida. Asignar una vendedora a un número lo
 * organiza/etiqueta; no crea una bandeja privada. Un número puede tener varias
 * vendedoras y una vendedora varios números. La atribución de la venta la sigue
 * dando el token (`vendedoraId`), no este mapa.
 */
export const numeroVendedora = pgTable(
  "numero_vendedora",
  {
    numero: text("numero")
      .notNull()
      .references(() => numerosWa.numero, { onDelete: "cascade" }),
    /** Username de Cerberus (misma clave que `vendedoraId` en envios_wa/gestiones). */
    vendedoraId: text("vendedora_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.numero, t.vendedoraId] }),
    index("numero_vendedora_vendedora_idx").on(t.vendedoraId),
  ],
);

/**
 * CATEGORÍAS — el catálogo de etiquetas con color, POR VENDEDORA (#48, ADR 0011).
 *
 * Las etiquetas de texto libre subieron de nivel: pasan a ser CATEGORÍAS con
 * color elegible. Esta tabla es el CATÁLOGO (el nombre + su color + si es
 * favorita + el orden), personal de cada vendedora — se keyea por `vendedora_id`
 * igual que `gestiones`/`recordatorios`.
 *
 * OJO — la ASIGNACIÓN (qué conversación lleva qué categoría) sigue viviendo en
 * `etiquetas` (compartida por el equipo, sin tocar). La identidad-por-string es
 * el puente: `etiquetas.etiqueta` matchea `categorias.nombre` y se resuelve AL
 * COLOR DE QUIEN MIRA (`categorias.vendedora_id = <viewer>`). Una etiqueta cuyo
 * string no matchea ninguna categoría del que mira se pinta neutra. El color lo
 * resuelve el front con el mapa de `GET /api/categorias`; la tabla compartida no
 * se toca.
 *
 * `color` guarda la CLAVE de la paleta fija (`azul`, `rojo`…), validada por Zod
 * contra `categorias/paleta.ts`. Nunca oro: el oro es tiempo que se acaba.
 */
export const categorias = pgTable(
  "categorias",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** Personal: cada vendedora tiene su libreta. La 2ª vendedora arranca vacía (seed perezoso). */
    vendedoraId: text("vendedora_id").notNull(),
    /** ≤30, trim+lowercase — es la clave de join contra `etiquetas.etiqueta`. */
    nombre: text("nombre").notNull(),
    /** Clave de la paleta fija (`categorias/paleta.ts`), validada por Zod enum. Sin oro. */
    color: text("color").notNull(),
    /** Chip candidato de la barra/cola (los filtros de favoritas son de #49). */
    esFavorito: boolean("es_favorito").notNull().default(false),
    /** Orden manual del catálogo. */
    orden: integer("orden").notNull().default(0),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.vendedoraId, t.nombre),
    index("categorias_vendedora_idx").on(t.vendedoraId, t.orden),
  ],
);

/**
 * NOTAS — el «Notion» a una tecla (issue #47). Reemplaza el campo `notas` de
 * `gestiones`: ese es append-only (una fila por gestión, la etapa es la última),
 * así que un typo queda grabado para siempre y una nota apócrifa puede ensuciar
 * la etapa (`RegistrarGestion` mandaba `etapa: etapaActual ?? 'interesado'` solo
 * para poder guardar una nota). Esta nota es EDITABLE por su autora, se archiva
 * sin borrarse, y no deriva nada: de acá no sale etapa, ni recordatorio, ni
 * envío. Ver ADR 0012.
 *
 * `clave` ancla la nota a una conversación (`conv:…` / `int:…` / `lead:…`) o vale
 * `'general'` para la libreta personal de la vendedora (atajo «n», sin `clave`).
 * `vendedoraId` es la autora: v1 es por autora, no se comparte con el equipo
 * (a diferencia de `etiquetas`) — promoverlo a «del equipo» es otro frente.
 */
export const notas = pgTable(
  "notas",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    clave: text("clave").notNull(),
    vendedoraId: text("vendedora_id").notNull(),
    texto: text("texto").notNull(),
    /** Sube la nota al tope de su ancla. */
    fijada: boolean("fijada").notNull().default(false),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    /** null = nunca editada; se setea en cada PATCH. */
    editadoAt: timestamp("editado_at", { withTimezone: true }),
    /** null = viva. No hay borrado físico. */
    archivadoAt: timestamp("archivado_at", { withTimezone: true }),
  },
  (t) => [
    index("notas_clave_idx").on(t.clave, t.creadoAt),
    index("notas_vendedora_idx").on(t.vendedoraId, t.creadoAt),
    // La búsqueda de la libreta es GIN sobre to_tsvector('spanish', texto) — drizzle-kit
    // no la emite (no hay expression index para tsvector en el dialecto pg-core de
    // drizzle-orm 0.45): se crea A MANO tras `db:push`. Ver docs/deploy-vps1.md.
    // Sin ella, GET /api/notas?q= degrada a seq scan — no revienta, solo es lento.
  ],
);

/**
 * ESTADO PERSONAL DE LA CONVERSACIÓN — todo lo que la vendedora decide sobre una
 * conversación de la cola (la fija, la marca favorita, hasta dónde la leyó), una
 * fila por (vendedora, conversación). La cola potenciada (#49) la une con UN solo
 * LEFT JOIN a la consulta caliente. Por vendedora, como `gestiones`/`recordatorios`.
 *
 * DERIVAR LO DERIVABLE (regla de la casa): NO se guarda «no leído». Se guarda el
 * CURSOR (`leido_hasta` = cuándo abrió el hilo); `no_leido` se deriva en la
 * consulta (`max(occurred_at entrante) > leido_hasta`). Es distinto de
 * `respondida` (que es «hay un saliente posterior al último entrante»): una
 * conversación puede estar leída sin responder, y viceversa.
 *
 * `fijada` es el pin (banda arriba de la cola, tope 3 por vendedora); `fijada_at`
 * ordena la banda y sirve para contar el tope. La PK compuesta (vendedora, clave)
 * es a la vez la clave de upsert y la garantía de una sola fila por par.
 */
export const estadoConversacion = pgTable(
  "estado_conversacion",
  {
    /** De quién es este estado. Cada vendedora tiene el suyo (el pin de A no lo ve B). */
    vendedoraId: text("vendedora_id").notNull(),
    /** La conversación (clave transversal de la cola): `conv:…` / `int:…` / `lead:…`. */
    clave: text("clave").notNull(),
    /** Pin: sube la conversación a la banda de arriba de todo (tope 3). */
    fijada: boolean("fijada").notNull().default(false),
    /** Cuándo se fijó — ordena la banda (más viejo primero) y cuenta contra el tope. */
    fijadaAt: timestamp("fijada_at", { withTimezone: true }),
    /** Favorita: entra al tab «Favoritos». */
    favorita: boolean("favorita").notNull().default(false),
    /** CURSOR de lectura: cuándo abrió el hilo por última vez. `no_leido` se deriva de acá. */
    leidoHasta: timestamp("leido_hasta", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.vendedoraId, t.clave] }),
    index("estado_conversacion_pin_idx").on(t.vendedoraId, t.fijada),
    index("estado_conversacion_fav_idx").on(t.vendedoraId, t.favorita),
  ],
);

/**
 * LA COLA DE AUTO-RESPUESTAS (#125, ADR 0015) — lo que se le va a decir a
 * alguien que escribió fuera de horario, y a qué hora exacta.
 *
 * Existe como TABLA y no como un `setTimeout` por tres razones que son el
 * contrato de esta feature:
 *
 *   · **Se puede mirar antes de que pase.** El simulacro (`npm run
 *     auto:simulacro`) imprime el plan sin mandar nada; acá queda el plan que
 *     de verdad se va a ejecutar.
 *   · **Sobrevive a un restart.** Un proceso que se reinicia a las 7:29 no
 *     puede olvidarse de la cola ni —peor— mandarla toda de golpe al volver.
 *   · **Es auditable después.** Queda la hora PROGRAMADA y la REAL, el estado
 *     final y el motivo: se puede mirar el patrón desde afuera y ajustarlo.
 *
 * `UNIQUE (clave, dia_lima)` es la garantía dura de «una auto-respuesta por
 * conversación por día»: no depende de que el código se acuerde de chequear.
 * El día es el LOCAL de Lima (`dia_lima`), no el UTC: en UTC el día cambia a
 * las 7 p. m. de Lima y partiría la noche justo en la mitad del problema.
 */
export const autoRespuestasPendientes = pgTable(
  "auto_respuestas_pendientes",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** La conversación (clave de la cola): `conv:whatsapp:<persona>:<numeroPropio>`. */
    clave: text("clave").notNull(),
    canal: text("canal").notNull().default("whatsapp"),
    telefono: text("telefono").notNull(),
    /** Desde qué número propio sale. Los techos por hora/día son POR NÚMERO. */
    numeroPropio: text("numero_propio").notNull(),
    personaNombre: text("persona_nombre"),
    /** Qué plantilla del catálogo se eligió (`autorespuesta/plantillas.ts`). */
    plantillaId: text("plantilla_id").notNull(),
    /** El texto EXACTO que se va a mandar, ya renderizado. Nada se improvisa después. */
    texto: text("texto").notNull(),
    /** El mensaje de la persona que la disparó: ordena la cola y ancla la cancelación. */
    disparadaPor: timestamp("disparada_por", { withTimezone: true }).notNull(),
    /** La hora que le tocó en el reparto. El despachador no manda nada antes. */
    programadoPara: timestamp("programado_para", { withTimezone: true }).notNull(),
    /** pendiente → enviada | cancelada | fallida. */
    estado: text("estado").notNull().default("pendiente"),
    /** Por qué se canceló o falló — en criollo, para leerlo sin abrir el código. */
    motivo: text("motivo"),
    /** El día LOCAL (`YYYY-MM-DD`) al que cuenta: la clave del «una por día». */
    diaLima: text("dia_lima").notNull(),
    /**
     * El id que devolvió WhatsApp al mandarla. Es el puente con las otras dos
     * huellas del mismo hecho: la fila de `envios_wa` (`id_externo`) y la
     * burbuja del hilo (`interactions.external_id` = `wa:` + este).
     */
    idExterno: text("id_externo"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    /** Cuándo salió DE VERDAD. Contra `programado_para` se mide si el ritmo se cumplió. */
    resueltoAt: timestamp("resuelto_at", { withTimezone: true }),
  },
  (t) => [
    unique("auto_respuestas_una_por_dia_uq").on(t.clave, t.diaLima),
    // El barrido del despachador: «lo pendiente que ya venció».
    index("auto_respuestas_pendientes_idx").on(t.estado, t.programadoPara),
    // Los techos por número y los conteos del día.
    index("auto_respuestas_numero_idx").on(t.numeroPropio, t.diaLima),
  ],
);

/**
 * EL INTERRUPTOR — una sola fila, y la única forma de apagar esto sin deploy.
 *
 * Hay DOS llaves y las dos tienen que estar puestas: `AUTO_RESPUESTA=on` en el
 * entorno (que exige tocar el server) y `encendida = true` acá. La de la base
 * existe para lo que importa cuando algo sale mal: apagar en segundos, desde la
 * app, sin esperar un deploy ni un restart que además tiraría las sesiones de
 * Cerberus de las vendedoras.
 *
 * Es también donde queda el FRENO AUTOMÁTICO: ante un `temporary_ban`, un error
 * de envío o una desconexión, el despachador escribe acá `encendida = false` con
 * el motivo y la hora, y no vuelve a intentar por su cuenta. Volver a prender es
 * una decisión humana, con el motivo a la vista.
 */
export const autoRespuestaEstado = pgTable("auto_respuesta_estado", {
  /** Siempre 1: es un singleton, y el PK lo hace imposible de duplicar. */
  id: integer("id").primaryKey().default(1),
  encendida: boolean("encendida").notNull().default(false),
  /** Por qué está como está: «freno automático: el número está suspendido…». */
  motivo: text("motivo"),
  /** Quién lo tocó por última vez: el username de la vendedora, o `sistema`. */
  actualizadoPor: text("actualizado_por"),
  actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
});
