import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * LA CORRIDA — un Replay entero, con nombre e identidad (#257).
 *
 * ══ POR QUÉ NO VIVE EN `bot_respuestas` ══════════════════════════════════════
 *
 * Porque `bot_respuestas` es **el corpus con el que se mide al bot**: son las
 * respuestas que efectivamente le salieron a una persona. Una Corrida guarda lo
 * que el bot HABRÍA dicho hoy sobre conversaciones que ya pasaron.
 *
 * Mezclarlas corrompe la medición en las dos direcciones: infla el corpus con
 * texto que nadie recibió, y borra la única diferencia que importa — la que hay
 * entre **lo que pasó** y **lo que habría pasado**. Después de una sola Corrida
 * sobre las 255 respuestas reales, el corpus tendría 510 y ninguna forma de
 * distinguirlas. Por eso es tabla propia y no una columna `es_prueba`.
 *
 * ══ QUÉ LA HACE COMPARABLE ═══════════════════════════════════════════════════
 *
 * Una Corrida es la unidad que se compara: «la de ayer contra la de hoy». Para
 * eso tiene que saber CONTRA QUÉ corrió — si no, dos corridas con resultados
 * distintos no dicen si el bot mejoró o si cambió el catálogo debajo.
 */
export const corridas = pgTable(
  "corridas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Cómo la llama quien la lanzó («sin la regla 0b», «con el precio partido»). */
    rotulo: text("rotulo").notNull(),
    /** Quién la lanzó. Una Corrida sin dueño no se puede preguntar «¿por qué la corriste?». */
    lanzadaPor: text("lanzada_por").notNull(),
    /**
     * El estado del mundo contra el que corrió, para que la comparación signifique
     * algo: qué línea, cuántos hechos vigentes había, qué modelo. **No es el
     * catálogo entero**: es lo mínimo para saber si dos corridas son comparables.
     */
    contexto: jsonb("contexto").notNull().default({}),
    /** `corriendo` · `terminada` · `fallida`. */
    estado: text("estado").notNull().default("corriendo"),
    /** Por qué falló, si falló. */
    motivo: text("motivo"),
    /** Cuántas conversaciones se le pidieron y cuántas llegaron a tener veredicto. */
    pedidas: integer("pedidas").notNull().default(0),
    corridas_: integer("corridas").notNull().default(0),
    /** El costo, para poder decidir cuántas más se pueden correr. */
    tokensEntrada: integer("tokens_entrada").notNull().default(0),
    tokensSalida: integer("tokens_salida").notNull().default(0),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
    terminadaEn: timestamp("terminada_en", { withTimezone: true }),
  },
  (t) => [index("corridas_creada_idx").on(t.creadaEn)],
);

/**
 * Lo que el bot contestó en UNA conversación dentro de una Corrida.
 *
 * Guarda las dos mitades del diff a propósito: lo que dijo **entonces** y lo que
 * diría **ahora**. Se podría reconstruir la primera con un join contra
 * `bot_respuestas`, y sería un error: esa fila puede cambiar —o borrarse— y
 * entonces una Corrida vieja empezaría a mostrar una comparación distinta de la
 * que se miró el día que se corrió. Una Corrida tiene que poder releerse igual
 * dentro de seis meses.
 */
export const corridaRespuestas = pgTable(
  "corrida_respuestas",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    corridaId: bigint("corrida_id", { mode: "number" })
      .notNull()
      .references(() => corridas.id, { onDelete: "cascade" }),
    /** La conversación real sobre la que se corrió. */
    clave: text("clave").notNull(),
    numeroPropio: text("numero_propio").notNull(),
    /** Lo que el bot dijo ENTONCES — copiado, no referenciado. */
    textoOriginal: text("texto_original"),
    estadoOriginal: text("estado_original"),
    /** Lo que diría AHORA. */
    texto: text("texto"),
    estado: text("estado").notNull(),
    motivo: text("motivo"),
    acciones: jsonb("acciones").notNull().default([]),
    modelo: text("modelo"),
    tokensEntrada: integer("tokens_entrada"),
    tokensSalida: integer("tokens_salida"),
    creadaEn: timestamp("creada_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("corrida_respuestas_corrida_idx").on(t.corridaId),
    index("corrida_respuestas_clave_idx").on(t.clave),
  ],
);
