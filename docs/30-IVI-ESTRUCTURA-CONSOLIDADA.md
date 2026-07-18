# 30 — Ivi: estructura consolidada (conexiones · patrones · embeddings · inferencias)

> Mapa completo de lo construido en la sesión del **2026-07-18**: el cerebro RAG de Ivi, sus
> conexiones, los patrones que lo gobiernan, la capa de embeddings, la de inferencias, y el deploy
> always-on en VPS1 para dato en tiempo real. Pensado para **analizar e investigar** el sistema.
> Complementa el blueprint [`docs/29`](./29-INTEGRACION-IVI-PLATAFORMA.md) y el ADR
> [`docs/adr/0001`](./adr/0001-rag-ivi-pgvector-primer-corte.md).

---

## 1. Resumen ejecutivo

Se construyó el **cerebro consolidado de Ivi**: un solo `ask(pregunta, usuario)` que razona sobre
todo el embudo Goberna combinando **cifras exactas** (por SQL/SDK, deterministas) con **contexto
documental** (por embeddings/pgvector), citando fuente y honrando la Ley I (los números NO salen de
embeddings). Y se arrancó el **deploy always-on en VPS1**, requisito duro para que el dato esté fresco.

**Lo que quedó vivo y verificado:**
- RAG completo: pgvector + ingestión (62 docs → 1489 chunks) + `buscar_docs` + golden set
  (**recall@3 = 94 %**) + `ask()` con router. Rama `feat/rag-ivi`.
- Bedrock activado (Cohere `embed-multilingual-v3`, `us-east-1`) + split público/sensible medido.
- Backend meta-escuela desplegado en VPS1 (Docker), con la data replicada desde la Mac.
- Escrituras a Meta **apagadas** (real-time de LECTURA, no de envío).

**Lo que falta para cerrar el tiempo real** (§8): 1 regla de firewall en VPS1 (requiere tu sudo),
repuntar Ivi al backend de VPS1, y automatizar la frescura de ventas.

---

## 2. La arquitectura — el cerebro híbrido (4 capas)

```
                      ask(pregunta, usuario)          ← ÚNICO punto de entrada
                              │
                     CAPA 1 · ROUTER (barato, determinista)
                     estructurada | semántica | mixta
              ┌───────────────┼───────────────────────────────┐
     CAPA 2 · consultar_bi                         CAPA 3 · buscar_docs(query, k)
   POST /api/sdk/invocar/:tool                     pgvector · HNSW · coseno
   (catálogo SDK governa.*, read-only)             tabla rag.documentos
   NÚMEROS = HECHO, deterministas                  TEXTO = CONTEXTO citado
              └───────────────┬───────────────────────────────┘
              CAPA 4 · ORQUESTADOR → combina cifras + contexto, CITA fuente y TIPO
                       (HECHO / CONTEXTO / SIN_EVIDENCIA)  — Ley I
```

**La tesis de unificación** (el porqué de todo):
- el **catálogo SDK** (`governa.<dominio>.<acción>`) unifica las **herramientas estructuradas**;
- **pgvector** (`rag.documentos`) unifica el **conocimiento no estructurado**;
- **`ask()`** es el único cerebro que orquesta ambos.
- A eso se enchufan después: un MCP server sobre el mismo catálogo (converger asistentes), y una
  sola fuente de verdad por dominio detrás de cada `governa.*` (racionalizar infra).

### La Regla de Oro (Ley I — no negociable)
Los **NÚMEROS salen SIEMPRE de SQL** (el motor determinista hace la aritmética). El RAG de
embeddings es **SOLO para texto**. Nunca sumar/promediar/filtrar por similitud de vectores sobre
datos tabulares: recupera top-k por parecido, no el conjunto completo → los agregados salen mal.

---

## 3. Conexiones — la topología real (recon 2026-07-18)

### Hosts y roles
| Host | Acceso | Rol | Piezas |
|---|---|---|---|
| **Mac** (workstation) | local | Dev; hoy corre el backend + PG local | backend `:4100`, `meta_escuela_db` PG `:5434` |
| **Geografo** (A4000 16GB) | `ssh ia` · `100.117.204.80` | Cerebro IA always-on | Ivi engine (`:8080`, systemd), **Ollama** (bge-m3, qwen3:8b, ivi-ventas, qwen2.5vl) `:11434` |
| **VPS1** | `deploy@161.132.39.165` · tailnet `100.85.119.49` | Prod: apps + datos | **backend meta-escuela NUEVO** `:4100`, icarus_db, goberna_escuela_db, pgvector (goberna_crm/leads_crm) |
| **VPS2** | `root@75.119.138.200` | Prod: fuentes | **Cerberus** (`cerberus_db` MariaDB, DB `goberna_app`) `:8001`, goberna_dashboard (Meta Ads) |
| **AWS Bedrock** | AWS CLI (perfil `~/.aws`, acct 177914733251) | Embedder público | Cohere `embed-multilingual-v3`, `us-east-1` |

### Quién habla con quién (flujo del cerebro)
```
Usuario ─▶ Ivi engine (geografo) ─HTTP─▶ backend meta-escuela ─▶ Postgres (fuentes/ontologia/rag)
                    │                          (IVI_BACKEND)
                    ├─ Ollama bge-m3 (geografo, local)        ← embeddings LOCALES (sensible + default)
                    └─ AWS Bedrock Cohere (us-east-1)         ← embeddings PÚBLICOS (modo split)

Datos que alimentan el backend:
  Cerberus (VPS2, MariaDB goberna_app) ─dump SQL─▶ fuentes.registro ─proyectar─▶ ontologia.venta
  Meta Ads insights ──reloj pauta cada 6h──▶ pauta_snapshots (gasto)
  Icarus (VPS1) / LMS (VPS1) ──[PENDIENTE: conectores governa.icarus.* / governa.escuela.*]
```

### Puertos / direcciones clave
- Backend (Mac dev): `100.98.60.92:4100` (tailnet de la Mac). Backend (VPS1): `100.85.119.49:4100` (tailnet).
- Ollama geografo: `100.117.204.80:11434` (`/api/embed`, `/api/generate`).
- PG local Mac: `127.0.0.1:5434`. PG VPS1: interno al compose (`db:5432`, subred `10.0.27.0/24`).
- **Seguridad de red VPS1:** `FORWARD policy DROP` + allowlist en `DOCKER-USER` para 5432 (§8).

---

## 4. Embeddings — la capa vectorial

### Dónde vive
- **Tabla `rag.documentos`** (esquema `rag` en el Postgres de meta-escuela). Definida en Drizzle
  (`server/src/db/rag.ts`), imagen `pgvector/pgvector:pg17`.
  ```
  documentos(id, fuente, doc, posicion, chunk,
             embedding vector(1024), embedder, sensible bool,
             metadata jsonb, creado_at)
  índice HNSW (embedding vector_cosine_ops) WITH (m=16, ef_construction=64)
  unique(doc, posicion, embedder)   ← idempotencia por documento
  ```

### Los dos embedders (ambos 1024-dim)
| Embedder | Dónde | Para qué | Tag |
|---|---|---|---|
| **bge-m3** | GEOGRAFO (Ollama, A4000) | default (`local`) + docs SENSIBLES en `split` | `ollama:bge-m3` |
| **Cohere embed-multilingual-v3** | AWS Bedrock (vía AWS CLI, sin boto3) | docs PÚBLICOS en `split` | `bedrock:cohere-embed-multilingual-v3` |

- **El embedder LOCAL vive en geografo, NO en la Mac** (decisión de Estephano): always-on, GPU, sin
  depender de la workstation. bge-m3 es el mismo modelo en cualquier host → **vectores idénticos**.
- **Regla dura de los DOS ESPACIOS VECTORIALES:** dos embedders de la misma dimensión producen
  vectores en espacios DISTINTOS. `buscar_docs` consulta cada espacio por separado (query embebida
  por SU backend) y mergea; **nunca** compara un vector de bge-m3 contra uno de Cohere.

### El pipeline (ingestión)
`fuente → chunking semántico (por encabezados + solape, con tracking de code-fences) → embed en
batch → normalizar (coseno) → upsert idempotente`. Corpus del primer corte: `docs/**/*.md` +
`goberna-kos/cqs/catalog.json` (105 CQs, doble como few-shot). `docs/loops/` = `sensible=true`.

### Medición (golden set, `rag/golden.json`, 18 queries reales)
| Modo | recall@1 | recall@3 | recall@5 | MRR |
|---|---|---|---|---|
| **local** (bge-m3 geografo) | 78 % | **94 %** | 94 % | 0.852 |
| **split** (Cohere público + bge-m3 sensible) | 78 % | 89 % | 94 % | 0.844 |

→ Comparables; bge-m3 marginalmente arriba. **Default = `local`** (más simple, sin nube, mejor
recall). Bedrock queda **cableado y a mano** (`RAG_MODO_EMBEDDER=split`) para descargar el embedding
de públicos a la nube/crédito cuando convenga. El único miss del golden set (gasto/serie temporal)
es un caso conocido-débil que resuelve **hybrid search (BM25 + vector)** — roadmap.

---

## 5. Inferencias — cómo razona `ask()`

Entrada única: `ask(pregunta, usuario)` (`goberna-kos/rag/ask.py`).

1. **Router (determinista, barato):**
   - señal ESTRUCTURADA = el scorer de 19 intents de Ivi reusado (`ivi.intent_analyzer`);
   - señal SEMÁNTICA = la mejor similitud de `buscar_docs`.
   - Umbrales: `BI_MIN=1.5`, `SEM_MIN=0.50`; decide `estructurada | semántica | mixta`.
2. **`consultar_bi(herramienta, params)`** → invoca el catálogo SDK EN VIVO
   (`POST /api/sdk/invocar/:nombre`). **Allowlist por construcción**: solo se invocan herramientas
   presentes en el catálogo. Gate de score (`TOOL_MIN`) para no invocar una herramienta por señal
   débil (evita "HECHO" confiadamente equivocado).
3. **`buscar_docs(query, k)`** → KNN coseno sobre pgvector, cita = `doc › encabezados`.
4. **Tipado Ley I:** cada evidencia lleva su tipo — **HECHO** (número del SDK) / **CONTEXTO** (doc
   citado) / **SIN_EVIDENCIA**. Prosa por LLM es OPCIONAL (`RAG_CHAT_MODEL`); el corte devuelve
   evidencia determinista + citas (Ley I: el modelo solo REDACTA hechos ya calculados).

**Ejemplo real verificado** — *"cómo está el lazo con la CAPI"* → **MIXTA / HECHO**:
`governa.lazo.estado` devolvió `{ventasConocidas: 6727, reportadas: 107, perdidasPorVentana: 255}`
FUSIONADO con el contexto documental del CAPI (cq-catalog + specs), cada uno citando su fuente.

> El motor Ivi actual (`goberna-kos/ivi/`) todavía usa un planner Python a mano sobre 7 endpoints
> `/api/overview*`. Migrarlo a consumir el catálogo SDK (que `consultar_bi` ya usa) es capa siguiente.

---

## 6. Patrones (las reglas que gobiernan el sistema)

- **SDK = capa de unificación estructurada.** `server/src/routes/sdk.ts`: 10 herramientas Zod-tipadas
  `governa.*`, auto-descriptivas (`GET /api/sdk/catalogo` emite JSON Schema), read-only
  (`idempotente:true`). Un solo contrato para Ivi hoy y un MCP server mañana.
  Herramientas: `atribucion.roasPorPais`, `pauta.serie`, `ventas.estados`, `lazo.{estado,detalle,ventanaCapi}`,
  `tesoreria.{reloj,latencia}`, `historia.{deVenta,resumen}`.
- **Idempotencia por documento** (RAG) y por clave natural (ontología/hechos): re-correr no duplica.
- **Ley I codificada**: `criterios.py` (umbrales ROAS/CAC/confianza env-overridable),
  `impact_engine.py` (items tipados HECHO/ESTIMACIÓN/SIN_EVIDENCIA), `prompt_builder.py` (reglas de
  razonamiento). `ask()` las honra, no las reinventa.
- **Sensibilidad → residencia del dato.** Sensible (ventas/leads/P&L, `docs/loops/`) se resuelve
  LOCAL (bge-m3), nunca va a la nube. Público (docs/copy) puede ir por API (Cohere).
- **Fail-closed en las ESCRITURAS.** `LAZO_RELOJ` (CAPI a Meta) ausente = apagado; `DECISIONES_MODO`
  ausente = simulación. En VPS1 se FUERZAN apagados en el compose. Real-time es de LECTURA, no de envío.
- **Embedder-agnóstico + allowlist**: la tubería no depende del embedder; `consultar_bi` no invoca
  nada fuera del catálogo.

---

## 7. Frescura / tiempo real — qué es y qué no

- **El reloj de pauta (`server/src/pauta/reloj.ts`) arranca PRENDIDO** (se apaga con `PAUTA_RELOJ=off`)
  y refresca el gasto/insights de Meta **cada ~6h, mientras el backend corra**. → gasto fresco solo.
- **El linchpin era que el backend corriera always-on.** Corría local en la Mac → por eso el dato
  estaba a ~16h. Desplegado en VPS1 (always-on) → el gasto se refresca solo.
- **"Tiempo real" honesto = auto-refresh en cadencia**, no streaming: las fuentes (Cerberus dump,
  Meta insights 6h) no streamean por naturaleza (medido en `docs/19`). Cadencias:
  - **Gasto/ROAS**: 6h (reloj), automático.
  - **Ventas (Cerberus)**: por dump; automatizar (cron) o cablear el webhook para que RE-PROYECTE
    `ontologia.venta` (hoy solo emite CAPI) → casi al instante. [pendiente]
  - **Leads/Matrículas**: casi al instante una vez conectados Icarus/LMS. [pendiente]

---

## 8. Deploy en VPS1 — estado

**Convención VPS1:** una carpeta por app en `/srv/<app>` con docker-compose; deploy por runners
self-hosted GH por repo. meta-escuela no tenía workflow → se hizo compose directo.

**Hecho:** `/srv/meta-escuela` (rsync del repo), `deploy/vps1/docker-compose.yml`
(`pgvector/pgvector:pg17` + backend, bind solo a `100.85.119.49:4100` tailnet, secretos por
`.env` no versionado con `chmod 600`), imagen construida, **contenedores arriba y healthy**, data
**replicada desde la Mac** (`pg_dump` → VPS1: `fuentes.registro` 115.767 filas, `ontologia` 12
tablas, `rag.documentos` 1489), `CREATE EXTENSION vector`, `ANALYZE`. Escrituras a Meta forzadas
apagadas. Logs confirman: `[pauta] reloj activo cada 6h` + `[lazo] reloj APAGADO`.

**BLOQUEANTE (requiere tu sudo — el classifier bloqueó que lo corra yo):** VPS1 tiene
`FORWARD policy DROP` + allowlist en `DOCKER-USER` para 5432. La subred del compose
(`10.0.27.0/24`, pinneada) no está en el allowlist → el backend NO alcanza su db
(`CONNECT_TIMEOUT db:5432`). **Fix (mismo patrón que las otras apps):**
```bash
sudo iptables -I DOCKER-USER 1 -s 10.0.27.0/24 -p tcp -m tcp --dport 5432 -j ACCEPT \
  -m comment --comment "meta-escuela internal db"
sudo netfilter-persistent save   # persistir (o iptables-save > /etc/iptables/rules.v4)
```
Después: `docker compose restart backend` y las herramientas SDK devuelven datos.

**Pendiente tras el firewall:** repuntar Ivi (`IVI_BACKEND=http://100.85.119.49:4100`) y el front;
automatizar la frescura de ventas; conectores `governa.icarus.*` / `governa.escuela.*`.

---

## 9. Reality gaps (lo que el cerebro NO puede contestar honestamente todavía)

- No hay serie de gasto **país × tiempo** ni atribución causal ad→venta (solo geográfica).
- **Ventas con rezago** (dump manual; el webhook va a Icarus y no re-proyecta el canónico).
- `tb_matricula` de Cerberus está **incompleto** (Moodle/LMS es la verdad) → matrículas requieren
  el conector `governa.escuela.*`.
- **Icarus y LMS aún no conectados** a Ivi.
- Sensibilidad hoy por archivo, no por chunk; prosa por LLM opcional (no hay chat model en la Mac).

---

## 10. Estado actual + próximos pasos

**Commits (rama `feat/rag-ivi`, pusheada a `origin`):**
- `f3bc529` RAG completo · `6d849e2` scaffolding deploy VPS1 · + hardening/dockerignore · este doc.

**Próximos pasos (en orden):**
1. **[tú]** correr la regla de firewall (§8) → cerrar el deploy de datos en VPS1.
2. Repuntar Ivi/front al backend de VPS1; verificar respuestas con dato fresco.
3. Automatizar frescura de ventas (cron `cerberus:ingestar/proyectar` o webhook reproject).
4. Conectores `governa.icarus.*` / `governa.escuela.*` (entregable 6; DBs co-locadas en VPS1).
5. Hybrid search (BM25+vector) para el caso débil del golden set.
6. Tracks del programa: converger asistentes (MCP sobre el catálogo) + racionalizar infra (ADR).

---

## 11. Cómo correr cada cosa

```bash
# Infra local
docker compose up -d --wait                      # Postgres + pgvector (Mac)
# Embedder en geografo
ssh ia 'ollama pull bge-m3'                       # una vez

# RAG (desde goberna-kos/)  — OLLAMA apunta a geografo por default
python3 -m rag.ingest                             # ingesta docs/ + catalog.json
python3 -m rag.evaluar                            # golden set: recall@k
python3 -m rag.buscar "ROAS por país" -k 5        # búsqueda semántica
python3 -m rag.ask    "cómo está el lazo CAPI"    # el cerebro (router + SDK + docs)
RAG_MODO_EMBEDDER=split python3 -m rag.ingest      # público→Cohere, sensible→bge-m3

# Bedrock (verificar)
aws bedrock-runtime invoke-model --region us-east-1 --model-id cohere.embed-multilingual-v3 ...

# Deploy VPS1 (ver deploy/vps1/README.md — runbook completo)
```

---

## 12. Índice de archivos (dónde vive cada pieza)

| Pieza | Ruta |
|---|---|
| Blueprint de consolidación | `docs/29-INTEGRACION-IVI-PLATAFORMA.md` |
| ADR primer corte | `docs/adr/0001-rag-ivi-pgvector-primer-corte.md` |
| Este mapa | `docs/30-IVI-ESTRUCTURA-CONSOLIDADA.md` |
| Tabla vectorial (Drizzle) | `server/src/db/rag.ts` |
| Paquete RAG (Python) | `goberna-kos/rag/{config,embedder,chunker,store,ingest,buscar,evaluar,ask}.py` |
| Golden set | `goberna-kos/rag/golden.json` |
| Catálogo SDK | `server/src/routes/sdk.ts`, `server/src/sdk/`, `server/src/sdk/herramientas/*.ts` |
| Motor Ivi actual | `goberna-kos/ivi/` (server.py, intent_analyzer.py, criterios.py, impact_engine.py) |
| Relojes (frescura/escritura) | `server/src/pauta/reloj.ts`, `server/src/lazo/reloj.ts` |
| Ingesta Cerberus | `server/src/scripts/cerberus.ts`, `server/src/fuentes/cerberus.ts` |
| Deploy VPS1 | `server/Dockerfile`, `deploy/vps1/{docker-compose.yml,README.md}` |
| Fichas de plataformas | `docs/plataformas/*.md` |
