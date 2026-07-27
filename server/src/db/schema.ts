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

    /**
     * ══ LA PROCEDENCIA (épica #169, frente 1) ═══════════════════════════════
     *
     * De qué PIEZA salió lo que se mandó. Sin esto, una secuencia con 500 usos
     * y 0 ventas se ve idéntica a una con 500 usos y 50: contábamos disparos y
     * nunca blancos.
     *
     * **Las cuatro primeras en `null` = lo escribió la vendedora a mano, y eso
     * es la LÍNEA DE BASE**, no un dato faltante: es contra el texto que ella
     * habría escrito igual que se compara todo lo demás. El vocabulario y las
     * reglas viven una vez, puras, en `procedencia/pieza.ts` — nadie arma estas
     * columnas a mano.
     *
     * `pieza_clase` + `pieza_ref` son la identidad de la pieza DENTRO de su
     * catálogo, a propósito textual y no una FK: el frente 2 de la épica unifica
     * los cuatro catálogos, y con una FK a `plantilla_pasos.id` esa unificación
     * obligaría a migrar (o a tirar) todo lo acumulado hasta entonces.
     */
    piezaClase: text("pieza_clase"),
    piezaRef: text("pieza_ref"),
    /**
     * QUÉ TEXTO ERA: sha256 del contenido AUTORAL de la pieza (la plantilla sin
     * resolver + su archivo), en hex.
     *
     * Sin esto el lazo mide un blanco móvil y no lo dice: el día que alguien
     * mejore una frase, los dos textos se suman y una pieza que pasó de 12 % a
     * 30 % se reporta 21 % para siempre. Y no se puede arreglar después — los
     * envíos ya escritos no se pueden re-atribuir a la versión que salió.
     *
     * Es un hash y no un contador porque un contador se puede olvidar de
     * incrementar, y el bump que falta no rompe nada: mezcla dos textos en
     * silencio. El detalle y el «qué es el texto de la pieza» están en
     * `procedencia/pieza.ts`.
     */
    piezaVersion: text("pieza_version"),
    /** Por qué pantalla entró (panel-sugerencia · panel-secuencias · panel-datos · automatica). */
    piezaVia: text("pieza_via"),
    /** ¿Salió reescrito? Un dato que la vendedora tocó no le acredita entero el resultado. */
    piezaEditada: boolean("pieza_editada").notNull().default(false),
    /** El `MomentoDeVenta` (vocabulario de `sugerencias/estado.ts`) cuando salió. */
    momentoVenta: text("momento_venta"),
  },
  (t) => [
    index("envios_wa_vendedora_idx").on(t.vendedoraId),
    index("envios_wa_telefono_idx").on(t.telefono),
    /** El lazo de resultados agrupa por pieza Y VERSIÓN: sin el índice, seq scan. */
    index("envios_wa_pieza_idx").on(t.piezaClase, t.piezaRef, t.piezaVersion),
    /** La derivación mira la ventana reciente por conversación. */
    index("envios_wa_referencia_idx").on(t.referencia, t.creadoAt),
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
    // La búsqueda de la libreta es GIN sobre to_tsvector('spanish', texto). drizzle-kit
    // sigue sin emitirlo (no hay expression index para tsvector en el pg-core de
    // drizzle-orm 0.45), pero ya NO se crea a mano: vive escrito en la migración
    // `drizzle/0000_baseline.sql`. Mientras dependía de un paso manual post-`db:push`,
    // producción lo tenía y una base nueva no — el único drift real que había.
    // Sin él, GET /api/notas?q= degrada a seq scan — no revienta, solo es lento.
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
    /**
     * El estado de la fila. La máquina completa vive en
     * `autorespuesta/estados.ts` (una sola escritura, con su test):
     *   · automática — `pendiente` → enviada | cancelada | fallida
     *   · supervisada — `preparada` → aprobada → enviada | fallida | cancelada,
     *     y las dos salidas humanas/temporales: `descartada` y `caducada`.
     * El default sigue siendo `pendiente` para no cambiarle el significado a
     * ninguna fila escrita antes de ADR 0016.
     */
    estado: text("estado").notNull().default("pendiente"),
    /** Por qué se canceló o falló — en criollo, para leerlo sin abrir el código. */
    motivo: text("motivo"),
    /**
     * El día LOCAL (`YYYY-MM-DD`) del ENVÍO —el de `programado_para`, no el de
     * la corrida que la encoló—: la clave del «una por día». A las 21:30 ya no
     * queda ventana y el reparto cae mañana a las 7:30; guardarla con el día de
     * hoy haría que al pasar la medianoche esa conversación pareciera «sin
     * auto-respuesta» y la persona recibiera DOS.
     */
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

    // ── MODO SUPERVISADO (ADR 0016) — se agregan al final a propósito ─────────
    /**
     * QUIÉN dio el OK. Es el dato que hace que un mes después se pueda contestar
     * «¿esto lo mandó la máquina sola o alguien lo aprobó?». Null en modo
     * automático: ahí no aprobó nadie, y eso también es la respuesta.
     */
    aprobadaPor: text("aprobada_por"),
    aprobadaAt: timestamp("aprobada_at", { withTimezone: true }),
    /**
     * La vendedora tocó el texto antes de aprobar. Importa para leer la
     * auditoría sin adivinar: `texto` guarda SIEMPRE lo que se manda, así que
     * sin esta marca un texto editado sería indistinguible de una plantilla que
     * cambió. También dice qué plantillas conviene reescribir — si a la misma la
     * editan todas las noches, la plantilla está mal.
     */
    editada: boolean("editada").notNull().default(false),
    /**
     * La campaña/curso con la que se eligió la plantilla («INTELIGENCIA»). Se
     * GUARDA en vez de recalcularse porque la bandeja agrupa por esto y porque
     * el interés de la persona puede cambiar entre que se preparó y que se
     * aprueba: lo que se muestra tiene que ser lo que decidió el texto.
     */
    campana: text("campana"),

    // ── MODO REVISIÓN (ADR 0018) — también al final ───────────────────────────
    /**
     * DE DÓNDE SALIÓ ESA CAMPAÑA: `interes` · `lead` · `anuncio` — el eslabón
     * de la precedencia de `campana.ts` que ganó (interés asentado > formulario
     * que llenó > anuncio del que vino).
     *
     * Se guarda porque es **el porqué**, y el porqué es la mitad del modo
     * supervisado: una recomendación que no explica de dónde sale no se puede
     * supervisar, solo obedecer. «Sale del anuncio del que vino» y «sale del
     * interés que vos asentaste» son dos niveles de confianza distintos, y la
     * vendedora decide distinto según cuál sea.
     *
     * Nullable, como `campana`: una fila escrita antes de esta columna no miente,
     * dice «no sé de dónde» y el panel muestra la campaña sin la cadena.
     */
    campanaFuente: text("campana_fuente"),
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

  // ── MODO SUPERVISADO (ADR 0016) — se agrega al final a propósito ────────────
  /**
   * `apagada` · `supervisada` · `automatica`. El interruptor dejó de ser un
   * booleano cuando el dueño pidió el punto del medio (la máquina prepara, la
   * vendedora aprueba), y de un `true` no sale «supervisada».
   *
   * `encendida` de arriba SIGUE escribiéndose, derivada de acá
   * (`modo !== 'apagada'`): es lo que lee el código de ADR 0015 y lo que
   * sobrevive si algún día hay que volver atrás. La verdad es `modo`; el
   * booleano es su sombra, y la dirección no se invierte.
   */
  modo: text("modo").notNull().default("apagada"),
});

/**
 * PLANTILLAS-SECUENCIA — «varios mensajes, con imágenes y todo en orden».
 *
 * Pedido del dueño (2026-07-25): que la vendedora tenga cargado lo que ya hace,
 * en vez de tipearlo veinte veces al día. La minería de prod mostró que la venta
 * NO es un mensaje: es una secuencia (flyer → seguimiento → temario → duración),
 * que el 42 % de los mensajes lleva imagen, y que las ráfagas de 6, 7 y 8
 * salientes seguidos son frecuentes (98× / 78× / 63× en 14 días).
 *
 * Por eso una plantilla es una LISTA ORDENADA DE PASOS y no un `cuerpo` de
 * texto: modelarla como un texto largo obligaría a mandar el flyer como un
 * párrafo, y el flyer es una imagen.
 *
 * `estado` es la garantía de que nada se publica solo: lo que sale del minado
 * nace `propuesta` y **una propuesta no se puede enviar** — alguien la lee, la
 * corrige y la aprueba. `familia_curso` (no un `sku`) ata el `{precio}` a la
 * ÚLTIMA edición activa del diploma (#129): cuando la Escuela abre la edición
 * 27, ninguna plantilla queda cotizando la 26.
 */
export const plantillas = pgTable(
  "plantillas",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** Personal, como `categorias`/`recordatorios`. La 2ª vendedora arranca vacía. */
    vendedoraId: text("vendedora_id").notNull(),
    nombre: text("nombre").notNull(),
    /** Prefijo de SKU (`DIPICOT`), no un producto: resuelve `{curso}`/`{precio}` a la última edición. */
    familiaCurso: text("familia_curso"),
    /** `propuesta` (minada, no enviable) | `aprobada` (revisada por una persona). */
    estado: text("estado").notNull().default("propuesta"),
    /** `minado` (salió del histórico) | `manual` (la escribió la vendedora). */
    origen: text("origen").notNull().default("manual"),
    /** Cuántas conversaciones del histórico respaldan la propuesta. 0 si es manual. */
    respaldo: integer("respaldo").notNull().default(0),
    /** Cuántas veces se mandó. Ordena la lista: la más usada arriba. */
    usos: bigint("usos", { mode: "number" }).notNull().default(0),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete: `null` = viva. No hay borrado físico (patrón de `notas`). */
    archivadoAt: timestamp("archivado_at", { withTimezone: true }),
  },
  (t) => [index("plantillas_vendedora_idx").on(t.vendedoraId, t.archivadoAt)],
);

/**
 * LOS PASOS de una plantilla: uno por mensaje que sale. Texto, media, o las dos
 * cosas (una imagen con pie es UN mensaje de WhatsApp, no dos).
 *
 * La media se referencia por NOMBRE DE ARCHIVO dentro de `RUTA_MEDIA`, el mismo
 * directorio por el que ya pasa todo adjunto saliente — no se guardan bytes en
 * la base ni se re-sube el flyer por cada plantilla.
 *
 * `unique(plantilla_id, orden)` es lo que hace que «en orden» sea una propiedad
 * del modelo y no una convención: no existe una plantilla con dos pasos 3.
 */
export const plantillaPasos = pgTable(
  "plantilla_pasos",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    plantillaId: bigint("plantilla_id", { mode: "number" })
      .notNull()
      .references(() => plantillas.id, { onDelete: "cascade" }),
    /** 1-based: el orden en que salen. */
    orden: integer("orden").notNull(),
    /** El cuerpo, con `{nombre}` `{curso}` `{precio}`. Los emojis SÍ pasan (esto nunca va a Cerberus). */
    texto: text("texto"),
    /** Nombre del archivo en `RUTA_MEDIA`. `null` = paso de solo texto. */
    mediaArchivo: text("media_archivo"),
    mediaMime: text("media_mime"),
    /** imagen | video | audio | documento — la clase que espera el transporte. */
    mediaClase: text("media_clase"),
    mediaNombre: text("media_nombre"),
  },
  (t) => [
    unique().on(t.plantillaId, t.orden),
    index("plantilla_pasos_idx").on(t.plantillaId, t.orden),
  ],
);

/**
 * EL DICCIONARIO CAMPAÑA/ANUNCIO → FAMILIA DE CURSO (#102/#129).
 *
 * La pauta le pone al mismo diploma tres nombres distintos según dónde lo
 * escriba: la campaña dice `[JUL] INTELIGENCIA | WSP`, el formulario dice
 * «Diploma técnico en Osint & Socmint» y Cerberus dice «Diploma de
 * Especialización en Inteligencia y Contrainteligencia 14». Esta tabla es la
 * traducción, y está en la BASE —no en el código— por una razón concreta: la
 * pauta lanza campañas nuevas todas las semanas y **agregar un alias no puede
 * exigir un deploy** (menos con el server, que al reiniciar tira las sesiones de
 * Cerberus de las vendedoras).
 *
 * Lo que guarda es la IDENTIDAD, no el producto: `familia` es el prefijo de SKU
 * (`DIPICOT`), que sobrevive a las ediciones; qué edición se vende hoy se le
 * pregunta a Cerberus en el momento de confirmar (`cursos/catalogo.ts`). Si acá
 * se guardara el nombre del producto, cada edición nueva dejaría la tabla
 * mintiendo.
 *
 * Nace sembrada con `ALIAS_SEMILLA` (`cursos/alias.ts`) de forma idempotente
 * (`cursos/repositorio.ts`, `ON CONFLICT DO NOTHING`): la siembra NO pisa lo editado
 * a mano. Para sacar un alias de circulación se pone `activo = false` en vez de
 * borrarlo — un DELETE vuelve en el próximo arranque, y además se pierde el
 * porqué.
 */
export const aliasCurso = pgTable(
  "alias_curso",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /**
     * El texto que se busca dentro del nombre de la campaña, del anuncio o del
     * formulario. Se compara normalizado (sin acentos, sin mayúsculas, sin
     * puntuación) y por PALABRA ENTERA — ver `cursos/alias.ts`.
     */
    alias: text("alias").notNull(),
    /** El prefijo alfabético del SKU de Cerberus: `DIPICOT014` → `DIPICOT`. */
    familia: text("familia").notNull(),
    /** El nombre legible del curso — lo que ve la vendedora en el chip de la propuesta. */
    nombreCurso: text("nombre_curso").notNull(),
    /**
     * EL MAPEO POR ANUNCIO (26-jul-2026). Cuando está, la fila NO se busca por
     * texto: se compara exacto contra el `adId` de Meta (`origen.adId`), y su
     * `alias` pasa a ser una etiqueta humana.
     *
     * Existe porque los anuncios con más volumen sin mapear —«Adquiérelo ahora»,
     * «No lo dejes pasar», «FORMA PARTE»— no nombran ningún curso: mapear esas
     * frases haría que cualquier anuncio futuro con el mismo copy heredara el
     * curso equivocado. Lo único que identifica a ese anuncio es su id.
     */
    adId: text("ad_id"),
    /** Fuera de circulación sin perder el rastro. La consulta solo lee los activos. */
    activo: boolean("activo").notNull().default(true),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Un mismo texto no puede mapear a dos familias: la propuesta sería un volado.
    unique("alias_curso_alias_uq").on(t.alias),
    // Ni un mismo anuncio. Los NULL no chocan entre sí en Postgres, así que las
    // filas de texto (la mayoría) conviven sin problema bajo esta restricción.
    unique("alias_curso_ad_id_uq").on(t.adId),
    index("alias_curso_familia_idx").on(t.familia),
  ],
);

/**
 * LOS DATOS RECOMENDADOS — la munición de una línea que cierra ventas (#153).
 *
 * «El acceso lo tiene por todo un año» se dijo **1 vez** en 1.876
 * conversaciones. «Se puede pagar en cuotas», **2**. En los transcripts, cada
 * uno de esos desbloqueó la venta en el acto. No es que la vendedora no los
 * sepa: es que no los tiene a mano mientras escribe.
 *
 * Es una TABLA y no una constante del código por una razón sola: **lo que hoy
 * cierra ventas cambia**. Cambia el producto, cambia el país, cambia la
 * objeción de la semana. Si vive en un `const`, agregar una frase es un deploy;
 * acá es un `PUT`. `hechos/catalogo.ts` tiene el punto de partida medido, y el
 * endpoint lo sirve mientras la tabla esté vacía —o mientras falte el
 * `db:push`— en vez de mostrar un bloque vacío.
 *
 * NO son plantillas: una plantilla son varios mensajes que salen espaciados por
 * `EnvioControlado`; esto es una línea que se pega en la caja para que la
 * vendedora la lea, la edite y la mande ella.
 */
export const hechos = pgTable(
  "hechos",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    /** Slug estable: la identidad contra la que se edita. Renombrar el rótulo no rompe nada. */
    clave: text("clave").notNull().unique(),
    /** Lo que se lee en el chip. Corto: el panel mide 360 px. */
    rotulo: text("rotulo").notNull(),
    /** La frase que se pega en la caja. Una línea, en la voz de la vendedora. */
    texto: text("texto").notNull(),
    /**
     * En qué momentos de la venta corresponde (`sugerencias/estado.ts`).
     * Array vacío = en todos: el default deliberado para lo que se agregue sin
     * querer pensar dónde va.
     */
    momentos: jsonb("momentos").$type<string[]>().notNull().default([]),
    orden: integer("orden").notNull().default(100),
    /** Apagar un hecho no lo borra: la frase que dejó de funcionar sirve de historia. */
    activo: boolean("activo").notNull().default(true),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
    actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("hechos_orden_idx").on(t.activo, t.orden)],
);

/**
 * EL PADRÓN DE CLIENTES, EN COPIA LOCAL (#133) — para que la cola sepa quién ya
 * compró SIN una llamada por fila.
 *
 * ── Por qué existe ──
 * Hermes ya sabía quién es cliente: `cerberus/ficha.ts` lo pregunta por HTTP…
 * **de a una, al abrir cada conversación**. Para las 1.997 filas de la cola eso
 * son 1.997 llamadas a un Cerberus que a veces deja la conexión abierta sin
 * responder (por eso el techo de 12 s del panel). Inviable. Y sin ese dato en el
 * listado, las **140 personas que ya le compraron a Goberna se ven exactamente
 * igual que un desconocido** — siendo el lead más barato de convertir.
 *
 * Así que el padrón se SINCRONIZA (`npm run clientes:sincronizar`, mismo patrón
 * que `ingest:leads` / `ingest:icarus`) y la cola lo cruza por teléfono en la
 * MISMA pasada, como ya cruza `leads` para el chip de curso.
 *
 * ── Qué guarda, y qué no ──
 * Lo mínimo para marcar una fila: con qué llave cruzar (`sufijo`), con qué
 * desmentir un cruce mentiroso (`codigo_pais`, el falso positivo de #119) y qué
 * decir (`nivel`, `compras`). **Nombre, correo, DNI y monto gastado NO se
 * copian**: para eso está la ficha viva, que es la fuente de verdad y se
 * consulta cuando la vendedora abre la conversación. Ver `clientes/padron.ts`
 * §PII.
 *
 * ── Es DERIVADA y descartable ──
 * No es fuente de verdad de nada: se puede truncar y volver a sincronizar. El
 * `nivel` viene ya decidido por `clientes/nivel.ts` (la jerarquía vive una sola
 * vez, en TS puro); el SQL de la cola no recalcula, lee.
 */
export const clientesPadron = pgTable(
  "clientes_padron",
  {
    /** Id con namespace de la fuente (`icarus:1234`): mañana puede haber otra. */
    clienteId: text("cliente_id").primaryKey(),
    /** Los últimos 9 dígitos del E.164 — la MISMA llave de `sufijoTelefonoSql`. */
    sufijo: text("sufijo").notNull(),
    /** `51` · `52` · `502`… La guarda contra el cruce entre países. NULL = no se supo. */
    codigoPais: text("codigo_pais"),
    /** Cuántas compras registra el padrón. Es lo que dice «×3» en la fila. */
    compras: integer("compras").notNull().default(0),
    /** `vip` | `recompro` | `compro`, congelado al sincronizar (`clientes/nivel.ts`). */
    nivel: text("nivel").notNull(),
    sincronizadoAt: timestamp("sincronizado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clientes_padron_sufijo_idx").on(t.sufijo)],
);
