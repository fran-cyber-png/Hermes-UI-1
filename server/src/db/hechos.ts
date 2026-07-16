import { bigserial, index, integer, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { ontologia } from "./ontologia.js";

/**
 * CAPA 1 — LOS HECHOS. Lo que pasó, sin opinión.
 *
 * `docs/specs/2026-07-12-ontologia-goberna-design.md:172-177` lo define y lo hace no negociable:
 *
 *   Capa 1 — Hechos       → lo que pasó: timestamps, textos, conteos. Inmutable, SIN OPINIÓN.
 *   Capa 2 — Inferencias  → lo que un modelo cree. Tabla aparte, con versión de modelo.
 *
 *   "Esta separación no es negociable. Si se mezclan, en seis meses nadie puede distinguir qué
 *    pasó de lo que un modelo creyó que pasaba."
 *
 * Esta tabla es la capa 1. La capa 2 (`inferencias`) todavía no existe: sin hechos sobre los
 * cuales inferir, sería una tabla vacía con nombre importante.
 *
 * ── Qué NO es esta tabla ──
 * No es un event store del que se derive el estado. El estado vive en `ontologia.venta`, `pago`,
 * `cuota` — tablas normales, como en cualquier sistema sano. El propio diseño lo advierte
 * (`:179-182`): reproducir eventos para saber el saldo de alguien es una arquitectura que nadie
 * pidió. Esto es el EJE DEL TIEMPO que no teníamos: qué pasó, cuándo, en qué orden.
 *
 * ── Por qué se puede reconstruir entera ──
 * Se deriva de `fuentes.registro`, que es inmutable. Si mañana descubrimos que un hecho se estaba
 * derivando mal, se borra la tabla y se re-proyecta. Mismo patrón que `cerberus:proyectar`
 * (`ontologia/proyectar.ts:77`), que ya se usa en producción.
 */

/**
 * LOS TIPOS DE HECHO — y por qué son solo tres.
 *
 * ── LA REGLA: un hecho necesita un momento REAL, no uno plausible ──
 * Solo existe un tipo de hecho cuando Cerberus registra de verdad CUÁNDO pasó. Donde no hay
 * timestamp confiable, no hay hecho — aunque la cosa haya pasado.
 *
 * Los que se cayeron por esta regla, y hay que decirlo en voz alta:
 *
 *   · `VentaAnulada` / `VentaReembolsada` — hay 129 ventas terminales (estados 4, 5, 7 y 8) y
 *     NADIE SABE CUÁNDO se volvieron terminales. Cerberus no guarda la transición de estado, solo
 *     el estado final. El único candidato era `fecha_edicion`, y se midió: 4.849 de las 6.448
 *     ventas SANAS (estado 1) también tienen `fecha_edicion` posterior a la venta. O sea que
 *     `fecha_edicion` significa "alguien tocó esto", no "se anuló acá" — le pasa al 75% de las
 *     ventas normales. Usarla como `ocurridoAt` sería fabricar un hecho con forma de dato real.
 *
 * Que el estado terminal exista sigue siendo cierto y sigue estando en `ontologia.venta.
 * estadoSemantico`. Lo que no existe es su momento. Un hecho sin cuándo no es un hecho: es una
 * fila con una fecha inventada esperando a que alguien la cite.
 *
 * Esto es un gap de Cerberus, no del modelo: **el ERP no tiene bitácora de cambios de estado.**
 */
export const TIPOS_HECHO = [
  /** Nació una venta. `ocurridoAt` = `fecha_venta`. 6.727 en el espejo. */
  "VentaCreada",
  /**
   * Un asesor registró un pago. `ocurridoAt` = `fecha_pago`.
   *
   * OJO: esa fecha la TIPEA el asesor a mano y su mediana de atraso es 0 días — es autoreportada,
   * no verificada (`lazo/evento.ts:74-75`). El hecho es "alguien dijo que se pagó", no "entró la
   * plata". Por eso son dos hechos distintos y no uno.
   */
  "PagoRegistrado",
  /**
   * Tesorería confirmó el voucher. `ocurridoAt` = `fecha_confirmacion`. **Este es el que le
   * importa a Meta**: es el gatillo del lazo (`lazo/evento.ts:45`).
   *
   * Solo 2.016 de 7.255 pagos lo tienen (27,8%). Los otros 5.239 nunca pasaron por confirmación
   * — no es que falten datos, es que ese paso no ocurrió. La diferencia importa: es exactamente
   * lo que `analisis/comercial.ts:114-119` advierte al reportar el p90 de latencia.
   */
  "PagoConfirmado",
] as const;

export type TipoHecho = (typeof TIPOS_HECHO)[number];

/** Sobre qué entidad del negocio habla el hecho. */
export const SUJETOS_HECHO = ["venta", "pago", "cliente"] as const;
export type SujetoHecho = (typeof SUJETOS_HECHO)[number];

export const hechos = ontologia.table(
  "hechos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /** Uno de `TIPOS_HECHO`. Texto en la base, union tipada en TS: la base no valida enums de TS. */
    tipo: text("tipo").notNull(),

    /**
     * La versión del hecho, no de la fila.
     *
     * Si mañana `PagoConfirmado` pasa a llevar un campo nuevo en el payload, sube a 2 y los
     * consumidores viejos siguen leyendo los v1 sin romperse. Es lo que pide la Constitución
     * ("todo evento debe ser tipado, versionado, auditable") y lo que no tenía la tabla `events`,
     * cuyo `source` es texto libre y su payload jsonb sin esquema.
     */
    version: integer("version").notNull().default(1),

    sujetoTipo: text("sujeto_tipo").notNull(),
    /** La clave del sujeto en Cerberus: el folio de la venta, el código del pago. */
    sujetoId: text("sujeto_id").notNull(),

    /** Cuándo pasó DE VERDAD, según la fuente. Nunca `now()`. Nunca aproximado. */
    ocurridoAt: timestamp("ocurrido_at", { withTimezone: true }).notNull(),
    /**
     * Cuándo lo derivamos nosotros. La diferencia contra `ocurridoAt` es cuánto tardamos en
     * enterarnos — el mismo par que `events.occurredAt`/`ingestedAt` (`db/schema.ts:39-40`).
     */
    derivadoAt: timestamp("derivado_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * La clave que hace idempotente la re-proyección: `venta:GOB-11851`, `pago:5159`.
     *
     * Sin esto, correr `cerberus:hechos` dos veces duplicaría los 16.000 hechos en silencio. Es
     * el mismo mecanismo que ya protege a `events` (`UNIQUE(source, external_id)`) y a
     * `fuentes.registro` (`UNIQUE(fuente, tabla, clave)`).
     */
    claveNatural: text("clave_natural").notNull(),

    /** Los datos del hecho. Nunca una interpretación de los datos. */
    payload: jsonb("payload").notNull(),
  },
  (t) => [
    uniqueIndex("hechos_clave_idx").on(t.tipo, t.claveNatural),
    // La línea de tiempo de una venta: el índice de la pregunta "¿qué pasó con GOB-11851?".
    index("hechos_sujeto_idx").on(t.sujetoTipo, t.sujetoId, t.ocurridoAt),
    // La línea de tiempo del negocio: "¿qué pasó en marzo?".
    index("hechos_tiempo_idx").on(t.ocurridoAt),
    index("hechos_tipo_idx").on(t.tipo, t.ocurridoAt),
  ],
);
