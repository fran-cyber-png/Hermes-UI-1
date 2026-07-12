import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
