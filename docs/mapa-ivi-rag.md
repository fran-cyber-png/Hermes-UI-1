# Mapa de Ivi y su RAG — cómo funciona, qué datos tiene, y dónde está la fuga

> Medido en vivo el **2026-07-28** contra geografo (`ivi_rag_pg`, db `ivi_rag`) y leyendo
> `ivi-cerebro@main`. Todo número acá sale de una consulta, no de un doc.
>
> **La conclusión primero**: la fuga **no es el reranker**. El reranker está bien implementado. La
> fuga es que **el corpus está invertido** — el 86,6 % de lo que Ivi puede leer es documentación de
> cómo se construyó Ivi, y sólo el 0,8 % son procedimientos reales del negocio.

---

## 1. El pipeline, tal como corre

```
PREGUNTA
   │
   ├─[GATES TEMPRANOS] ────────── cortan ANTES de gastar retrieval
   │    · _metrica_inexistente        → SIN_EVIDENCIA
   │    · _granularidad_no_soportada  → SIN_EVIDENCIA
   │
   ├─[ROUTER]  _rutar(bi_score, sem_top)   → estructurada | semántica | mixta
   │    · señal ESTRUCTURADA: keywords → tool del catálogo (determinista)
   │    · señal SEMÁNTICA: la mejor similitud de buscar_docs
   │
   ├─[CAPA 2 · LOS NÚMEROS]  consultar_bi(tool, params)
   │    └─► HTTP a meta-escuela  VPS1 100.85.119.49:4100  (tailnet)
   │        catálogo `governa.*` · allowlist POR CONSTRUCCIÓN · read-only
   │        devuelve HECHOS. ⚠️ ver §4.3: la proyección está congelada
   │
   ├─[CAPA 3 · EL TEXTO]  buscar_docs(pregunta, k, de_negocio=…)
   │    de_negocio = pide_dato(p) OR _pregunta_de_plata(p)
   │    │
   │    ├─ embed_uno(query) por cada backend activo
   │    │     ollama:bge-m3 (local, :11434)  ·  bedrock:cohere (existe, sin usar)
   │    │     «modo split»: nunca compara vectores de espacios distintos
   │    │
   │    ├─ store.buscar → KNN coseno sobre HNSW, con la penalización EN EL `ORDER BY`
   │    │     · PENALIZAR_DEV                      = 0.03  (nudge de siempre)
   │    │     · PENALIZAR_DEV_NEGOCIO              = 1.00  (duro, si de_negocio)
   │    │     · PENALIZAR_PROCEDIMIENTO_DEROGADO   = 1.00
   │    │     · FTS español + RRF (k=60, peso texto 0.4) ── HIBRIDO=0, **APAGADO hoy**
   │    │
   │    └─ _rerank → bge-reranker-v2-m3 (:8098, cross-encoder) sobre top-N → k
   │          · si falla: sigue sin rerank («es un plus, no un punto de falla») ✅
   │
   ├─[BACKSTOP LEY I]  _dispara_backstop_dato
   │    ¿pide un DATO y no hay HECHO de una tool? → DESCARTA el CONTEXTO → SIN_EVIDENCIA
   │    (una pregunta de dato no se contesta con un doc, aunque el doc «sepa»)
   │
   └─[REDACCIÓN]  responder() → Haiku por Bedrock (Nova y qwen3 de respaldo)
        · el LLM SOLO redacta hechos ya calculados — nunca los inventa ni recalcula
        · grounding post-check: `_no_verificados` chequea cada cifra contra los datos
        · declara tipo:  HECHO · CONTEXTO · SIN_EVIDENCIA
```

---

## 2. Qué datos tiene, de verdad

```
rag.documentos:  2.423 chunks · 40 MB · 478 k-tokens · 789 chars/chunk
volumen pgvector: 120 MB   ·   TODO ingestado el 2026-07-27 (un solo golpe)
embedder:        ollama:bge-m3 → 2.423  ·  bedrock → 0  (el backend existe y nunca se usó)
índices:         documentos_embedding_hnsw · documentos_fts_es · documentos_embedder_idx
```

### 2.1 🔴 El reparto que explica todo

| Categoría | Chunks | % | Qué es |
|---|---:|---:|---|
| **`dev`** | **2.098** | **86,6 %** | Cómo está construida Ivi: specs, RFCs, benchmarks, ADRs, prompts |
| `negocio` | 306 | 12,6 % | …y ver §2.3, porque tampoco son lo que el nombre promete |
| **`procedimiento`** | **19** | **0,8 %** | **Los únicos 4 documentos operativos reales** |

### 2.2 Los documentos más pesados son todos sobre el software

| Chunks | Documento |
|---:|---|
| 220 | `meta-escuela/specs/2026-07-16-rediseno-01-auditoria.md` |
| 139 | `meta-escuela/PROYECTO-CONSOLIDADO.md` |
| 109 | `meta-escuela/specs/2026-07-15-rfc-cq-engine.md` |
| 105 | `cq-catalog` |
| 97 | `meta-escuela/specs/2026-07-16-rediseno-02-benchmark.md` |
| 76 | `…goberna-knowledge-os-v01-design.md` |
| 67 | `docs/analisis/madurez-15-capas.md` |
| 66 | `docs/analisis/eleccion-de-modelos-generacion.md` |

**El cerebro del negocio tiene, como documento más grande, la auditoría de su propio rediseño.**

### 2.3 Los 306 de «negocio» tampoco son del negocio

Al abrirlos: `meta-escuela/00-OVERVIEW.md`, `04-REALITY-GAPS.md`, `08-FASE-1.md`,
`10-EL-LAZO-Y-TESORERIA.md`, `11-SDK-Y-LA-HISTORIA.md`, `27-PLAN-DATA-Y-MARCO-ANALITICO.md`,
`loops/`, `plataformas/{cerberus,icarus,goberna-escuela,ia-box}.md`.

Son documentos **de ingeniería *sobre* el negocio**, no documentos **del negocio**. Están escritos
por el equipo que construyó el sistema, con el vocabulario del sistema.

### 2.4 Los 4 procedimientos reales — y ninguno tiene dueño

| Chunks | Documento | `dueno` |
|---:|---|---|
| 6 | `procedimientos/matricula-transferencia.md` | **pendiente — sin asignar** |
| 5 | `procedimientos/factura.md` | **pendiente — sin asignar** |
| 4 | `procedimientos/reembolso.md` | **pendiente — sin asignar** |
| 4 | `procedimientos/descuentos.md` | **pendiente — sin asignar** |

Existe maquinaria completa para vigencia de procedimientos
(`PENALIZAR_PROCEDIMIENTO_DEROGADO = 1.0`, `vigente_desde`, `estado`) construida para **cuatro
documentos que nadie posee**.

### 2.5 El etiquetado de dominio está vacío

`dominio`: **2.404 `null`** · `escuela` 10 · `transversal` 9. La maquinaria de filtrado por dominio
existe y no tiene con qué filtrar.

---

## 3. Lo que está BIEN — y hay que decirlo, porque es mucho

No es un RAG mal implementado. Como **motor**, está por encima de la mayoría:

1. **La Ley I tiene un backstop real, no una promesa de prompt.** `_dispara_backstop_dato` descarta
   la evidencia CONTEXTO y fuerza SIN_EVIDENCIA cuando la pregunta pide un dato y ninguna tool lo
   dio. Casi nadie hace esto.
2. **Gates que cortan antes del retrieval** — no se gasta un embedding en una pregunta que ya se
   sabe que no se puede responder.
3. **El reranker degrada, no tumba**: `except` explícito, *«el reranker es un plus, no un punto de
   falla»*. Correcto.
4. **Modo split de espacios vectoriales**: nunca compara vectores de embedders distintos. La trampa
   clásica, evitada por diseño.
5. **Tipos declarados** (HECHO · CONTEXTO · SIN_EVIDENCIA) y grounding post-hoc de cada cifra.
6. **Infraestructura de evaluación de verdad**: `gimnasio.py` corre el golden, `correccion.py`
   decide qué cuenta como acierto resolviendo la expectativa contra el catálogo vivo —así «la tool
   no existe» no se cuenta como fallo de Ivi—, y `auditoria.py` deja el artefacto.
7. **Las penalizaciones están parametrizadas y documentadas con su razón**, no hardcodeadas.

---

## 4. Dónde está la fuga

### 4.1 🔴 La fuga principal: el corpus está invertido, y ellos ya lo midieron

`rag/config.py` lo dice con todas las letras:

> *«Medido el 2026-07-27 sobre el corpus vivo: 2.098 de 2.423 chunks (86,6 %) son categoría 'dev'.
> Y no es un problema estético de ranking — los docs 'dev' **TRAEN NÚMEROS, viejos y congelados**.»*

O sea: un spec del 15 de julio con cifras adentro puede salir como **CONTEXTO** para una pregunta
de negocio. La Ley I protege el camino del **HECHO**; el camino del **CONTEXTO** queda expuesto a un
corpus lleno de números muertos.

### 4.2 La trampa que hace que no se pueda arreglar subiendo la penalización

El propio config lo explica: *«Ivi también contesta preguntas de INGENIERÍA («¿cómo está el lazo
CAPI?»), y ahí los docs 'dev' son la respuesta correcta.»*

**Están arbitrando en tiempo de consulta entre dos corpus que deberían ser dos colecciones.** La
penalización (`de_negocio` → 1.0) es un **control compensatorio de un problema de datos**, y por eso
tiene un techo: no se puede endurecer sin romper el otro caso de uso.

Y tiene una fuga declarada en el código: la penalización **sólo actúa en la rama del VECTOR**. El
full-text no penaliza por categoría, así que *«con `hibrido=True` un doc 'dev' todavía puede entrar
por RRF vía la lista léxica»*. Hoy no muerde porque `HIBRIDO=0`, pero **queda armada para el día que
alguien prenda el híbrido**.

### 4.3 La segunda fuga: la Capa 2 sirve números viejos y no lo dice

`consultar_bi` va al catálogo `governa.*` de **meta-escuela**, cuya proyección está **congelada
desde el 2026-07-13** (documentado en su propio repo: la única ingesta que existió fue un `mysqldump`
a mano). El `/health` responde `{"ok":true}` — **y eso no dice nada sobre la frescura del dato.**

Un `{"ok":true}` que no distingue «vivo» de «vivo con datos de hace dos semanas» es exactamente el
patrón que el ADR 0002 de Ivi condena en otro lado (*«un `{"ok": true}` con ceros les costó
semanas»*).

### 4.4 La tercera, y la que más importa para Hermes: **Ivi no puede responder lo que se le va a preguntar**

Una vendedora aprieta `i` en Hermes y pregunta:

| Pregunta real de una vendedora | ¿Puede Ivi? |
|---|---|
| «¿el diploma de Inteligencia da certificado?» | ❌ no hay catálogo de cursos |
| «¿cómo manejo la objeción de precio?» | ❌ no hay manejo de objeciones |
| «¿se puede pagar en cuotas?» | ❌ (y es la frase que Hermes ya midió: dicha 2 veces en 1.876 conversaciones) |
| «¿qué hago si pagó y no entró al campus?» | 🟡 4 chunks, sin dueño |
| «¿cómo está el lazo CAPI?» | ✅ **perfectamente** |

**El sistema está afinado para el consumidor equivocado.** Fue construido por ingeniería, alimentado
con la documentación de ingeniería, y evaluado con un golden de ingeniería — y su consumidor
declarado es una vendedora.

### 4.5 Y no es el reranker

El reranker (`bge-reranker-v2-m3`, cross-encoder sobre top-N) es la pieza **mejor** resuelta del
pipeline: reordena, degrada limpio si falla, y es la mejora de precisión más citada de la
literatura. **Reordenar mejor un corpus que no contiene la respuesta no produce la respuesta.**

---

## 5. El plan (documentación y diseño — nada de implementación todavía)

### P1 · Partir el corpus en DOS COLECCIONES, no una con penalización

`corpus:negocio` y `corpus:ingenieria`, y que el router elija **cuál consultar** en vez de penalizar
dentro de una sola. Es la misma decisión que «un índice por tenant», pero por dominio.

Beneficios: se puede endurecer cada uno sin romper el otro · desaparece la fuga del FTS · cada
colección tiene su frescura y su custodio · el gimnasio puede medirlos por separado.

**Prerrequisito**: el etiquetado de `dominio`, que hoy es `null` en el 99,2 %.

### P2 · Ingestar el negocio (esto es lo que falta, y es casi todo)

Lo que Hermes necesita que Ivi sepa, en orden de valor medido:

1. **Catálogo de cursos** con qué incluye cada uno, duración, modalidad, a quién sirve.
2. **Manejo de objeciones** — la #1 está medida (aplazamiento, 13 %) y la palanca también
   (responder en < 5 min).
3. **Los cuatro hechos de #153**, que cierran ventas y casi nunca se dicen.
4. **Políticas**: reembolso, cuotas, transferencia de matrícula, factura, descuentos — **los cuatro
   que ya están, con dueño asignado y vigencia**.
5. **FAQ real** — sale del corpus de 1.876 conversaciones que Hermes ya tiene.

### P3 · Custodio y vida media por documento

La columna `dueno` existe y dice «pendiente — sin asignar» en los cuatro que importan. Un documento
sin custodio no se puede mantener vigente, y la maquinaria de derogación ya está construida
esperando a que alguien la use.

### P4 · Frescura declarada en la Capa 2

Que `consultar_bi` devuelva la **edad del dato** junto al hecho, y que la app la muestre. Hermes ya
tiene la regla del lado del cliente (*«`edad_del_dato: null` es NO MEDIDO, no fresco»*); falta que el
otro extremo la produzca. Mientras meta-escuela esté congelado, **Ivi debería decirlo**, no servir
julio-13 como si fuera hoy.

### P5 · Un golden de NEGOCIO, no de ingeniería

El gimnasio ya tiene `--negocio` con las 100 preguntas del CEO. Falta el equivalente para la
vendedora: las preguntas que Hermes va a mandar por `POST /api/preguntar`. **Ese golden es el que
decide si P2 funcionó**, y hay que escribirlo *antes* de ingestar, no después.

### Orden

```
P1 (partir) ──┬─► P2 (ingestar negocio) ──► P5 (golden de vendedora) ──► medir
              └─► P3 (custodios) ── P4 (frescura de la Capa 2)
```

P5 se escribe **antes** de ejecutar P2, aunque se corra después: sin él, «ingestamos el negocio» no
tiene criterio de terminado.

---

## 6. Resumen en cinco líneas

1. El **motor** está bien construido: Ley I con backstop real, gates tempranos, reranker que degrada,
   espacios vectoriales separados, y evaluación propia. Está por encima del promedio.
2. El **corpus** está invertido: 86,6 % es documentación de cómo se hizo Ivi; 0,8 % son
   procedimientos del negocio, y esos cuatro no tienen dueño.
3. Las penalizaciones son un **control compensatorio** con techo, porque el mismo corpus sirve a dos
   consumidores incompatibles.
4. La **Capa 2 sirve números congelados desde el 13-jul** y su `/health` no lo delata.
5. Por eso **Ivi puede explicar cómo está construida Ivi y no puede decirte si el diploma da
   certificado** — y ese es exactamente lo que la vendedora va a preguntar.

---

*Fuentes: consultas read-only a `ivi_rag_pg` en geografo y lectura de `ivi-cerebro@main`
(`rag/ask.py`, `rag/buscar.py`, `rag/store.py`, `rag/config.py`, `rag/embedder.py`). El estado de
geografo y la mudanza a Bedrock: [`plan-flux-studio-catalogo.md`](plan-flux-studio-catalogo.md) §FX-2.
El contrato Hermes↔Ivi: ADR 0021 y 0024 de este repo.*
