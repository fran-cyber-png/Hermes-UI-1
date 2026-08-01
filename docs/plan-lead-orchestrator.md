# Lead Orchestrator — Plan de evolución definitivo

> **Fecha**: 30-jul-2026 · **Estado**: aprobado por arquitectura · **Versión**: 1.0
> **Sintetiza**: 4 subagentes de análisis (patrones, frameworks, arquitectura, roadmap).
> **Orquestador**: Claude Code coordinando 4 subagentes paralelos.

> Esto **reemplaza** la sección "Arquitectura objetivo" de `docs/arquitectura-bot-comercial.md`
> como visión técnica definitiva. No reemplaza ADR 0028 ni el plan T0-T13 — los detalles tácticos
> de esta semana viven allá. Este documento es el POR QUÉ, el QUÉ y el CUÁNDO del largo plazo.

---

## Resumen ejecutivo

El bot de Hermes **no debe ser un chatbot**. Debe ser un **Lead Orchestrator**: un motor
determinista que califica, enruta y enriquece leads, con un LLM actuando exclusivamente como
generador de lenguaje natural.

El pipeline objetivo:

```
WhatsApp → Normalizer → [Scoring + State Machine + Context + Retrieval + Tools] → LLM Writer → Guardrails → Audit → CRM
```

**30.5 horas de implementación en 6 fases incrementales**, cada una desplegable a producción por
sí misma. Ninguna requiere rehacer lo anterior. Al final de la Fase 5, el dueño tiene datos
objetivos para decidir si prender el modo automático.

---

## 1. Lo que está bien (no se toca)

| Componente | Archivo | Por qué |
|---|---|---|
| Guardrails de salida | `guardrails.ts` | 1.033 líneas, 3 red teams, 0 FP / 0 FN. Es el activo más valioso |
| Decisión | `decision.ts` | Puro, determinista, 9 motivos con orden fijo testeado |
| Chunker | `chunker.ts` | Puro, 40 líneas, funciona |
| Tools declarativas | `tools.ts` | Acumulan Acciones, no ejecutan efectos. Patrón correcto |
| Seam del cliente LLM | `agente.ts` | `crearAgente({ cliente })` — inyectable para tests |
| Prompt caching | `agente.ts:82-90` | Ephemeral cache en primera iteración |
| Config | `config.ts` | Lazy, degrada ruidoso, imprime resumen al arrancar |
| Webhook thin | `webhook/whatsapp.ts` | Fast-ack 200, guarda crudo, notifica al despachador |
| Línea separada | Cloud API para bot, whatsmeow para vendedoras | Bulkhead pattern |

---

## 2. Los 9 problemas encontrados (con evidencia en código)

### P1. Contexto de contacto vacío — `despachador.ts:113`
`armarContextoContacto({})` — siempre objeto vacío. El bot no sabe quién escribe.
**P0. Se arregla en Fase 2.**

### P2. Sin máquina de estados — `prompt.ts:53-78`
El flujo conversacional vive en texto del prompt, no en código. Sin tracking de fase.
**P1. Se arregla en Fase 1.**

### P3. Código spike conviviendo — `responder.ts:1-110`
Tiene su propio prompt, su propio cliente Bedrock, su propio loop. No se importa desde ningún lado.
**P0. Se elimina en Fase 0.**

### P4. Sin guardrails de entrada — `agente.ts:62-66`
El mensaje del lead entra crudo al prompt. Sin defensa contra jailbreak.
**P1. Se arregla en Fase 1.**

### P5. Familias hardcodeadas — `tools.ts:3-17`
`FAMILIAS_CONOCIDAS` es un Set de 14 strings. Si Cerberus agrega un curso, el bot no lo reconoce.
**P2. Se arregla en Fase 2.**

### P6. Tools siempre disponibles — `tools.ts:36-42`
El LLM puede llamar `escalar_a_vendedora` en el primer mensaje. Sin restricción por fase.
**P2. Se arregla en Fase 3.**

### P7. Calificación delegada al LLM — `tools.ts:92-128`
El LLM decide si un lead es `caliente` sin acceso a datos objetivos.
**P1. Se arregla en Fase 4.**

### P8. Acoplamiento en el despachador — `despachador.ts:76-230`
`procesarClaim()` hace 7+ cosas en 150 líneas. Sin separación de pasos.
**P1. Se arregla en Fase 1.**

### P9. Sin observabilidad — `despachador.ts:29`
`console.error` sin estructura. Sin correlación IDs. Sin métricas.
**P1. Se arregla en Fase 5.**

---

## 3. Patrones de la industria aplicados a Hermes

### Patrones que YA implementa (total o parcialmente)

| Patrón | Fuente | Estado |
|---|---|---|
| Tools como definiciones declarativas | Anthropic SDK | ✅ `tools.ts` |
| Prompt caching con ephemeral | Anthropic SDK | ✅ `agente.ts:82` |
| Output guardrails | OpenAI Agents | ✅ `guardrails.ts` |
| Tool accumulation (no side effects) | OpenAI Agents | ✅ `acciones.ts` |
| Seam injection | Pydantic AI | ✅ `agente.ts` |
| Webhook thin | Event-driven | ✅ `webhook/whatsapp.ts` |
| Canales separados | Bulkhead | ✅ Cloud API vs whatsmeow |
| Tracking de tokens | Observability | ✅ `bot_respuestas` |

### Patrones a implementar (de los 12 encontrados)

| # | Patrón | Arquitectura actual | Arquitectura objetivo | Fase |
|---|---|---|---|---|
| 1 | **Qualification Engine** | El LLM califica vía tool | Scoring determinista con 5 dimensiones | Fase 4 |
| 2 | **Human Handoff 1st class** | `escalar` escribe en DB silenciosamente | Notificación WebSocket + cola visible | Fase 4 |
| 3 | **Lead State Machine** | Prompt contiene el flujo | Estados explícitos en `bot_estado_conversacion` | Fase 1 |
| 4 | **Context Builder** | `armarContextoContacto({})` vacío | Fuentes reales: Cerberus, intereses, señales, campaña | Fase 2 |
| 5 | **Deterministic First** | Parcial: `decision.ts` lo es, scoring no | Todo scoring y estado es determinista | Fase 4 |
| 6 | **Write to CRM** | `bot_calificaciones` aislada de intereses | Acciones del bot escriben en tablas del CRM | Fase 2 |
| 7 | **Event Pipeline** | Monolito `procesarClaim()` de 150 líneas | Pipeline con pasos independientes | Fase 1 |
| 8 | **Conversation ≠ Lead** | Solo existe `clave` de conversación | `bot_memoria_lead` con datos cross-conversación | Fase 2 |
| 9 | **Tool Registry** | Tools fijas, familias hardcodeadas | Tools por estado, validación contra `alias_curso` | Fase 3 |
| 10 | **Inbox First** | Respuestas guardadas sin revisión | UI de revisión sombra + endpoint de revisión | Fase 5 |
| 11 | **Multi-modal** | Solo texto | Transcripción de audio + descripción de imagen | Fase 6 |
| 12 | **Observability** | `console.log` suelto | Trazas JSON con correlación ID + métricas | Fase 5 |

### Comparación con frameworks

| Framework | Patrón extraído | Aplica YA | Complejidad |
|---|---|---|---|
| **LangGraph** | StateGraph con checkpoint en Postgres | State machine en `bot/estados.ts` | Media |
| **OpenAI Agents** | Handoffs tipados + guardrails | Escalada como handoff explícito | Baja |
| **Mastra** | Working memory + evals automáticos | `bot/memoria.ts` + `bot/evaluacion.ts` | Alta |
| **Chatwoot** | Bot como agente más en inbox | Ya existe — el bot participa en hilos | Baja |
| **Rasa** | NLU pipeline + slots | Clasificación de intención + campos del contexto | Media |
| **Pydantic AI** | Output tipado + DI + reintento | Tools con resultado estructurado + retry | Media |

---

## 4. Arquitectura objetivo

### Diagrama de componentes

```
                              ┌──────────────────────────┐
                              │   WhatsApp Cloud API      │
                              │   POST /webhook/whatsapp  │
                              └────────────┬─────────────┘
                                           │
                              ┌────────────▼─────────────┐
                              │   webhook/whatsapp.ts     │
                              │   (thin: ack + save)      │
                              └────────────┬─────────────┘
                                           │
                              ┌────────────▼─────────────┐
                              │   bot/ingesta.ts          │
                              │   upsert bot_pendientes   │
                              └────────────┬─────────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │               bot/orquestador.ts (setInterval 5s)       │
              │                                                         │
              │  1. CLAIM atómico                                        │
              │  2. NORMALIZAR mensaje (normalizador.ts) 🆕             │
              │  3. RECOLECTAR contexto (contexto.ts) 🔄               │
              │  4. LEER estado + memoria (estados.ts, memoria.ts) 🆕  │
              │  5. DECIDIR (decision.ts) ✅                            │
              │  6. VALIDAR entrada (guardrailsEntrada.ts) 🆕          │
              │  7. RECUPERAR conocimiento (recuperador.ts) 🆕         │
              │  8. CONSTRUIR prompt (prompt.ts) 🔄                    │
              │  9. FILTRAR tools por estado (tools.ts) 🔄             │
              │ 10. LLAMAR al agente (agente.ts) 🔄                    │
              │ 11. VALIDAR salida (guardrails.ts) ✅                   │
              │ 12. TRANSICIONAR estado (estados.ts) 🆕                │
              │ 13. SCORING determinista (scoring.ts) 🆕               │
              │ 14. ENVIAR (si modo automático)                         │
              │ 15. EJECUTAR acciones + handoff                         │
              │ 16. AUDITAR traza (auditoria.ts) 🆕                    │
              └─────────────────────────────────────────────────────────┘

  ✅ = no se toca · 🔄 = se modifica · 🆕 = nuevo
```

### Tabla de archivos

| Acción | Archivo | Fase |
|---|---|---|
| **CREAR** | `server/src/bot/estados.ts` | Fase 1 |
| **CREAR** | `server/src/bot/guardrailsEntrada.ts` | Fase 1 |
| **CREAR** | `server/src/bot/orquestador.ts` | Fase 1 |
| **AMPLIAR** | `server/src/bot/contexto.ts` | Fase 2 |
| **CREAR** | `server/src/bot/memoria.ts` | Fase 2 |
| **CREAR** | `server/src/bot/recuperador.ts` | Fase 3 |
| **CREAR** | `server/src/bot/planner.ts` | Fase 3 |
| **CREAR** | `server/src/bot/precondiciones.ts` | Fase 3 |
| **CREAR** | `server/src/bot/scoring.ts` | Fase 4 |
| **CREAR** | `server/src/bot/handoff.ts` | Fase 4 |
| **CREAR** | `server/src/bot/observabilidad.ts` | Fase 5 |
| **CREAR** | `server/src/bot/metricas.ts` | Fase 5 |
| **CREAR** | `server/src/bot/evaluacion.ts` | Fase 6 |
| **CREAR** | `server/src/bot/procesarMedia.ts` | Fase 6 |
| **CREAR** | `server/src/bot/auditoria.ts` | Fase 5 |
| **CREAR** | `server/src/routes/bot.ts` | Fase 5 |
| **SIMPLIFICAR** | `server/src/bot/agente.ts` | Fase 1-3 |
| **MODIFICAR** | `server/src/bot/tools.ts` | Fase 2-4 |
| **MODIFICAR** | `server/src/bot/despachador.ts` | Fase 1 |
| **MODIFICAR** | `server/src/bot/prompt.ts` | Fase 1-2 |
| **ELIMINAR** | `server/src/bot/responder.ts` | Fase 0 |

### Principios de diseño

1. **Deterministic First**: `decision.ts`, `estados.ts`, `scoring.ts`, `guardrails.ts`, `recuperador.ts`, `guardrailsEntrada.ts` son puros. Sin DB, sin red. Testeables en milisegundos.
2. **El LLM escribe, no decide**: scoring, handoff, estado y disponibilidad de tools son deterministas. El LLM elige qué tool llamar y genera el texto.
3. **Estado explícito**: `bot_estado_conversacion` persiste la fase. Se puede preguntar «¿cuántas conversaciones están en `cotizando`?» sin parsear prompts.
4. **Separación**: cada paso del pipeline es una función con una responsabilidad. El orquestador las compone.
5. **Seams inyectables**: DB, HTTP, reloj y cliente LLM entran por parámetro.
6. **Degradación ruidosa**: si Cerberus falla, el bot sigue sin nombre (y lo avisa). Nunca un fallo parcial tumba el pipeline.

---

## 5. Roadmap

### Fase 0 — HOY (1.5h): Credenciales + limpiar spike

**Objetivo**: el bot no se muere a los 60 minutos.

| Qué | Dónde |
|---|---|
| IAM user permanente `hermes-bot-bedrock` | AWS cuenta 177914733251 |
| Token permanente Cloud API | Meta Business App |
| Eliminar `responder.ts` | archivar con ADR 0033 |
| Cargar `BOT_LINEAS=51984429504`, `BOT_MODO=sombra` | `.env` en VPS1 + staging |

**Verificación**: `journalctl` muestra respuestas en sombra ≥2h después del deploy.

---

### Fase 1 — JUEVES (6h): State Machine + Input Guardrails

**Objetivo**: el bot sabe en qué fase está cada conversación.

**Componentes nuevos**:
- `bot/estados.ts` — 10 estados, transiciones deterministas
- `bot/guardrailsEntrada.ts` — jailbreak, intención, sanitización
- `bot/orquestador.ts` — pipeline de 16 pasos (reemplaza el cuerpo de `despachador.ts`)

**Migración**: `bot_estado_conversacion(clave PK, estado, datos JSONB, ...)`

**Riesgo**: Medio. Mitigación: `decision.ts`, `guardrails.ts`, `agente.ts` no se tocan.

---

### Fase 2 — VIERNES (5h): Contexto real + Lead Memory

**Objetivo**: el bot conoce al lead (nombre, interés, señales, procedencia).

**Componentes nuevos**:
- `bot/contexto.ts` — consulta Cerberus, intereses, señales, alias_curso (timeout 5s, degrada)
- `bot/memoria.ts` — extrae y persiste hechos (nombre, país, curso)

**Fix**: `FAMILIAS_CONOCIDAS` → validar contra `alias_curso` (tabla existente)

**Migración**: `bot_memoria_lead(clave PK, hechos JSONB, ...)`

---

### Fase 3 — SÁBADO (3h): Tool Planner + Precondiciones

**Objetivo**: cada tool solo está disponible en la fase correcta.

**Componentes nuevos**:
- `bot/planner.ts` — `toolsParaFase(fase) → Set<string>`
- `bot/precondiciones.ts` — valida acciones antes de ejecutar (no duplicar interés, no rebajar calificación, no escalar dos veces)
- `bot/recuperador.ts` — filtra piezas y hechos por relevancia para este turno

**Sin migración**.

---

### Fase 4 — DOMINGO/LUNES (4h): Qualification Engine

**Objetivo**: scoring determinista de leads + handoff automático.

**Componentes nuevos**:
- `bot/scoring.ts` — 5 dimensiones con pesos: engagement (20%), intención (35%), señales (25%), urgencia (10%), fit (10%)
- `bot/handoff.ts` — score ≥ 80 → handoff inmediato. 60-79 → sugerencia. <60 → sigue el bot

**Cambio crítico**: la tool `calificar` se retira del LLM. El scoring es determinista.

**Migración**: columnas `score`, `handoff_prioridad`, `factores` en `bot_calificaciones`.

---

### Fase 5 — MARTES (5h): Observabilidad + Auditoría

**Objetivo**: cada decisión del bot es trazable con métricas en tiempo real.

**Componentes nuevos**:
- `bot/observabilidad.ts` — `traza_id` end-to-end, pasos del pipeline
- `bot/metricas.ts` — latencia p50/p95/p99, tasa de guardrail, costo, contadores por motivo
- `bot/auditoria.ts` — `TrazaAuditoria` completa por turno
- `routes/bot.ts` — `GET /api/bot/metricas`, `GET /api/bot/traza/:id`
- UI mínima: chip en cabecera con estado del bot

**Migración**: `bot_trazas`, `bot_metricas`, columnas `traza_id` en tablas existentes.

---

### Fase 6 — MIÉRCOLES+ (6h): Evaluación + Multi-modal

**Objetivo**: el bot se evalúa automáticamente y procesa audio/imágenes.

**Componentes nuevos**:
- `bot/evaluacion.ts` — juez automático (claude-sonnet), 5 criterios
- `bot/simulacro.ts` — 20 escenarios canónicos con rúbricas
- `bot/procesarMedia.ts` — transcripción de audio, descripción de imagen

**Migración**: columna `revision_detalle JSONB` en `bot_respuestas`.

---

### Total: 30.5 horas

No incluye: follow-ups (T7 del plan original), multi-proveedor LLM, budget guard,
canales adicionales, semantic memory, ni A/B de prompts. Todo eso es post-MVP.

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Guardrail de salida deja pasar precio en automático | Baja | Alto | Triple capa: prompt + `RE_MONTO` + capa léxica. Modo sombra 3+ días |
| El bot conversa mal y pierde leads | Media | Alto | Modo sombra exhaustivo. Evals automáticos. Handoff temprano a humano |
| Cerberus no responde y el bot se cuelga | Media | Medio | Timeout 5s por fuente. Degrada (sin nombre), no se cae |
| Bedrock se cae | Baja | Alto | `desconectado` en decision. Sin failover a otro proveedor (post-MVP) |
| Cloud API banea el número del bot | Baja | Crítico | Topes de 60/hora. Ritmo humano. Una sola línea en automático |
| El dueño cambia la regla de identidad | Baja | Alto | La regla vive en un solo lugar (prompt + guardrails) |
| Migración de schema falla en prod | Baja | Bajo | Migraciones versionadas. Rollback automático en deploy |

---

## 7. Métricas de éxito (desde Fase 5)

| Métrica | Umbral de alarma |
|---|---|
| Tasa de guardrail (salida) | > 5% |
| Tasa de guardrail (entrada) | > 10% |
| Tasa de handoff | > 40% (demasiadas derivaciones) |
| Latencia p95 | > 45s |
| Tasa de error del pipeline | > 2% |
| Costo diario Bedrock | > $5 |
| Score promedio de evals | < 3.0/5 |
| Spam reportado por leads | > 0.1% |

---

## 8. Trade-offs documentados

### 8.1 Deterministic First vs. LLM-centric

**Decisión**: scoring, estado y handoff son deterministas. El LLM solo genera texto.

**Costo**: más código TypeScript que mantener. Menos flexibilidad (cambiar un criterio de scoring
requiere deploy, no editar un prompt).

**Beneficio**: decisiones auditables, reproducibles y medibles. Sin alucinaciones de scoring. Sin
variación entre llamadas.

### 8.2 State machine explícita vs. prompt-only

**Decisión**: `bot_estado_conversacion` persiste la fase.

**Costo**: una tabla más que mantener. Lógica de transiciones que puede tener bugs.

**Beneficio**: observabilidad («¿cuántas conversaciones están en cotizando?»). Determinismo
(la máquina decide la fase, no el LLM). Recuperación tras reinicio.

### 8.3 Un solo agente vs. múltiples agentes

**Decisión**: un agente con prompt + tools, por ahora.

**Costo**: el prompt crece con cada feature nueva.

**Beneficio**: KISS. Sin orquestación multi-agente. Sin handoffs entre modelos.

**Reevaluar**: cuando el volumen supere 1.000 conversaciones/día o el system prompt exceda
8.000 tokens.

### 8.4 Anthropic SDK nativo vs. Vercel AI SDK

**Decisión**: SDK nativo para MVP y mediano plazo.

**Costo**: lock-in a Anthropic/Bedrock.

**Beneficio**: sin dependencia extra. Tool calling directo. Sin abstracción con fugas.

**Reevaluar**: cuando se necesite failover a otro proveedor o streaming de respuestas.

---

## 9. Lo que deliberadamente queda fuera

- **Multi-proveedor LLM** — hasta que los datos muestren que Bedrock es el cuello de botella
- **Budget guard automático** — hasta que el costo diario supere $5
- **Follow-ups automáticos** — T7 del plan original. Primero que el bot converse bien, después
  que inicie conversaciones
- **Canales adicionales (IG, Messenger)** — WhatsApp Cloud API cubre >95% del tráfico hoy
- **Semantic memory / vector DB** — Ivi ya es el servicio de conocimiento. Dos índices divergen
- **A/B de prompts** — sin volumen suficiente, elegir prompt es una corazonada
- **Streaming de respuestas** — las respuestas son <300 chars. El streaming no agrega valor
  perceptible
- **Panel de administración separado** — Hermes YA es un CRM completo con app de escritorio

---

## 10. Decisiones justificadas

### D1: El bot es un módulo del monolito, no un microservicio

**Patrón**: Modular Monolith. **Alternativa**: microservicio independiente. **Por qué no**:
Hermes ya tiene event store, transporte, catálogo, señales y auth. Un servicio aparte duplicaría
la mitad de la lógica de negocio. **Principio**: DRY, KISS.

### D2: La línea del bot es Cloud API, las vendedoras usan whatsmeow

**Patrón**: Bulkhead. **Alternativa**: todo por whatsmeow. **Por qué no**: si Meta banea
whatsmeow, banea a las tres vendedoras. Cloud API es el canal oficial. **Principio**: Fault
Isolation.

### D3: Las tools acumulan Acciones, no ejecutan efectos

**Patrón**: Command-Query Separation. **Alternativa**: tools ejecutan efectos directos.
**Por qué no**: side effects duplicados si el LLM llama la misma tool dos veces. Imposibilidad
de testear sin infraestructura real. **Principio**: Testability.

### D4: El modo sombra es obligatorio antes del automático

**Patrón**: Dark Launch. **Alternativa**: prender automático directo. **Por qué no**: es
imposible calibrar guardrails y prompt sin ver qué responde el bot a tráfico real.
**Principio**: Measure twice, cut once.

### D5: El scoring es determinista, el LLM no califica

**Patrón**: Deterministic First. **Alternativa**: el LLM califica vía tool. **Por qué no**:
el LLM no tiene acceso a todas las señales (historial de compras, cliente VIP). Su criterio
varía entre llamadas. Un score determinista es auditable, reproducible y más barato (0 tokens).
**Principio**: Explicit over Implicit.
