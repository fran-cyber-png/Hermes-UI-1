import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * CAPA RAG — el conocimiento NO estructurado de Ivi.
 *
 * `docs/prompts/rag-ivi-construir.md` fija la Regla de Oro (Ley I estructural):
 *
 *   Los NÚMEROS salen SIEMPRE de SQL (el motor determinista hace la aritmética).
 *   El RAG de embeddings es SOLO para TEXTO no estructurado — docs, copy, playbooks.
 *   Nunca sumar/promediar/filtrar por similitud de vectores: sobre datos tabulares
 *   eso es un antipatrón (recupera top-k por parecido, no el conjunto completo).
 *
 * Por eso esta tabla vive en su propio esquema `rag`, separada de `ontologia` (el negocio) y
 * `fuentes` (el espejo crudo): es una capa aparte, con otra vida. Guarda FRAGMENTOS de texto y
 * su vector, para la ruta SEMÁNTICA de `ask()`. No guarda ni deriva ninguna cifra de negocio.
 *
 * ── Idempotencia ──
 * La re-ingesta de un documento borra sus chunks (`DELETE WHERE doc = :doc AND embedder = :e`) y
 * re-inserta. El `uniqueIndex (doc, posicion, embedder)` evita duplicados dentro de una corrida.
 * Mismo espíritu que `hechos.claveNatural` y `fuentes.registro UNIQUE(fuente, tabla, clave)`.
 */

export const rag = pgSchema("rag");

export const documentos = rag.table(
  "documentos",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    /**
     * La CATEGORÍA de la fuente: `docs/plataformas`, `docs/loops`, `cq-catalog`, `docs/specs`…
     * Sirve para filtrar el corpus y para explicar de dónde salió una cita.
     */
    fuente: text("fuente").notNull(),

    /**
     * El documento concreto: la ruta relativa (`docs/plataformas/cerberus.md`) o el id de la CQ.
     * Es la unidad de re-ingesta idempotente (se borra por `doc` antes de re-insertar) y la cita
     * que Ivi devuelve al usuario ("según docs/plataformas/cerberus.md").
     */
    doc: text("doc").notNull(),

    /** El orden del chunk dentro del `doc`: 0,1,2… Da orden estable y precisión en la cita. */
    posicion: integer("posicion").notNull(),

    /** El fragmento de texto, tal cual se embebió. Lo que se le muestra al modelo como contexto. */
    chunk: text("chunk").notNull(),

    /**
     * EL VECTOR. 1024 dims = bge-m3 (local) y también Cohere embed-multilingual-v3.0 (Bedrock),
     * así que un futuro swap de embedder público es compatible de columna.
     *
     * OJO (trampa de los dos espacios vectoriales): dos embedders de la MISMA dimensión producen
     * vectores en espacios DISTINTOS. Comparar por coseno un vector de bge-m3 contra uno de Cohere
     * no significa nada. Por eso `embedder` es columna de primera clase y `buscar_docs` SIEMPRE
     * filtra por un único `embedder` — nunca se mezclan en la misma búsqueda.
     */
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),

    /** Quién produjo el vector: `ollama:bge-m3`, y mañana `bedrock:cohere-embed-multilingual-v3`. */
    embedder: text("embedder").notNull(),

    /**
     * Dato sensible (cifras reales de ROAS/CAC/ventas/leads/P&L → p.ej. `docs/loops/`). Marca la
     * clasificación por CHUNK, no solo por archivo: un doc público puede tener un párrafo con
     * cifras. Gobierna qué embedder/gateway puede tocarlo (sensible = LOCAL, nunca a la nube).
     */
    sensible: boolean("sensible").notNull().default(false),

    /** fuente, doc, fecha, títulos/encabezados de sección, tokens estimados… para cita y debug. */
    metadata: jsonb("metadata").notNull().default({}),

    creadoAt: timestamp("creado_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotencia dentro de un embedder: no dos chunks iguales del mismo doc en la misma corrida.
    uniqueIndex("documentos_doc_pos_idx").on(t.doc, t.posicion, t.embedder),

    // La búsqueda semántica: HNSW + coseno. `m`/`ef_construction` tuneables (defaults de pgvector).
    index("documentos_embedding_hnsw")
      .using("hnsw", t.embedding.op("vector_cosine_ops"))
      .with({ m: 16, ef_construction: 64 }),

    // `buscar_docs` filtra por embedder (y a veces por sensibilidad) antes/junto al KNN.
    index("documentos_embedder_idx").on(t.embedder),
    // Borrado por documento en la re-ingesta.
    index("documentos_doc_idx").on(t.doc),
  ],
);
