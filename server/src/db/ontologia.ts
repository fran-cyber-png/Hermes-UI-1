import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * LA ONTOLOGÍA — dos capas, separadas a propósito.
 *
 *   fuentes    → el espejo crudo. Lo que los otros sistemas dicen, tal cual lo dicen.
 *                Nunca se escribe a mano. Si se borra entero, se rehace. Es descartable.
 *
 *   ontologia  → nuestra opinión. Correos en minúscula, teléfonos en E.164, personas fusionadas.
 *                Se DERIVA de `fuentes`. Cuando la opinión cambia —y va a cambiar— se rehace.
 *
 * Por qué esta separación no es teórica: hoy encontramos que la ingesta de Meta estaba TIRANDO
 * nuestros propios mensajes salientes. Lo pudimos ver porque el payload crudo estaba guardado.
 * Si solo hubiéramos guardado lo "limpio", ese bug sería invisible para siempre.
 */

export const fuentes = pgSchema("fuentes");
export const ontologia = pgSchema("ontologia");

// ─────────────────────────────────────────────────────────────────────────────
// CAPA 0 — El espejo crudo
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una sola tabla para TODAS las fuentes externas. Cualquier fila de cualquier tabla de
 * cualquier sistema, guardada tal cual llegó.
 *
 * Deliberadamente NO se declaran las columnas de Cerberus. Dos razones:
 *   1. Adivinar su esquema es inventar. Cuando llegue el dump, sabremos.
 *   2. Cerberus va a cambiar (le van a agregar un método de pago boliviano) y este espejo
 *      no se tiene que enterar.
 *
 * `clave` es el PK original (folio de venta, id de cliente). Con `UNIQUE(fuente, tabla, clave)`
 * la re-ingesta es idempotente: correr el import dos veces no duplica nada.
 */
export const registro = fuentes.table(
  "registro",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** 'cerberus' | 'dashboard' | 'moodle' | 'certificaciones' | 'crm' | 'bravo' */
    fuente: text("fuente").notNull(),
    /** La tabla en el sistema de origen: 'tb_venta', 'tb_cliente', 'tb_meta_campaign_map'… */
    tabla: text("tabla").notNull(),
    /** El identificador en el sistema de origen. Lo que sea que lo haga único ALLÁ. */
    clave: text("clave").notNull(),

    /** La fila entera, cruda, sin interpretar. */
    payload: jsonb("payload").notNull(),

    /** Cuándo la vimos. NO es cuándo ocurrió — eso está adentro del payload. */
    ingeridoAt: timestamp("ingerido_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("registro_fuente_tabla_clave_uq").on(t.fuente, t.tabla, t.clave),
    index("registro_fuente_tabla_idx").on(t.fuente, t.tabla),
  ],
);

// ─────────────────────────────────────────────────────────────────────────────
// CAPA 1 — Personas e identidad
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delgada a propósito. El id es estable: `/persona/:id` no se rompe nunca.
 *
 * Y para que ESO sea verdad y no una intención, la persona se ancla a una `claveRaiz`: la identidad
 * más chica de su grupo (orden lexicográfico), que NO depende del orden en que se procesen los datos.
 * El grafo se reconstruye con UPSERT sobre esa clave, no borrando y recreando — si se recreara, cada
 * rebuild le daría un id nuevo a la misma persona y todo link guardado se rompería. (Pasó: alguien
 * quedó como /gente/7083 y al rebuild siguiente era /gente/17781.)
 */
export const personas = ontologia.table("personas", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  /**
   * La identidad ancla del grupo: `email:x@y.com` o `telefono:519...`, la más chica del clúster.
   * Determinista: el mismo conjunto de identidades siempre produce la misma clave, así que el id
   * sobrevive a los rebuilds. Cambia solo si el clúster se fusiona con otro de clave menor — y eso
   * es un evento real de fusión, no un accidente del rebuild.
   */
  claveRaiz: text("clave_raiz").unique(),
  /** Derivado, no fuente de verdad: lead.full_name > nombre de Messenger > usuario de IG. */
  nombreDisplay: text("nombre_display"),
  creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cada rastro conocido de una persona. Fuentes nuevas = tipos nuevos, sin remodelar.
 *
 * `fuerza` es la regla que evita el desastre:
 *   FUERTE  → correo/teléfono de un FORMULARIO (el lead lo escribió y lo entregó). Puede fusionar.
 *   DÉBIL   → PSID, usuario de IG, y el teléfono TIPEADO EN UN CHAT. Vincula, pero NUNCA fusiona
 *             dos personas preexistentes.
 *
 * Por qué importa acá y no en un CDP genérico: en Perú el teléfono compartido en familia, la
 * cabina de internet y la secretaria de un colegio escribiendo por varios postulantes son el
 * día a día. Vamos a fusionar mal. La pregunta no es si, es cuándo.
 */
export const identidades = ontologia.table(
  "identidades",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** 'email' | 'telefono' | 'psid' | 'ig_user' | 'wa_id' | 'lead_id' | 'moodle_user_id' */
    tipo: text("tipo").notNull(),
    /** YA NORMALIZADO. Nunca se compara un valor sin normalizar — la normalización es la clave. */
    valor: text("valor").notNull(),
    /** 'fuerte' | 'debil' */
    fuerza: text("fuerza").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("identidades_tipo_valor_uq").on(t.tipo, t.valor)],
);

/**
 * LA ARISTA REVERSIBLE. Esto es lo que Segment no tiene.
 *
 * Segment, en su FAQ oficial: "No. As the Identity Graph uses external IDs, they remain for the
 * lifetime of the user profile." Hightouch: "There is no undo or unmerge button."
 *
 * Ninguno de los CDP líderes puede des-fusionar. Nosotros lo necesitamos: des-fusionar es
 * revocar una arista, no reconstruir la base.
 */
export const vinculosIdentidad = ontologia.table(
  "vinculos_identidad",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    identidadId: bigint("identidad_id", { mode: "number" })
      .notNull()
      .references(() => identidades.id),
    personaId: bigint("persona_id", { mode: "number" })
      .notNull()
      .references(() => personas.id),

    /** Qué regla lo creó: 'lead_form' | 'venta_cerberus' | 'telefono_en_texto' | 'manual' */
    regla: text("regla").notNull(),
    /** El dato exacto que lo justificó. Sin esto, "explicable" es una palabra. */
    evidencia: jsonb("evidencia").notNull(),
    /** 'sistema' | 'operador:{id}' */
    actor: text("actor").notNull(),
    /** 'alta' | 'media' | 'baja' */
    confianza: text("confianza").notNull(),

    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),

    /** Des-fusionar = revocar. No se borra nada; el historial queda. */
    revocadoAt: timestamp("revocado_at", { withTimezone: true }),
    revocadoPor: text("revocado_por"),
    revocadoMotivo: text("revocado_motivo"),
  },
  (t) => [
    // Una identidad apunta a UNA persona a la vez. Las revocadas no cuentan.
    uniqueIndex("vinculos_identidad_activo_uq")
      .on(t.identidadId)
      .where(sql`revocado_at IS NULL`),
    index("vinculos_persona_idx").on(t.personaId),
  ],
);

/**
 * Claves basura que NUNCA fusionan. Un solo `informes@` puede colapsar 300 personas en una
 * y nadie se entera hasta que es tarde.
 *
 * Se crea vacía. Se llena cuando la realidad la llene (es Tipo B: emerge del uso).
 */
export const identidadesBloqueadas = ontologia.table(
  "identidades_bloqueadas",
  {
    tipo: text("tipo").notNull(),
    valor: text("valor").notNull(),
    motivo: text("motivo").notNull(),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("identidades_bloqueadas_pk").on(t.tipo, t.valor)],
);

// ─────────────────────────────────────────────────────────────────────────────
// CAPA 2 — El lazo: la tabla que justifica el proyecto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que le decimos a Meta.
 *
 * Es la razón de ser del sistema: quitarle a Meta la señal de conversión sube el costo mediano
 * por cliente incremental de US$38,16 a US$49,93 — un 31% más caro (RCT, 70.000+ anunciantes,
 * NBER w32765 / Marketing Science 2025). El evento de conversión ES la variable dependiente
 * del modelo de entrega de Meta.
 *
 * `descarte` es la mitad importante de esta tabla: registra las ventas que NO se pudieron
 * mandar y por qué. Hoy ese fracaso es invisible — Meta rechaza y no avisa. Acá es contable.
 */
export const conversiones = ontologia.table(
  "conversiones",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    personaId: bigint("persona_id", { mode: "number" }).references(() => personas.id),
    /** El folio de Cerberus (`GOB-11851`). Único allá, y por eso sirve de ancla acá. */
    origenClave: text("origen_clave").notNull(),
    origenFuente: text("origen_fuente").notNull().default("cerberus"),

    /** 'Purchase' | 'QualifiedLead' | 'LeadSubmitted' */
    tipo: text("tipo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }),
    /** ISO-4217. Cerberus maneja 7 monedas; Meta las acepta todas sin convertir. */
    moneda: text("moneda"),

    /**
     * Cuándo ocurrió la compra. NO cuándo la mandamos.
     * Es la confirmación de Tesorería sobre la PRIMERA cuota — no `Venta.estado == Pagado`,
     * que Cerberus solo pone al pagarse TODAS las cuotas (el 9,9% paga en cuotas).
     */
    ocurridoEn: timestamp("ocurrido_en", { withTimezone: true }).notNull(),

    // ── El envío a Meta ──
    /** También es el `event_id` de deduplicación (ventana de 48 h en Meta). Determinista. */
    eventId: text("event_id").notNull().unique(),
    datasetId: text("dataset_id"),
    enviadoAt: timestamp("enviado_at", { withTimezone: true }),
    metaRespuesta: jsonb("meta_respuesta"),
    intentos: bigint("intentos", { mode: "number" }).notNull().default(0),
    ultimoError: text("ultimo_error"),

    /**
     * Por qué NO se mandó. El fracaso silencioso, hecho ruidoso:
     *   'estado_no_pagado' | 'sin_confirmacion' | 'fuera_de_ventana' | 'sin_identidad'
     *
     * `fuera_de_ventana` es ~1 de cada 6: Meta acepta 7 días y el p90 de confirmación de
     * Tesorería es 10. Ese 17% se recupera confirmando más rápido, no programando mejor.
     */
    descarte: text("descarte"),
    descarteDetalle: jsonb("descarte_detalle"),

    /** Solo eventos de prueba: no afectan la optimización de Meta. */
    esPrueba: boolean("es_prueba").notNull().default(false),

    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversiones_pendientes_idx").on(t.enviadoAt),
    index("conversiones_descarte_idx").on(t.descarte),
    index("conversiones_persona_idx").on(t.personaId),
  ],
);
