"""RAG de Ivi — la ruta SEMÁNTICA (texto no estructurado) del cerebro consolidado.

La arquitectura completa vive en `docs/29-INTEGRACION-IVI-PLATAFORMA.md` y el spec en
`docs/prompts/rag-ivi-construir.md`. Regla de Oro (Ley I estructural): los NÚMEROS salen
siempre de SQL (el motor determinista); esto es SOLO para texto — docs, copy, playbooks.

Piezas (capa por capa, primer corte):
  config    → conexión, embedder, chunking (todo env-overridable)
  embedder  → embed(textos) -> vectores 1024-dim (hoy Ollama bge-m3 local; pluggable)
  chunker   → parte markdown/JSON en fragmentos con solape, respetando encabezados
  store     → upsert + búsqueda KNN sobre rag.documentos (pgvector HNSW coseno)
  ingest    → walk docs/ + catalog.json -> chunk -> embed -> upsert (idempotente por doc)
  buscar    → buscar_docs(query, k) — la herramienta semántica
  evaluar   → golden set + recall@k (la evidencia antes de cablear a Ivi)
  ask       → router mínimo (estructurada | semántica | mixta)
"""
