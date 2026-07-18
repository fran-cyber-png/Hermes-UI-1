# 29 — Integración de Ivi con la plataforma: el cerebro consolidado

> El plan de cómo Ivi razona sobre **toda** la plataforma Goberna. Cierra la referencia colgante
> de [`plataformas/README.md`](./plataformas/README.md) y [`plataformas/meta-escuela-ivi.md`](./plataformas/meta-escuela-ivi.md).
> Spec fundacional: [`prompts/rag-ivi-construir.md`](./prompts/rag-ivi-construir.md). Documento **vivo**:
> se actualiza a medida que se construye capa por capa.

## 0. El problema (por qué esto existe)

El negocio educativo de Goberna vive **fragmentado en tres hosts y muchas cajas**: Cerberus
(ventas, MariaDB en VPS2), Icarus (leads/campañas, Postgres en VPS1), goberna-escuela (LMS,
Postgres 17), gasto de Meta (goberna-dashboard/nexus-meta), y meta-escuela (pauta + el motor Ivi).
Hoy Ivi solo ve **un pedazo**: ventas de Cerberus × gasto de Meta, cruzadas por país. No sabe de
qué campaña vino un lead, si se matriculó, qué curso terminó, ni cuánto vale en el tiempo.

**La decisión (2026-07-18):** unificar. No a nivel de mover cajas primero, sino construyendo el
**cerebro** que razona sobre todo — y que después se convierte en el punto donde converge lo demás.

## 1. El programa de consolidación (tres tracks)

| # | Track | Qué es | Estado |
|---|---|---|---|
| **1** | **Ivi = cerebro único** | Un solo `ask()` que razona sobre todo el embudo vía un catálogo de herramientas BI + un vector store. Unifica ACCESO y razonamiento; no toca producción. | **EN CURSO** (primer corte hecho, §4) |
| **2** | **Racionalizar la infra** | Consolidar las duplicaciones reales (3 CRMs `icarus`/`leads_crm`/`goberna_crm`; LMS desplegado 2×; 2º `ivi_server`) hacia una sola fuente de verdad por dominio. Toca prod → mapa/ADR primero, sin borrar nada. | Pendiente (ADR) |
| **3** | **Converger los asistentes** | Unificar Ivi analista (este repo) + Ivi personal (`Goberna-Lab/ivi`) + `goberna-bot` en un solo asistente. Decisión de producto. | Pendiente (ADR) |

**La tesis de secuencia:** el track 1 es la **columna vertebral**. Los otros dos se enchufan *a
él*: un MCP server sobre el mismo catálogo (converge asistentes), y una sola `governa.<dominio>.*`
por dominio detrás de la cual la fuente de verdad se consolida (racionaliza infra). Por eso el
cerebro va primero.

## 2. La arquitectura (híbrida, 4 capas)

```
                      ask(pregunta, usuario)   ← ÚNICO punto de entrada (el cerebro)
                              │
                     ROUTER (barato)  → estructurada | semántica | mixta
              ┌───────────────┼───────────────────────────┐
       consultar_bi                              buscar_docs(query, k)
   POST /api/sdk/invocar/:tool                   pgvector HNSW coseno
   (el CATÁLOGO SDK = 1 contrato)                (tabla rag.documentos)
   ┌───── unifica TODAS las fuentes ─────┐       ┌── unifica el TEXTO ──┐
   ventas · atribución · pauta · lazo             docs · copy · playbooks · CQs
   · tesorería  (+ futuro:                        (bge-m3 local / futuro Cohere público)
   governa.escuela.* · governa.icarus.*)
              └───────────────┬───────────────────────────┘
                    ORQUESTADOR (tool-use) → combina cifras + contexto, CITA fuente, Ley I
```

**La tesis técnica de la unificación:**
- el **catálogo SDK** (`server/src/routes/sdk.ts`, 10 herramientas `governa.*` Zod-tipadas,
  auto-descriptivas, read-only) unifica las **herramientas estructuradas**;
- **pgvector** (`rag.documentos`) unifica el **conocimiento no estructurado**;
- **`ask()`** es el único cerebro que orquesta ambos.

### La Regla de Oro (Ley I estructural — no negociable)

Los **NÚMEROS salen SIEMPRE de SQL** (el motor determinista hace la aritmética). El **RAG de
embeddings es SOLO para texto** no estructurado. Nunca sumar/promediar/filtrar por similitud de
vectores: sobre datos tabulares eso es un antipatrón (recupera top-k por parecido, no el conjunto
completo). Toda respuesta cita fuente y tipo: **HECHO** (número calculado) / **CONTEXTO** (doc
citado) / **SIN_EVIDENCIA**.

## 3. Dónde vive cada dato (mapa real, recon 2026-07-18)

| Dato | Dónde | Cómo lo alcanza el cerebro |
|---|---|---|
| **Ventas** (Cerberus) | VPS2 · MariaDB 10.6 + API `:8001` | ya ingestado (dump SQL + webhook → `ontologia.venta`), vía SDK `governa.ventas.*`/`atribucion.*` |
| **Gasto Meta** | VPS2 · goberna-dashboard `:8002` (`tb_meta_ads`) + snapshots locales | SDK `governa.pauta.serie` / `atribucion.roasPorPais` |
| **Leads/campañas** (Icarus) | VPS1 · `icarus_db` postgres:17 + API `:8092` (schema `icarus`) | **falta** → `governa.icarus.*` (track 1, capa siguiente) |
| **Matrículas/avance** (LMS) | `goberna_escuela_db` postgres:17 + API `:4040` (tRPC) | **falta** → `governa.escuela.*` (track 1, capa siguiente) |
| **Docs/copy/playbooks/CQs** | este repo + Postgres JSONB (copy) + landings | **RAG** `rag.documentos` (buscar_docs) |

> Nota infra: `pgvector` ya corre en el ecosistema (`goberna_crm_db` pg15, `leads_crm_db` pg16).
> Detalle completo de topología y duplicaciones → track 2 (ADR de racionalización).

## 4. Lo construido — primer corte (2026-07-18)

Todo local, sin AWS, sin tocar prod. Paquete: [`goberna-kos/rag/`](../goberna-kos/rag/).

1. **pgvector + tabla `rag.documentos`** — imagen local `postgres:17-alpine` → `pgvector/pgvector:pg17`
   (mismo major, volumen intacto); `CREATE EXTENSION vector` (0.8.5); tabla
   `documentos(id, fuente, doc, posicion, chunk, embedding vector(1024), embedder, sensible,
   metadata jsonb, creado_at)` + índice **HNSW coseno** (`m=16, ef_construction=64`), definida en
   Drizzle (`server/src/db/rag.ts`, `schemaFilter += "rag"`).
2. **Embedder — dos backends, 1024-dim, pluggables** (`rag/embedder.py`):
   - **bge-m3 en GEOGRAFO** (A4000, `100.117.204.80:11434`, always-on donde vive Ivi — NO en la
     Mac). Es el **default** (modo `local`): sin nube, offline-safe, y el mejor recall en nuestro
     corpus.
   - **Cohere `embed-multilingual-v3` por Bedrock** (vía AWS CLI, sin boto3) para docs PÚBLICOS en
     el modo `split`. Bedrock quedó **activado y verificado** (`us-east-1`, acceso ya concedido).
   - **Split** (modo `split`): público→Cohere, sensible→bge-m3 local (Ley I: el texto sensible nunca
     sale a la nube). Dos espacios vectoriales — `buscar_docs` consulta cada uno por separado y
     mergea; nunca compara cruzado.
   - **Medición (golden set):** bge-m3 local **recall@3 = 94 %** (MRR 0.852) vs Cohere split
     **89 %** (MRR 0.844) → comparables, con bge-m3 marginalmente arriba. Decisión: **default
     `local` (bge-m3/geografo)**, Bedrock cableado y a mano (`RAG_MODO_EMBEDDER=split`) para
     descargar el embedding de públicos a la nube/crédito cuando convenga.
3. **Ingestión** (`rag/ingest.py`) — 60 docs (`docs/**/*.md` + `cqs/catalog.json`), chunking
   semántico con solape respetando encabezados → **1479 chunks** embebidos y upserteados
   (idempotente por documento). `docs/loops/` marcado `sensible=true`.
4. **buscar_docs + golden set** — `buscar_docs(query, k)` sobre HNSW; golden set de 18 queries
   reales → **recall@3 = 94 %, recall@1 = 83 %, MRR 0.889**. El único miss es un caso conocido-débil
   (hybrid search, §5).
5. **`ask()` con router** (`rag/ask.py`) — router determinista (señal estructurada = el scorer de
   intents de Ivi; señal semántica = similitud top de buscar_docs) que decide
   estructurada/semántica/mixta; `consultar_bi` invoca el **catálogo SDK en vivo** (allowlist por
   construcción); respuesta tipada y citada (Ley I). Verificado end-to-end contra el backend `:4100`.

## 5. Roadmap por capas (lo que sigue)

**Track 1 (cerebro), próximas capas:**
- **Hybrid search (BM25 + vector)** — cierra el caso débil del golden set (términos específicos como
  "serie temporal"/"time_increment" que el vector solo no prioriza). Full-text `tsvector` en la
  misma tabla.
- **Sensibilidad por chunk** (no solo por archivo) — refina el split de embedders.
- **Split de embedders — HECHO** (Cohere público / bge-m3 sensible, medido). Queda como opción
  (`split`); el default es `local` porque bge-m3 rinde marginalmente mejor. **Regla dura vigente:**
  dos embedders = dos espacios vectoriales → `buscar_docs` consulta cada uno por separado, nunca
  compara cruzado.
- **Extender el catálogo BI** — `governa.escuela.*` (matrículas/completación) y `governa.icarus.*`
  (leads/campañas). Decisión de acceso: conector directo a esas DBs (existen copias locales de dev,
  `goberna_escuela_db:5433`, `icarus_db_test:5544`) vs. ETL-mirror a `fuentes.registro` (extiende el
  patrón de espejo crudo que ya hay). Guardarraíles: read-only, LIMIT, timeout, allowlist de vistas.
- **Orquestador agéntico (tool-use) + prosa** — un LLM que llama `consultar_bi` + `buscar_docs`,
  combina y redacta (Ley I: solo redacta hechos calculados). Router/orquestador barato: qwen3 local
  (geógrafo) o Haiku 4.5. Hoy la prosa es opcional (`RAG_CHAT_MODEL`); el corte devuelve evidencia
  determinista + citas.
- **Fine-tuning: último recurso** — orden few-shot → RAG → QLoRA (qwen3, A4000, ~6 GB) solo con
  corpus real `Pregunta→SQL` corregido y el few-shot estancado. Claude no se fine-tunea (voz por
  system-prompt + few-shot + RAG).

**Track 2 (infra):** ADR de racionalización — una fuente de verdad de leads (¿`icarus`?), un LMS
canónico, retirar el 2º `ivi_server`. Sin borrar nada hasta decidir.

**Track 3 (asistentes):** ADR de convergencia — MCP server sobre el catálogo SDK como superficie
común; decidir si Ivi analista e Ivi personal comparten cerebro.

## 6. Reality gaps (lo que el cerebro NO puede contestar honestamente todavía)

- No hay serie de gasto **país × tiempo** ni atribución causal ad→venta (solo geográfica).
- Ventas con **rezago** (dump manual de Cerberus; el webhook va a Icarus y no re-proyecta el canónico).
- `tb_matricula` de Cerberus está **incompleto** (Moodle/LMS es la verdad) → matrículas requieren el
  conector `governa.escuela.*`.
- El backend meta-escuela **corre local** (Mac), sin auth y sin deploy → cuando la Mac está apagada,
  el cerebro no alcanza el SDK. Decisión de deploy pendiente.

## 7. Cómo correrlo

```bash
# 0. Postgres con pgvector + Ollama sirviendo bge-m3
docker compose up -d --wait
ollama serve &            # si no está corriendo
ollama pull bge-m3

# 1. desde goberna-kos/
python3 -m rag.ingest              # ingesta docs/ + catalog.json → rag.documentos
python3 -m rag.evaluar             # golden set: recall@k
python3 -m rag.buscar "ROAS por país" -k 5
python3 -m rag.ask    "cómo está el lazo con la CAPI"   # necesita el backend :4100 arriba
```
