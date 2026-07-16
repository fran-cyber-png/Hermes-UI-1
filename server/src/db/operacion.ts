import {
  bigserial,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * La infraestructura de operación: lo que hace que las pantallas no le hablen a Meta.
 *
 * LA REGLA: ninguna pantalla llama a Meta. Nunca.
 *
 * Hoy `GET /api/decisions` hace **866 llamadas secuenciales** a la Graph API (24 cuentas × 2,
 * más 409 campañas × 2) y tarda entre 2 y 4 minutos. Y se dispara al MONTAR dos pantallas
 * distintas, sin caché entre ellas: abrís la home, vas a campañas, y pagás la cuenta dos veces.
 * Además es candidato seguro a rate limit — Meta te puede cortar el acceso.
 *
 * Con estas tablas, Meta se consulta POR DETRÁS, en un job, que deja el resultado acá.
 * La pantalla lee Postgres: de 4 minutos a 20 milisegundos.
 */

/**
 * El resultado de revisar la pauta, ya calculado.
 *
 * Guardamos el `CampaignInput[]` — exactamente la forma que los detectores necesitan.
 * Los detectores (`decisions/detectors.ts`) ya son funciones puras: no hay que tocarlos,
 * solo cambiar de dónde vienen los datos.
 *
 * Deliberadamente NO modelamos la jerarquía completa de Meta (cuenta→campaña→conjunto→anuncio)
 * en tablas normalizadas. Todavía no hay ninguna pregunta que lo pida. El día que la haya, se
 * proyecta desde acá.
 */
export const pautaSnapshots = pgTable(
  "pauta_snapshots",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** Qué cuentas se revisaron. Si cambian, el snapshot viejo ya no aplica. */
    cuentas: jsonb("cuentas").notNull(),
    /** El rango con el que se pidieron los insights ('7d' | '30d' | '90d' | '1y' | 'todo'). */
    rango: text("rango").notNull(),

    /** Los `CampaignInput[]` crudos. Los detectores corren sobre esto, al leer. */
    campanas: jsonb("campanas").notNull(),

    /**
     * El costo por lead, ya calculado. Va acá y no en su propio endpoint porque también
     * necesita insights de Meta — y la regla es que NINGUNA pantalla llame a Meta.
     */
    costo: jsonb("costo"),

    /**
     * El gasto por país de la AUDIENCIA, en USD (`GastoPais[]`). Es la mitad que le faltaba al
     * ROAS por país: viene del breakdown de Meta, así que también vive en el snapshot, no al render.
     */
    gasto: jsonb("gasto"),

    /**
     * Las cuentas que fallaron, con su error. Antes los `fetch failed` de Bolivia y Ecuador se
     * perdían en un log y la pantalla mostraba números incompletos como si fueran completos.
     */
    errores: jsonb("errores").notNull().default([]),

    duracionMs: integer("duracion_ms"),
    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pauta_snapshots_reciente_idx").on(t.rango, t.creadoAt)],
);

/**
 * Configuración compartida del equipo. Deja de vivir en el localStorage de un navegador.
 *
 * La selección de cuentas publicitarias tiene que estar acá por dos razones: para que dos
 * personas vean lo mismo, y para que el job de fondo sepa qué cuentas revisar — un job no
 * tiene localStorage.
 */
export const configuracion = pgTable("configuracion", {
  /** ej: 'cuentas_pauta' */
  clave: text("clave").primaryKey(),
  valor: jsonb("valor").notNull(),
  actualizadoAt: timestamp("actualizado_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Cada webhook que recibimos, crudo, ANTES de procesarlo.
 *
 * Es el mismo principio que el espejo de fuentes: guardar lo que llegó, tal cual, antes de
 * entenderlo. Si el procesamiento falla —o si mañana Cerberus cambia el payload— el webhook
 * original queda a salvo y se puede re-procesar. Un webhook que se pierde por un error de
 * parseo es una venta que Meta nunca ve, y no hay forma de recuperarla: Cerberus no reintenta
 * para siempre.
 *
 * También es la defensa contra el doble-envío: si Cerberus manda el mismo evento dos veces
 * (reintento por timeout), el `evento_id` único lo deduplica.
 */
export const webhooksRecibidos = pgTable(
  "webhooks_recibidos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** 'cerberus' | 'woocommerce' | … */
    fuente: text("fuente").notNull(),
    /** 'sale.updated' | 'payment.confirmed' | … lo que el emisor declare. */
    tipo: text("tipo"),
    /** El id que el emisor considera único de ESTE evento. Deduplica reintentos. */
    eventoId: text("evento_id").notNull(),

    /** El cuerpo entero, crudo, sin interpretar. La red de seguridad. */
    payload: jsonb("payload").notNull(),

    /** 'recibido' | 'procesado' | 'error'. Un webhook procesado no se vuelve a tocar. */
    estado: text("estado").notNull().default("recibido"),
    error: text("error"),

    recibidoAt: timestamp("recibido_at", { withTimezone: true }).notNull().defaultNow(),
    procesadoAt: timestamp("procesado_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("webhooks_fuente_evento_uq").on(t.fuente, t.eventoId),
    index("webhooks_pendientes_idx").on(t.estado),
  ],
);

/**
 * El estado de cada fuente de sincronización: hasta dónde leímos, cuándo, y qué falló.
 *
 * Sin esto, la pantalla no puede decir "revisado hace 2 h" — y una card que dice "en vivo"
 * cuando en realidad muestra datos de ayer es peor que una que dice su edad.
 */
export const sincronizaciones = pgTable("sincronizaciones", {
  /** ej: 'pauta', 'ingesta:comentarios:PAGEID', 'cerberus' */
  fuente: text("fuente").primaryKey(),
  /** Hasta dónde leímos (ej: el último `occurred_at` ingerido). */
  cursor: text("cursor"),
  ultimaOk: timestamp("ultima_ok", { withTimezone: true }),
  ultimoError: text("ultimo_error"),
  ultimoErrorAt: timestamp("ultimo_error_at", { withTimezone: true }),
  duracionMs: integer("duracion_ms"),
});

/**
 * LA SERIE DIARIA DE META — el eje del tiempo que la pauta nunca tuvo.
 *
 * ── El agujero que tapa ──
 * `pauta_snapshots` guarda una FOTO AGREGADA del período cada 6 h. Sirve para "¿cómo está la
 * pauta ahora?" y no sirve para nada más: al 2026-07-16 había 10 snapshots, o sea **3,1 días**
 * de historia. Cualquier pregunta con un eje de tiempo —"¿venimos mejor que el año pasado?",
 * "¿este creativo se está quemando?"— era incontestable.
 *
 * Y no porque el dato no existiera: porque nadie lo pidió. `recolectar.ts:71` pide insights SIN
 * `time_increment`, así que Meta devuelve una fila agregada de los 90 días. La serie estaba ahí
 * todo el tiempo, del otro lado de un parámetro.
 *
 * ── Lo que se midió antes de escribir esto (2026-07-16, contra la API real) ──
 * Meta retiene **37 meses** de insights diarios. Más atrás responde:
 *     ERROR(3018) "The start date of the time range cannot be beyond 37 months"
 *
 * Y no se le pueden pedir de una: a nivel `ad`, 37 meses da HTTP 400; a nivel `campaign`, HTTP
 * 500. **No es rate limit** (Meta reportaba `call_count=1%`) ni permisos: es el tamaño de la
 * consulta. Medido sobre la misma cuenta y nivel:
 *
 *     14 días → ✓ 125 filas · 1,0 s        6 meses  → ✓ 1.039 filas · 13,9 s
 *      1 mes  → ✓  96 filas · 0,6 s       37 meses  → ✗ HTTP 400
 *      3 meses→ ✓ 447 filas · 2,6 s
 *
 * Por eso `pauta/backfill.ts` trocea en ventanas de 3 meses. Un HTTP 500 de la Graph API casi
 * nunca es "Meta está caído": es "la consulta es muy grande".
 *
 * ── Por qué es append-only y no un snapshot más ──
 * Un día que ya pasó no cambia. Meta puede reprocesar atribución hasta 28 días atrás, así que la
 * fila se puede pisar con `UNIQUE(nivel, entidad_id, fecha)` — pero el pasado lejano es
 * inmutable, y por eso el backfill se puede correr dos veces sin duplicar nada.
 */
export const pautaSerie = pgTable(
  "pauta_serie",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** `account` | `campaign` | `ad`. El mismo dato a tres granularidades: Meta las cobra igual. */
    nivel: text("nivel").notNull(),
    /** El id de Meta de la entidad: `act_123`, el campaign_id, el ad_id. */
    entidadId: text("entidad_id").notNull(),
    /** La cuenta a la que pertenece. Permite borrar/re-backfillear una cuenta sola. */
    cuentaId: text("cuenta_id").notNull(),

    /** El día. `date` y no `timestamp`: Meta reporta por día en el huso de la cuenta, sin hora. */
    fecha: date("fecha").notNull(),

    /**
     * Gasto del día, en la MONEDA DE LA CUENTA. Sin convertir.
     *
     * Convertir acá sería hornear una tasa en un hecho: las tasas del negocio cambian, y una fila
     * de 2023 convertida con la tasa de hoy es una mentira con formato de dato. La conversión es
     * una decisión de análisis y vive donde ya vive (`analisis/tasas.ts:44`), aplicada al leer.
     * Es la misma lección que `db/canonico.ts:4-21` documenta como bug real.
     */
    gasto: numeric("gasto"),
    /** El ISO de la moneda de la cuenta, para que nadie sume soles con dólares. */
    moneda: text("moneda"),

    impresiones: integer("impresiones"),
    clicks: integer("clicks"),
    /** El array `actions` crudo de Meta: leads, compras, reacciones. Sin interpretar. */
    acciones: jsonb("acciones"),

    /** Cuándo lo trajimos. Un backfill viejo se distingue de uno de hoy. */
    traidoAt: timestamp("traido_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // La idempotencia: correr el backfill dos veces pisa, no duplica.
    uniqueIndex("pauta_serie_uq").on(t.nivel, t.entidadId, t.fecha),
    // "¿cómo viene esta campaña?" — el índice de la pregunta más frecuente.
    index("pauta_serie_entidad_idx").on(t.nivel, t.entidadId, t.fecha),
    // "¿cómo venimos este mes?" — el agregado por cuenta.
    index("pauta_serie_cuenta_idx").on(t.cuentaId, t.fecha),
  ],
);
