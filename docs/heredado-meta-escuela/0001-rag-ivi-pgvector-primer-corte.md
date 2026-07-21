# ADR 0001 — RAG de Ivi: pgvector + embedder local (primer corte)

- **Fecha:** 2026-07-18
- **Estado:** Aceptado
- **Contexto del programa:** [`docs/29-INTEGRACION-IVI-PLATAFORMA.md`](../29-INTEGRACION-IVI-PLATAFORMA.md) · spec [`docs/prompts/rag-ivi-construir.md`](../prompts/rag-ivi-construir.md)

## Contexto

Ivi necesita la **ruta semántica** (razonar sobre texto no estructurado: docs, copy, playbooks,
CQs) además de la estructurada (números por SQL). No existía ninguna capa de recuperación: ni
vector store, ni embeddings, ni `buscar_docs`. Había que elegir vector store, embedder y dónde
corre todo, sin romper la Ley I (los números NO salen de embeddings) ni tocar producción.

## Decisiones

1. **Vector store = pgvector en el Postgres local de meta-escuela.** Se cambió la imagen del
   contenedor de `postgres:17-alpine` a `pgvector/pgvector:pg17` (mismo major → volumen
   `meta_escuela_pgdata` compatible, sin pérdida de datos) + `CREATE EXTENSION vector`. Es el patrón
   que ya corre el ecosistema (`goberna_crm_db`, `leads_crm_db`). **Descartado:** Bedrock Knowledge
   Bases (OpenSearch Serverless caro), servicio de vectores aparte (infra nueva innecesaria).

2. **Tabla `rag.documentos` en esquema propio**, definida en Drizzle (`server/src/db/rag.ts`,
   `schemaFilter += "rag"`), con `embedding vector(1024)` + índice **HNSW coseno**. Esquema separado
   de `ontologia`/`fuentes` porque es otra capa (texto, no negocio) y no deriva ninguna cifra.

3. **Embedder = bge-m3 LOCAL vía Ollama** (1024-dim, multilingüe) para el primer corte.
   **Por qué, y no Cohere/Bedrock como dice el spec para docs públicos:** Bedrock **no está
   cableado** (cero SDK/creds en el repo) y cablearlo bloquea el corte. bge-m3 local desbloquea ya,
   mantiene todo local/Ley-I-safe, y **esquiva la trampa de los dos espacios vectoriales** (un solo
   embedder en el corte). 1024-dim coincide con el spec → swap futuro a Cohere es compatible de
   columna. **Descartado para el corte:** torch/sentence-transformers (Python 3.14 sin wheels
   confiables); Titan V2 (optimizado a inglés).

4. **`consultar_bi` = el catálogo SDK existente** (`/api/sdk`, `governa.*`), no text-to-SQL libre.
   El router reusa el scorer de intents de Ivi (`ivi.intent_analyzer`) como señal estructurada.
   Allowlist por construcción: solo se invocan herramientas presentes en el catálogo.

## Qué reemplaza / qué agrega

- **Agrega:** el paquete `goberna-kos/rag/` (embedder, chunker, store, ingest, buscar, evaluar,
  ask), la tabla `rag.documentos`, y `docs/29`. Cierra la referencia colgante a `docs/29`.
- **Reemplaza:** nada existente — es capa nueva. La imagen del Postgres local cambió (documentado en
  `CLAUDE.md`, regla dura #5). El motor Ivi (`goberna-kos/ivi/`) queda intacto; `ask()` lo envuelve.

## Consecuencias

- **Positivas:** cerebro híbrido funcionando (recall@3 94 %), sin costo cloud, sin tocar prod, sin
  dependencias pesadas (stdlib + psycopg2). La tubería es embedder-agnóstica.
- **Costos / deuda aceptada:** (a) un solo embedder local → los docs públicos aún no usan Cohere;
  (b) búsqueda pura-vector → un caso débil conocido (hybrid search pendiente); (c) sensibilidad a
  nivel-archivo, no chunk; (d) prosa por LLM opcional (no hay chat model local). Todo en el roadmap
  de `docs/29 §5`.
- **Reversible:** volver la imagen a `postgres:17-alpine` y `DROP SCHEMA rag CASCADE` deja el sistema
  como estaba (la data de `rag` es descartable — se re-ingesta).
