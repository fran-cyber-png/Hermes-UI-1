-- Schema de rag.documentos para entornos SIN Node/drizzle (p.ej. el deploy en geografo).
-- En meta-escuela lo crea drizzle-kit push (server/src/db/rag.ts); esto es el equivalente en SQL.
-- Uso:  docker exec -i <pg> psql -U <user> -d <db> < rag/setup.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS rag;

CREATE TABLE IF NOT EXISTS rag.documentos (
  id         bigserial PRIMARY KEY,
  fuente     text        NOT NULL,
  doc        text        NOT NULL,
  posicion   integer     NOT NULL,
  chunk      text        NOT NULL,
  embedding  vector(1024) NOT NULL,
  embedder   text        NOT NULL,
  sensible   boolean     NOT NULL DEFAULT false,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  creado_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS documentos_doc_pos_idx ON rag.documentos (doc, posicion, embedder);
CREATE INDEX IF NOT EXISTS documentos_embedding_hnsw
  ON rag.documentos USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS documentos_embedder_idx ON rag.documentos (embedder);
CREATE INDEX IF NOT EXISTS documentos_doc_idx ON rag.documentos (doc);
-- Hybrid search (full-text español) — opcional (RAG_HIBRIDO=1)
CREATE INDEX IF NOT EXISTS documentos_fts_es ON rag.documentos USING gin (to_tsvector('spanish', chunk));
