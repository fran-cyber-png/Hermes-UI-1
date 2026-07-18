# Prompt de arranque — construir el sistema RAG de Ivi (a medida de Goberna)

> Pegá el bloque de abajo al empezar una sesión nueva. Construye el sistema que
> hace a Ivi razonar sobre **toda la plataforma Goberna**, anclado y seguro.
> Todo lo de acá está fundado en research verificado (2026-07-18) y en el mapa real
> de tus plataformas. No re-investigar lo ya decidido; construir capa por capa.

---

Sos el **arquitecto del sistema RAG de Ivi**. Objetivo: que Ivi conteste anclado sobre
TODO el embudo de Goberna (landing → Icarus lead → Cerberus venta → LMS entrega → LTV),
combinando **cifras exactas** (por SQL) con **contexto documental** (por embeddings), sin
inventar y sin filtrar dato sensible. Antes de tocar código, **orientate**:

1. `docs/plataformas/` — el mapa de plataformas y datos (Cerberus, goberna-escuela LMS,
   Icarus CRM, meta-escuela/Ivi, sync Meta, ia-box). Es tu base de conocimiento.
2. `docs/27` (criterios/data/gaps) y `docs/28` (decisión API: BI local, creativo Bedrock).
3. `mem_search "Ivi RAG"` y `mem_search "Ivi estado"` para el historial.
4. El motor actual: `goberna-kos/ivi/` (Python) + el backend `server/` (Express/Drizzle/PG).

## La regla de oro (no negociable, es Ley I estructural)

**Los NÚMEROS salen SIEMPRE de SQL.** El motor hace la aritmética (SUM/GROUP BY/filtros),
determinista. El **RAG de embeddings es SOLO para texto no estructurado**. Nunca sumar,
promediar ni filtrar por similitud de vectores: sobre datos tabulares eso es un antipatrón
(recupera top-k por parecido, no el conjunto completo; los agregados salen mal).

## La arquitectura (híbrida, 4 capas)

```
ask(pregunta, usuario)
  └─▶ 1. ROUTER  (barato: qwen3 local o Haiku 4.5) → estructurada | semántica | mixta
        ├─ 2. RUTA ESTRUCTURADA  → consultar_bi(herramienta, params)  [dato SENSIBLE → LOCAL]
        │     slot-filling sobre herramientas PARAMETRIZADAS (no text-to-SQL libre);
        │     Postgres calcula. Ventas/gasto/matrículas/leads NUNCA salen a la nube.
        ├─ 3. RUTA SEMÁNTICA     → buscar_docs(query, k)  [pgvector, docs/copy/playbooks]
        │     embeddings multilingües sobre chunks; ancla en documentos reales.
        └─ 4. ORQUESTADOR AGÉNTICO (tool-use) para preguntas MIXTAS:
              el modelo llama consultar_bi + buscar_docs, combina y CITA la fuente.
```

## Decisiones tomadas (fundadas — no re-litigar)

- **Vector store = pgvector** en el Postgres que ya operan → **cero infra nueva**. NO
  Bedrock Knowledge Bases (OpenSearch Serverless es caro) ni servicio aparte.
- **Embedder = Cohere `embed-multilingual-v3.0` (1024 dims)** vía Bedrock para docs
  PÚBLICOS (el crédito AWS aplica); un **embedder multilingüe LOCAL** (p.ej. BGE-m3) en
  la A4000 para docs SENSIBLES. **Evitar Amazon Titan Text Embeddings V2** (optimizado a
  inglés; todo tu contenido es español). 1024 dims entran cómodos en un índice HNSW.
- **Índice = HNSW**, métrica **coseno**; considerar **hybrid search** (BM25 + vector).
- **BI local** (qwen3:8b/14b, geógrafo) para todo lo estructurado y sensible; **creativo +
  orquestación por Bedrock** (Sonnet 5 / Haiku 4.5) cuando NO hay dato sensible (docs/28).
- **Fine-tuning: el ÚLTIMO recurso.** Orden = **few-shot → RAG → fine-tune solo si hace
  falta**. El creativo (Claude) **no se fine-tunea** (Claude no es fine-tuneable en Bedrock;
  hostear un custom cuesta ~USD 2.470/mes y mata el crédito) → voz por system-prompt +
  few-shot + RAG de ejemplos. El BI (qwen3) se fine-tunea con **QLoRA en la A4000 (~6 GB,
  NO LoRA-16bit que pide ~22 GB)** SOLO cuando haya un corpus de `Pregunta→SQL` reales
  corregidos (cientos a miles) y el few-shot se haya estancado.

## Los 7 entregables (tu spec)

1. **Embeddings bien generados y optimizados**: pipeline de ingestión (fuente → limpieza →
   **chunking** semántico con tamaño+overlap sensatos → embed en batch con Cohere/local →
   upsert en pgvector con metadata: fuente, doc, fecha, sensibilidad). Normalizar para coseno.
2. **Los vectores**: tabla `documentos(id, fuente, chunk, embedding vector(1024),
   metadata jsonb, sensible bool, creado_at)`; índice **HNSW** (`m`, `ef_construction`
   tuneables); métrica coseno.
3. **pgvector — sí, justificado**: reusa el Postgres, HNSW escala a tu volumen, y permite
   **hybrid** (full-text `tsvector` + vector) en la misma DB. Documentá el porqué vs las
   alternativas descartadas.
4. **Prueba de búsqueda vectorial**: armá un **golden set** (~15-30 queries reales con los
   chunks/docs esperados), medí **recall@k y precisión**, e iterá chunking/embedder/k. Es
   la evidencia de que la búsqueda semántica anda antes de cablearla a Ivi.
5. **Fine-tuning**: implementá el orden (few-shot primero). Dejá el pipeline QLoRA-local
   documentado y listo, pero **no entrenes hasta tener el corpus** y que el few-shot toque techo.
6. **Text-to-SQL en vivo** (la ruta estructurada): **NO** generación de SQL libre — extendé
   el catálogo de **herramientas parametrizadas** que Ivi ya tiene (sus endpoints), agregando
   las de LMS (matrículas/completación) e Icarus (leads/campañas). El modelo hace slot-filling;
   Postgres ejecuta. **Guardarraíles**: solo lectura, `LIMIT`, timeout, allowlist de vistas.
7. **Función `ask` + seguridad**: `ask(pregunta, usuario)` = el punto de entrada único que
   enruta (capa 1) y orquesta (capa 4). **Seguridad**: (a) clasificación de datos —
   sensible (ventas/leads/P&L) se resuelve LOCAL, nunca va a Bedrock; público (docs/copy) por
   API ok; (b) RLS/allowlist en las herramientas SQL (solo lectura, tablas/vistas permitidas);
   (c) secretos por env (nunca en repo); (d) Ley I: toda respuesta cita fuente + tipo
   (HECHO/ESTIMACIÓN/SIN_EVIDENCIA); (e) por-usuario si aplica (quién puede ver qué).

## El stack y las fuentes

- **Postgres** (ya operan; sumar `CREATE EXTENSION vector`). **qwen3 local** (geógrafo,
  llama-swap — ver `Goberna-Lab/goberna-ia-box`). **Bedrock** (Cohere embeddings + Sonnet/Haiku).
- Fuentes de datos (docs/plataformas/): **Cerberus** ventas, **goberna-escuela** LMS,
  **Icarus** CRM/leads, **meta-escuela** pauta, **`tb_meta_ads`** gasto (reconciliar, ya existe).
- Fuentes de docs (para embeddings): estos `docs/`, copy de campañas, playbooks, contenido de cursos.

## Reglas duras

- **Ley I** (números por SQL, cita de fuente, honestidad). **Dato sensible nunca sale** de local.
- **Secretos por env**, jamás en el repo. **Commits chicos** a rama+PR (main = prod).
  **Verificación antes de "listo"** (probar la búsqueda con el golden set, no asumir). Español.
- **Iterá capa por capa**: pgvector+ingestión → buscar_docs+golden set → router → ask → orquestador.
  No construir todo de una.

## Primer paso concreto

1. `CREATE EXTENSION vector;` + la tabla `documentos` + índice HNSW.
2. Ingestá un corpus chico (los `docs/` + 5-10 copies de ejemplo) → chunk → embed (Cohere v3) → upsert.
3. `buscar_docs(query, k)` + el **golden set** de ~15 queries → medí recall@k.
4. `ask()` mínima: router que decide entre `consultar_bi` (herramientas actuales de Ivi) y
   `buscar_docs`, y responde citando fuente. Ampliar desde ahí.

## Apéndice — cifras verificadas (research 2026-07-18, 19/20 confirmadas)

Cohere embed-multilingual-v3.0 = 1024 dims, incluye español; Titan V2 optimizado a inglés
(evitar). pgvector: HNSW indexa hasta 2000 dims con `vector` (más con `halfvec`) — 1024 OK.
text-embedding-3-large (3072 dims) NO indexable con HNSW sin reducir. BIRD text-to-SQL SOTA
81,95% EX (humano 92,96%) → un 8B rinde mucho menos en SQL libre: por eso slot-filling sobre
herramientas curadas, no SQL libre. USD 100 de Bedrock ≈ 33M tokens input en Sonnet 5.
Fine-tune custom hosting (no-Nova) ≈ USD 2.470/mes (evitar); QLoRA qwen3:8b ≈ 6 GB en la A4000.
