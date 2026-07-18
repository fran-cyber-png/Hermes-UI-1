# rag — la ruta semántica de Ivi (RAG sobre pgvector)

El conocimiento NO estructurado del cerebro de Ivi. Plan completo:
[`docs/29-INTEGRACION-IVI-PLATAFORMA.md`](../../docs/29-INTEGRACION-IVI-PLATAFORMA.md) ·
ADR: [`docs/adr/0001`](../../docs/adr/0001-rag-ivi-pgvector-primer-corte.md).

**Regla de Oro (Ley I):** los números salen de SQL. Esto es SOLO para texto (docs, copy, CQs).
Nunca sumar/filtrar por similitud de vectores sobre datos tabulares.

## Piezas

| Archivo | Qué hace |
|---|---|
| `config.py` | Conexión, embedder, chunking, backend — todo env-overridable |
| `embedder.py` | `embed(textos)` → vectores 1024-dim (Ollama bge-m3; pluggable) |
| `chunker.py` | Chunking semántico de markdown (encabezados + solape) |
| `store.py` | Upsert + KNN coseno sobre `rag.documentos` (psycopg2) |
| `ingest.py` | Walk `docs/` + `catalog.json` → chunk → embed → upsert (idempotente por doc) |
| `buscar.py` | `buscar_docs(query, k)` — la herramienta semántica |
| `evaluar.py` | Golden set (`golden.json`) → recall@k + MRR (regresión) |
| `ask.py` | `ask(pregunta, usuario)` — router estructurada/semántica/mixta, citado y tipado |

## Requisitos

- Postgres local con pgvector: `docker compose up -d --wait` (imagen `pgvector/pgvector:pg17`).
- Ollama sirviendo bge-m3: `ollama serve &` + `ollama pull bge-m3`.
- `ask()` además necesita el backend meta-escuela arriba (`:4100`, `cd server && npm run dev`).
- **Modo `split`** (Cohere para públicos): AWS CLI con creds válidas (`aws sts get-caller-identity`)
  y acceso al modelo `cohere.embed-multilingual-v3` en Bedrock (`us-east-1`).
- Deps: `psycopg2` (ya instalado). El resto es stdlib — Bedrock se llama por el AWS CLI, sin boto3.

## Modos de embedder

- **`local`** (default) — TODO con bge-m3 (un espacio, sin nube, offline-safe).
- **`split`** — docs PÚBLICOS con Cohere `embed-multilingual-v3` (Bedrock, aplica el crédito AWS);
  docs SENSIBLES (`docs/loops/`) con bge-m3 LOCAL (Ley I: el texto sensible NUNCA sale a la nube).
  Dos espacios vectoriales: `buscar_docs` consulta cada uno con la query embebida por su backend y
  mergea — nunca compara vectores cruzados.

```bash
RAG_MODO_EMBEDDER=split python3 -m rag.ingest    # público→Cohere, sensible→bge-m3
RAG_MODO_EMBEDDER=split python3 -m rag.evaluar    # recall@k del split
```

## Uso (desde `goberna-kos/`)

```bash
python3 -m rag.ingest                       # ingesta todo el corpus
python3 -m rag.ingest --solo plataformas    # solo docs que matcheen 'plataformas'
python3 -m rag.ingest --stats               # cuántos chunks/docs hay
python3 -m rag.evaluar                       # recall@k del golden set
python3 -m rag.buscar "ROAS por país" -k 5   # búsqueda semántica
python3 -m rag.buscar "..." --publicos       # excluye chunks sensibles
python3 -m rag.ask    "cómo está el lazo CAPI"  # el cerebro (router + SDK + docs)
```

## Config (env)

`RAG_MODO_EMBEDDER` (`local`|`split`), `RAG_DATABASE_URL`, `RAG_OLLAMA_URL`, `RAG_EMBEDDER_MODEL`
(bge-m3), `RAG_TAG_LOCAL` (`ollama:bge-m3`), `RAG_TAG_COHERE`
(`bedrock:cohere-embed-multilingual-v3`), `RAG_BEDROCK_REGION` (`us-east-1`), `RAG_BEDROCK_MODEL_ID`
(`cohere.embed-multilingual-v3`), `RAG_CHUNK_CHARS` (1200), `RAG_CHUNK_OVERLAP` (200), `RAG_BACKEND`
(`http://localhost:4100`), `RAG_CHAT_MODEL` (vacío = sin prosa LLM).

## Notas de diseño

- **Dos espacios vectoriales:** dos embedders de la misma dimensión producen vectores en espacios
  distintos. `buscar_docs` filtra SIEMPRE por un único `embedder` (columna de primera clase). Al
  agregar Cohere para docs públicos → columna/tabla/índice separados. Nunca se comparan cruzados.
- **Idempotencia:** re-ingestar un doc borra sus chunks (`doc` + `embedder`) y re-inserta.
- **Sensibilidad:** hoy por archivo (`docs/loops/` → `sensible=true`). Por chunk es roadmap.
