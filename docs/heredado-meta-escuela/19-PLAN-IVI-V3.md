# Plan Ivi v3 — el motor piensa más, la respuesta llega ya servida

> Sesión 2026-07-16. Continúa de docs/17 (mapa del pipeline), docs/18 (diagnóstico
> y fix de prod) y el benchmark Gemini de esta misma sesión. Este es el plan
> maestro para ejecutar por fases en sesiones siguientes — cada fase se aprueba,
> se implementa con tests, se commitea a main y la activa el operador.

## La decisión de arquitectura, en una frase

**La inferencia corre en background cuando cambian los DATOS (no por evento — no
hay eventos, es batch), y las preguntas frecuentes se sirven ya calculadas; la
calidad sube engordando el motor determinista (paradas 7-8), no metiendo una IA
en el camino de los hechos.**

Por qué NO el árbol de resúmenes incrementales (la idea original, evaluada y
descartada con mediciones de hoy):

1. **No hay nada que recuperar**: TODO el dato crudo de Cerberus+Meta son
   142.374 chars ≈ 35,6K tokens — el 3,56% del contexto de un modelo moderno.
   RAG resuelve corpus que no entran en contexto; este entra 28 veces.
2. **No hay stream**: el dato llega por dump SQL + webhook con días de rezago
   (hoy: frescura 2026-07-11, 5 días). No hay "movimientos" a los que engancharse.
3. **El pasado muta**: vouchers confirmados tarde (p90 3,9 días) + backfill de
   Meta de 37 meses ⇒ resúmenes incrementales quedarían viejos EN SILENCIO —
   exactamente la clase de bug que matamos hoy (docs/18 §1).
4. **Gemini medido, no asumido**: 23,3s vs 26,8s local (13% mejor), con 503
   "high demand" bajo ráfaga y 429 de cuota en 2.0-flash. La prosa dice lo
   mismo que la local porque el contenido lo decide el pipeline. No compensa
   mandar el P&L afuera por 3 segundos.

## Línea base medida (2026-07-16, prod geógrafo)

| Métrica | Hoy |
|---|---|
| 1 request | 26,8s (collect **0,2s** / ollama **26,6s**) |
| 5 concurrentes | 62–97s, todas OK (post-fix docs/18) |
| Hipótesis generadas (pregunta ancla) | **0** |
| Acciones generadas | **1, genérica** ("profundizar en el segmento con mejor momentum") |
| Prompt vs dato disponible | 7.785 chars = **8%** del dato pedido (descarta el 92%) |
| Contexto del modelo | corre a 8.192 tok; `qwen3:8b` soporta **40.960** (`ollama show`) |
| Caché | solo endpoints (60s TTL, `cache.py`) — cachea los 0,2s, regenera los 26,6s |
| Sesiones | dict global sin lock; el front no manda `session` → todos son `"default"` |
| Proceso | `nohup` sin systemd — no sobrevive un reboot |
| VRAM | 7,8 / 16,4 GB (4 slots) |

## Principios (lo que NO cambia)

- Ningún cálculo de negocio en el modelo: las paradas 2-9 siguen siendo Python
  determinista y testeado. El modelo solo redacta.
- Cifras siempre etiquetadas HECHO / ESTIMACIÓN / SIN EVIDENCIA.
- Gemini **no entra** (P5 queda como opción documentada, apagada, solo si P4
  muestra techo local). Nada del P&L sale de la casa sin decisión humana.
- Deploys a geógrafo los activa el operador (`deploy-ivi-geografo.sh`).
- Trunk-based: commits directos a main, cada fase un corte deployable.
- Tests sin pytest (no está instalado): funciones `test_*` planas + runner
  ad-hoc con importlib (el mismo que corrió los 39 de hoy).

---

## P0 — Fundaciones (½ día)

Lo que el trabajo de hoy dejó más expuesto. Sin esto, P1-P2 amplifican bugs.

**P0.1 — `_SESSIONS` thread-safe** (`ivi/memory.py`)
- `threading.RLock()` de módulo guardando `get_session` / `remember` /
  `is_followup` / `apply_followup_filters`. Con `NUM_PARALLEL=4` ahora hay 4
  requests reales mutando el mismo dict.

**P0.2 — sesión real por navegador** (`ivi/server.py`, JS embebido)
- `const SID = localStorage.sid ||= crypto.randomUUID()` y mandarlo en el body.
  Hoy todas las conversaciones comparten `sid="default"`: los follow-ups de dos
  personas se mezclan.

**P0.3 — systemd en vez de nohup** (`deploy/ivi.service` + paso nuevo del deploy)
- Unidad system-level: `User=geografo`, `WorkingDirectory=~/ia-local`,
  `ExecStart=/usr/bin/python3 -u -m ivi.server`, `Restart=on-failure`,
  `After=network-online.target ollama.service`,
  `StandardOutput=append:/home/geografo/ia-local/ivi-server.log` (conserva la
  ruta de log conocida). El deploy la instala con sudo (mismo patrón que
  `tuning.conf`).

**P0.4 — `/api/health`** (`ivi/server.py`)
- GET → `{ok, model, inflight, frescura, cache:{entries,hits,misses}, uptime_s}`.
  Da un probe a monitoreo y hace observables P1-P2.

**Tests**: `test_memoria_concurrente.py` (N threads martillando `remember`,
history acotada, sin excepciones).
**Hecho cuando**: tests verdes; `kill -9` al proceso en geógrafo → systemd lo
revive solo (evidencia: pid nuevo + log); el log muestra `sid=` distintos desde
dos navegadores.

---

## P1 — Caché de respuestas por huella de datos (1 día)

La idea "ya servido" del usuario, en su forma correcta. La respuesta es una
**función pura de (pregunta, datos)**; si nada cambió, no se regenera.

**Diseño** (`ivi/answer_cache.py`, nuevo):
- **Clave = `sha256(prompt)`**. El prompt ya es el colapso puro de TODO lo que
  importa (pregunta literal, intents, período, scope de follow-up, frescura y
  cada número servido). Si el prompt es byte-idéntico, la respuesta es
  semánticamente idéntica → se sirve la cacheada.
- **Invalidación por construcción, sin TTL**: cambia un dato → cambia el prompt
  → cambia el hash → regenera. Cambia el motor (P3/P4 tocan el texto del
  prompt) → invalida solo. Cero riesgo de servir viejo — la lección de hoy.
- **Single-flight**: dos preguntas idénticas concurrentes = UNA llamada a
  Ollama; la segunda espera el resultado de la primera (Event por clave, con
  timeout `OLLAMA_TIMEOUT+30`).
- **LRU acotada** (~200 entradas) + **persistencia** a
  `ia-local/answers-cache.json` (tmp + `os.replace`, se carga al arrancar):
  con systemd reviviendo el proceso, la calidez sobrevive reinicios.
- Integración en `_handle_chat`: después de `build(...)`, hit → servir y
  loguear `cache=hit age=…`; miss → generar, guardar, `cache=miss`. La
  respuesta gana el campo `"cache": {"hit": bool, "creado": iso}` (el front
  ignora campos desconocidos; UI se toca después si se quiere).
- `remember()` sigue corriendo por request (la memoria conversacional es
  independiente del caché). El `scope_note` de follow-ups entra al prompt →
  los follow-ups cachean por contexto propio, correcto automáticamente.
- Nota asumida: temperatura 0,3 ⇒ dos corridas del mismo prompt difieren en
  fraseo; el caché sirve la primera. Cualquiera de las dos era válida.
- Limitación honesta v1: la clave incluye la pregunta LITERAL. "ventas de este
  mes" y "¿cómo vamos en ventas este mes?" son dos entradas. Para los 12
  botones fijos da igual; paráfrasis orgánicas pagan los ~27s una vez.

**Tests** (`test_answer_cache.py`, con `call_ollama` stubbeado — sin red):
segunda llamada idéntica NO invoca el stub; prompt distinto → miss;
single-flight con 2 threads → 1 invocación; round-trip a disco; tope LRU.

**Hecho cuando**: mismo POST dos veces → segunda <1s con `cache.hit=true` en
el JSON y `cache=hit` en el log.

---

## P2 — Warmer: las 12 sugerencias precalculadas en background (½ día)

Esto ES la "inferencia en background": cuando aterriza un dump nuevo de
Cerberus, Ivi re-piensa las preguntas frecuentes SOLO, antes de que nadie
pregunte.

**Diseño** (`ivi/warmer.py`, nuevo):
- La lista `SUG` de 12 preguntas se muda del HTML a
  `config.PREGUNTAS_SUGERIDAS` (fuente única: la UI la renderiza por inyección
  y el warmer la recorre).
- Thread daemon lanzado en `main()`: cada `WARM_INTERVAL=600s` arma el prompt
  de cada pregunta por el camino puro (analyze→plan→collect→…→build, **sin
  sesión, sin `remember()`** — no contamina memoria conversacional) y, si el
  hash no está en caché, genera. `collect()` cuesta 0,2s y ya tiene TTL 60s →
  el poll es gratis.
- Dump nuevo → frescura/números cambian → los 12 hashes cambian → regenera
  todo: ~12 × 27s ≈ **5,5 min de GPU una vez cada varios días**. De a una, con
  pausa entre generaciones — quedan 3 slots libres para usuarios en vivo.
- Warm inicial al arrancar (tras ~10s): también reemplaza el rol del
  `KEEP_ALIVE` — el modelo queda cargado porque se usa.
- Ollama caído → `OllamaError` → warning y reintento al próximo tick.

**Hecho cuando**: tras el deploy, el log muestra `warm ok 12/12`; los 12
botones de la UI responden <1s (`curl -w %{time_total}` a cada una);
`/api/health` muestra ≥12 entradas. **Este es el corte con el que "hablar con
Ivi" pasa a sentirse instantáneo.**

---

## P3 — El motor piensa: hipótesis y acciones reales (1½–2 días) ← el grueso

El techo de calidad medido hoy: 0 hipótesis, 1 acción genérica, y el modelo no
puede narrar causas que nadie generó. Todo lo nuevo es **Python determinista
con tests** — cero IA en el camino de los hechos.

**P3.0 — Inventario de cortes (1h, sin código)**
Volcar las formas reales de `overview` / `comercial` / `atribucion` / `cartera`
y decidir qué detectores son posibles HOY vs cuáles necesitan que el backend
sirva un corte nuevo. Supuesto a verificar: la serie mensual expone solo 12
meses (2025-08…2026-07) ⇒ **no hay YoY de julio** sin extender
`server/src/analisis/comercial.ts` a 24 meses (cambio lado Mac, sin operador).

**P3.A — Detectores de hipótesis** (`ivi/insight_engine.py`)
Cada uno: función pura sobre KPIs/Analysis, con confianza + evidencia citada.
- **H1 pauta→ventas** (la causa del +28,1%): cruza Δ ventas mensual con Δ
  gasto/ROAS por país (`atribucion.roasPais` — 30K chars que hoy se descartan).
  Ventas ↑ con gasto ↑ proporcional → "crecimiento comprado, CAC estable";
  ventas ↑ con gasto plano → "mejora orgánica/eficiencia".
- **H2 mix-shift**: movimiento del ticket promedio + participación por producto
  ventana actual vs previa (¿el alza es Manual caro o Certificados baratos?).
- **H3 estacionalidad**: YoY cuando la serie lo permita (depende de P3.0).
- **H4 concentración**: top producto ≥30% del volumen (hoy: Manual = 32%) →
  riesgo de dependencia con umbral.
- **H5 canal**: shift facebook/instagram accionable vs ventana previa; si no
  hay histórico de canales, decir "sin evidencia" — nunca inventar.

**P3.B — Acciones ligadas a señales** (`ivi/recommendation_engine.py`)
- Regla dura: **toda acción cita el insight que la dispara** (id) + owner +
  impacto tomado de `impact_engine` (nunca cifras propias). Ej.: backlog CAPI
  273 ventas → "encender envío del backlog" [Tesorería/Dev, USD 21.111 en
  juego]; Instagram 44,6% → acción Growth con el gap.
- Se elimina la acción genérica de fallback: sin señales → "sin acciones
  críticas; lo que está funcionando: X" (honesto, como el forecast con R² bajo).

**P3.C — `prompt_builder`**: la sección `-- HIPÓTESIS --` deja de estar vacía;
`-- ACCIONES --` lleva rationale e impacto del motor.

**Tests**: por detector, KPIs sintéticos que lo disparan Y que no lo disparan
(tests de honestidad, patrón de `test_forecast_honesto.py`); e2e con fixture
grabado del backend de hoy: la pregunta ancla debe producir **≥2 hipótesis con
cifras y ≥2 acciones no genéricas**.

---

## P4 — Des-resumir con cabeza (1 día)

El descarte del 92% era una necesidad de la ventana de 8K. `qwen3:8b` soporta
40.960 — el techo era autoimpuesto.

- `OLLAMA_CTX` 8.192 → **16.384** (config + `Modelfile.ventas` coherente; el
  deploy ya hace `ollama create`). VRAM estimada: KV por slot ~×2 (~1,2 GB) →
  5,7 + 4×1,2 ≈ **10,5 GB de 16** — entra; el paso 8 del deploy lo mide como hoy.
- `prompt_builder` modo extendido (~≤20K chars ≈ 9K tok): serie 24 meses (si
  P3.0 lo habilitó), semanal 16, top-10 + "resto", **tabla por país con ventas
  + USD + ROAS + CAC** (cruza comercial+atribución — el corte que hoy nunca
  llega al modelo), histograma de latencia de tesorería.
- **Harness de fidelidad numérica** (nuevo, modo warn): script de smoke que
  extrae los números de la respuesta y verifica que cada uno exista en el
  prompt (normalizando separadores). Alucinación numérica → warning en el
  deploy; se endurece a fail cuando esté calibrado.
- **Gate humano**: 5 preguntas doradas antes/después — si la narrativa no
  mejora, se revierte (barato: es solo `prompt_builder`). Guard de latencia:
  1 request ≤35s.

---

## P5 — Gemini como lane opcional (NO se implementa ahora)

Solo si P4 muestra techo local real. Quedaría como `LLM_BACKEND=ollama|gemini`
con fallback automático al local. Datos auditados: los prompts de 5 preguntas
tipo no llevan PII (verificado hoy); la key existe en `server/.env` (plan pago)
y se referencia por nombre. Hasta entonces: **costo cero, cero código**.

---

## Secuencia y cortes de deploy

| Corte | Fases | Qué siente el usuario |
|---|---|---|
| 1 | P0 + P1 + P2 (~2 días) | Ivi instantáneo en las 12 frecuentes y en repetidas; sobrevive reboots; sesiones separadas |
| 2 | P3 (~2 días) | La respuesta explica POR QUÉ y dice QUÉ HACER con cifras |
| 3 | P4 (~1 día) | La narrativa nota detalles (país×ROAS, mix) que hoy ni ve |

El orden importa: P1/P2 primero hace que el costo de latencia de P3/P4 (prompts
más ricos = generación algo más lenta) sea irrelevante — las frecuentes salen
de caché igual. Y cada cambio de motor invalida el caché solo (la clave es el
prompt), así que no hay coordinación manual entre fases.

## Riesgos y supuestos a verificar

- **P3.0 puede achicar P3.A**: si los payloads no traen cortes por ventana
  (mix previo, canales históricos), H2/H5 necesitan primero un cambio chico en
  el backend meta-escuela (lado Mac, sin operador, tests con `npm test`).
- **Serie de 12 meses**: sin extenderla no hay YoY (H3 parcial).
- **VRAM en P4**: la cuenta da 10,5/16 GB, pero se mide en el deploy (hoy la
  predicción 7,5 dio 7,8 — el método funciona).
- **Paráfrasis no cachean** (v1): aceptado; si duele, v2 con clave semántica
  (intents+período+huella de datos) — decisión aparte porque cambia la
  semántica del fraseo.

## Fuera de alcance (explícito)

- Árbol de resúmenes incrementales / RAG / vector store — descartado con datos
  (arriba).
- Gemini como motor primario — descartado con benchmark.
- voz-ivi / Apolo — apagado, fuera de foco (docs/18 §5).
- Streaming de tokens en la UI, multi-turno largo, systemd para el backend del
  Mac — otro día.
