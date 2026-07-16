# Ivi — Análisis y Plan de Mejora

> Documento de trabajo para analizar el estado actual de **Ivi** (asistente de ventas de Goberna)
> y definir un roadmap concreto para volverlo útil en **análisis de ventas**.
>
> Fecha: 2026-07-15 · Objetivo: primer dominio "ventas" útil, entrenado local (RTX A4000) + datos vivos.

---

## 1. Qué es Ivi hoy

Ivi es un asistente conversacional de ventas para Goberna, corriendo **localmente** en la PC "geógrafo"
(RTX A4000 16GB, CachyOS/Arch). Está montado sobre **Ollama** con el modelo `ivi-ventas`, cuyo
conocimiento de dominio proviene de **12 CQs de ventas** inyectadas como `SYSTEM` prompt.

| Componente | Estado | Detalle |
|---|---|---|
| Modelo base | ✅ | Qwen3-8B (4-bit) |
| `ivi-ventas` (Ollama) | ✅ | FROM qwen3:8b + 12 CQs como SYSTEM, temp 0.3, ctx 4096 |
| Chat web | ⚠️ | `chat_ivi.py` (stdlib, :8080). Reescrito con datos vivos, arranque inestable |
| LoRA real | ❌ | No entrenado (conflictos unsloth/torch/torchao/peft) |
| Datos vivos | 🟡 | Backend accesible por Tailscale, integración en el chat sin verificar |

### Acceso
- Chat: `http://100.117.204.80:8080` (Tailscale) o `http://192.168.18.80:8080` (LAN)
- Ollama: `localhost:11434` en geógrafo
- Backend meta-escuela: corre en **Mac** (`localhost:4100` / Tailscale `100.98.60.92:4100`)

---

## 2. Fuente de conocimiento: CQs de ventas

12 Competency Questions en `goberna-kos/cqs/catalog.json` (IDs `cq-ventas-001..012`).

**Por complejidad:** 7 simple · 5 moderate
**Por tipo:** definition (1), enumeration (2), relation (2), constraint (2), aggregation (2), procedure (3)

| ID | Tipo | Pregunta |
|---|---|---|
| cq-ventas-001 | definition | ¿Qué es una venta en Cerberus? |
| cq-ventas-002 | enumeration | ¿Cuáles son los 7 estados posibles de una venta? |
| cq-ventas-003 | enumeration | ¿Qué medios de venta existen? |
| cq-ventas-004 | relation | ¿Cómo se relaciona una Venta con un Cliente? |
| cq-ventas-005 | relation | ¿Cómo se relaciona una Venta con sus Cuotas? |
| cq-ventas-006 | constraint | ¿Cuándo una venta se considera pagada? |
| cq-ventas-007 | aggregation | ¿Cuántas ventas tiene Goberna en total? |
| cq-ventas-008 | aggregation | ¿Cuál es el monto total de ventas pagadas? |
| cq-ventas-009 | procedure | ¿Cómo se crea una venta nueva? |
| cq-ventas-010 | procedure | ¿Cómo se anula una venta? |
| cq-ventas-011 | constraint | ¿Qué validaciones se aplican al crear una venta? |
| cq-ventas-012 | relation | ¿Qué regla conecta ventas con matrículas? |

### Limitación clave de las CQs
Las CQs **007 y 008** (agregaciones) tienen respuestas **estáticas** en el dataset
(ej. "5.134 ventas, 4.729 pagadas"). Cuando el negocio cambia, Ivi queda **desactualizado**.
Para análisis real, estas preguntas deben resolverse contra **datos vivos**, no contra el prompt.

---

## 3. El problema central para "análisis"

Ivi hoy **sabe conceptos** (qué es una venta, estados, procedimientos) pero **no sabe números actuales**.
Un asistente de análisis necesita responder cosas como:

- "¿Cómo vamos esta semana vs la anterior?"
- "¿Qué canal está trayendo más ventas?"
- "¿Cuántas ventas se están perdiendo por fuera de la ventana de reporte a Meta?"
- "¿Cuál es la tendencia de ventas cerradas por día?"

Esto **no se resuelve con LoRA ni con el system prompt**: requiere **datos en vivo** + capacidad de
razonar sobre ellos. El LoRA sirve para el **tono, formato y conocimiento estable del dominio**;
los datos vivos vienen del backend.

---

## 4. Datos vivos disponibles (backend meta-escuela)

El backend en el Mac ya expone datos relevantes para análisis de ventas. Endpoints útiles para Ivi:

| Endpoint | Aporta a Ivi |
|---|---|
| `GET /api/overview` | Panorama: lazo (ventas conocidas/reportadas/perdidas), accionable por canal, flujo diario, preguntas |
| `GET /api/overview/lazo` | Estado de reporte a Meta (CAPI) |
| `GET /api/overview/comercial` | Métricas comerciales + **`diaria` (ventas por día EXACTAS)** + **`forecast`** (regresión lineal) |
| `GET /api/overview/tesoreria` | Datos de pagos/tesorería |
| `GET /api/overview/cartera` | Cartera de ventas |
| `GET /api/overview/atribucion` | **ROAS / CAC por país** (requiere snapshot de pauta) — para consultas especializadas |
| `GET /api/leads` · `/api/leads/stats` | Leads y estadísticas |
| `GET /api/decisions` | Decisiones accionables pendientes |
| `GET /api/campaigns`, `/api/ads`, `/api/adsets` | Atribución a pauta |

> **Mejora 2026-07-15 (parte 2):** el backend ahora expone `serieDiaria()`
> (ventas por día reales) y `forecastVentas()` (proyección por mínimos cuadrados) en
> `/comercial`, y un endpoint `/atribucion` con ROAS/CAC por país. Ivi usa la
> serie diaria para **semanas EXACTAS** (ya no aproximación) y el forecast para
> proyecciones. Toda esa matemática vive en el backend; el LLM solo interpreta.

### Muestra real de `/api/overview` (2026-07-15)
```json
{
  "rango": "90d",
  "lazo": { "conectado": true, "ventasConocidas": 6727, "reportadas": 107, "perdidasPorVentana": 309 },
  "accionable": { "total": 12, "porCanal": [ {"canal":"facebook","n":6}, {"canal":"instagram","n":6} ] },
  "cerrado": { "total": 94358, "mensajes": 76869, "comentarios": 17489 },
  "preguntas": { "conTexto": 82076, "precio": 6210, "info": 7644, "soloTelefono": 16350 }
}
```

> Nota: `ventasConocidas: 6727` (backend vivo) ≠ "5.134" (dataset estático). Esto confirma que
> las cifras del dataset están **desfasadas** y deben venir del backend.

---

## 5. Arquitectura: Ivi Analytical Intelligence Engine

Ivi dejó de ser un chatbot que concatena JSON. Ahora es un pipeline modular
de análisis comercial. El LLM **nunca hace matemáticas**: todos los números
los calculan los motores en Python antes de llamar a Ollama.

```
Usuario
  → IntentAnalyzer        clasifica intención (scoring, no `if "ventas" in msg`)
  → DataPlanner          decide qué endpoints consultar (mínimo, reutilizable)
  → DataCollector        fetch paralelo + cache TTL + normaliza + mergea
  → KPIEngine           deriva métricas (ticket, totales, serie semanal aprox.)
  → AnalyticsEngine      variaciones, rolling avg, momentum, ranking, anomalías
  → InsightEngine       detecta riesgos/oportunidades (auto, sin preguntar)
  → RecommendationEngine acciones priorizadas con dueño
  → PromptBuilder       esqueleto analítico con números ya calculados
  → LLM (narrativa)    interpreta / compara / explica / recomienda
  → ResponseFormatter    garantiza Insights Detectados + Preguntas Relacionadas
```

**Principios cumplidos:**
- El backend entrega el máximo de métricas derivadas; el LLM solo interpreta.
- Comparación automática de periodo (actual vs previo, rolling, anual).
- Narrativa fija: Resumen Ejecutivo · Datos Clave · Comparación · Interpretación
  · Riesgos · Oportunidades · Acciones Recomendadas · Preguntas Relacionadas.
- Memoria de sesión para follow-ups ("¿y solo Lima?") sin re-preguntar.
- Cache TTL + fetch paralelo para bajar latencia y evitar llamadas duplicadas.

**Limitación honesta (semanas):** el backend solo expone `serieMensual`
(`comercial.ts`). El `KPIEngine` reparte esas ventas en semanas por
distribución de días del mes → **aproximación**, marcada con `approx=True`.
Para semanas exactas hay que añadir `serieDiaria()` en el backend.

### Módulos (`goberna-kos/ivi/`)
| Archivo | Responsabilidad única |
|---|---|
| `intent_analyzer.py` | Clasificación de intención por scoring de señales |
| `data_planner.py` | Mapea intención → endpoints necesarios (mínimo) |
| `cache.py` | Cache en memoria TTL para no reconsultar |
| `data_collector.py` | Fetch paralelo + normaliza + mergea en `RawData` |
| `kpi_engine.py` | Deriva KPIs de `RawData` (tick, totales, serie semanal) |
| `analytics_engine.py` | Variaciones, rolling, momentum, ranking, anomalías |
| `insight_engine.py` | Detecta riesgos/oportunidades automáticamente |
| `recommendation_engine.py` | Acciones priorizadas con dueño |
| `memory.py` | Contexto conversacional / follow-ups |
| `prompt_builder.py` | Esqueleto de narrativa con números precalculados |
| `response_formatter.py` | Garantiza Insights + Preguntas Relacionadas |
| `server.py` | Cablea los módulos + servidor HTTP (:8080) |
| `config.py` | BACKEND, OLLAMA, PORT, TTL, ctx |

**División de responsabilidades:**
- **Motores (Python):** todo cálculo, comparación y detección.
- **LLM (Ollama `ivi-ventas`):** interpretar, comparar, explicar, sintetizar, recomendar.
- **Backend (Mac :4100):** datos vivos de Cerberus; Ivi no toca Postgres.

Esto evita el anti-patrón de "hornear números en el prompt" y el de
"que el LLM sume" — ambos envejecen mal o se equivocan.

---

## 6. Estado del entrenamiento LoRA (camino A vs B)

### Camino A — Unsloth (bloqueado)
Conflictos de versiones irresueltos en geógrafo:
- torch 2.5.1 + peft 0.19.1 → `LoraConfig got unexpected 'target_parameters'`
- torch 2.6.0 + torchao 0.16.0 → `torch has no attribute 'int1'`
- py3.13 → sin wheel de peft 0.22/0.23
- unsloth_zoo mismatch, torchao residual 0.7.0
- Red HF/PyPI inestable (torch 866MB timeouts)

### Camino B — Ollama / llama.cpp (elegido)
Más estable. Plan:
1. **Ahora:** chat con datos vivos (no requiere entrenamiento) → resuelve el 80% del valor de análisis.
2. **Luego:** fine-tuning LoRA real con `llama.cpp` sobre Qwen3-8B → export GGUF → `ivi-ventas-lora` en Ollama.

---

## 7. Roadmap concreto

### Fase 1 — Ivi Analytical Engine (COMPLETO, sin entrenar)
- [x] **IntentAnalyzer** → clasificación por scoring de señales (no `if "ventas" in msg`).
- [x] **DataPlanner** → mapea intención → endpoints mínimos, reutilizables.
- [x] **DataCollector** → fetch paralelo + cache TTL + normaliza + mergea en `RawData`.
- [x] **KPIEngine** → deriva ticket, totales, serie semanal (aprox.), participaciones.
- [x] **AnalyticsEngine** → variaciones, rolling avg, momentum, ranking, anomalías.
- [x] **InsightEngine** → detecta riesgos/oportunidades automáticamente (sin preguntar).
- [x] **RecommendationEngine** → acciones priorizadas con dueño.
- [x] **PromptBuilder** → esqueleto de narrativa con números ya calculados.
- [x] **ResponseFormatter** → garantiza "Insights Detectados" + "Preguntas Relacionadas".
- [x] **Memoria de sesión** → follow-ups ("¿y solo Lima?") sin re-preguntar.
- [x] `live:true` se marca cuando se consulta el backend.
- [ ] Estabilizar arranque en geógrafo (systemd user unit). Hoy: `setsid` vía heredoc `bash -s`.
- [ ] Actualizar CQs 007/008: quitar cifras estáticas → "consultar en vivo".

> **Limitación conocida (semanas):** el backend `comercial()` solo expone la **serie mensual**
> (`serieMensual`, `YYYY-MM`). El `KPIEngine` reparte esas ventas en semanas usando la
> distribución de días del mes — es una **aproximación** (marcada `approx=True`), válida para ver
> la forma de la curva y comparar periodos, pero no cuenta ventas reales por semana ISO. Para semanas
> exactas hay que añadir un endpoint diario en `server/src/analisis/comercial.ts`
> (ej. `serieDiaria()` con `date_trunc('day', fecha_venta)`).

### Fase2 — Capacidad de análisis (COMPLETA en el engine; ampliar datos del backend)
- [x] Tendencia, comparación de períodos, embudo, atribución por canal → motores ya calculan.
- [x] Contexto de serie temporal (mensual; diario pendiente en backend) para responder tendencias.
- [x] Formato de respuesta analítica obligatorio (narrativa de 7 secciones).
- [ ] Añadir endpoint `serieDiaria()` en backend para semanas/meses exactos y forecast real.
- [ ] Conectar `/api/campaigns/insights` (gasto Meta) para ROAS/CAC reales en el engine.

### Fase 3 — LoRA real (prioridad media-baja)
- [ ] Fine-tuning con llama.cpp sobre Qwen3-8B usando dataset ampliado
- [ ] Regenerar dataset en **español peruano neutro** (pendiente desde el inicio)
- [ ] Export GGUF → `ivi-ventas-lora` en Ollama
- [ ] Evaluar LoRA vs system-prompt en el set de 12 CQs

### Fase 4 — Producto (prioridad baja)
- [x] Memoria de conversación / follow-ups (módulo `memory.py` ya presente).
- [ ] Streaming de respuestas en el chat
- [ ] Autenticación básica si sale de la red Tailscale

---

## 8. Riesgos y decisiones abiertas

| Tema | Decisión pendiente |
|---|---|
| Idioma | Confirmar "español peruano neutro" y regenerar dataset |
| LoRA vs prompt | ¿Vale la pena el LoRA si el system prompt + datos vivos ya funcionan? Medir antes de invertir |
| Dónde corre el chat | ¿geógrafo permanente (systemd) o solo para pruebas? |
| Datos vivos | Dependencia de que el Mac + backend estén encendidos. ¿Mover backend a geógrafo? |
| Frescura de cifras | El backend tiene `sincronizadoAt` — Ivi debería avisar si los datos están viejos |

---

## 9. Cómo prender el chat para hablar con Ivi (ventas)

### Requisitos previos
1. **Backend meta-escuela** corriendo en el Mac (`localhost:4100`) → habilita los datos vivos.
2. **geógrafo** encendido y accesible por Tailscale (`100.117.204.80`).
3. **Ollama** corriendo en geógrafo con el modelo `ivi-ventas` (verificable con `ollama list`).

### Arranque (desde el Mac, por SSH)

El shell de geógrafo es **fish**, que rompe `nohup ... &` en líneas SSH sueltas.
Por eso el arranque va en un script ejecutado con `bash`:

```bash
# 1. Copiar el engine a geógrafo (es un paquete, lleva la carpeta ivi/)
rsync -a goberna-kos/ivi/ geografo@100.117.204.80:~/ia-local/ivi/

# 2. Arrancar el engine (mata instancia previa, lanza desacoplado, verifica puerto)
ssh geografo@100.117.204.80 'bash -s' <<'EOF'
pkill -f "ivi" 2>/dev/null
sleep 1
cd ~/ia-local
setsid python3 -u -m ivi > ~/ia-local/lora-outputs/ivi.log 2>&1 < /dev/null &
sleep 4
cat ~/ia-local/lora-outputs/ivi.log
ss -tln | grep 8080 || echo "NO ESCUCHA 8080"
EOF
```

Salida esperada:
```
Chat de Ivi (ventas + datos vivos) en http://0.0.0.0:8080
LISTEN 0  5  0.0.0.0:8080  0.0.0.0:*
```

### Abrir el chat
- **Tailscale:** http://100.117.204.80:8080
- **LAN (misma red):** http://192.168.18.80:8080

### Probar por API (sin navegador)
```bash
ssh geografo@100.117.204.80 \
  'curl -s -X POST http://localhost:8080/api/chat \
   -H "Content-Type: application/json" \
   -d "{\"message\":\"como vamos en ventas\"}"'
```
Respuesta: `{"response":"...", "live":true}` — `live:true` = respondió con datos del backend.

### Verificado (2026-07-15)
Con el chat prendido, ante *"como vamos esta semana en ventas"* Ivi respondió con las cifras
**reales** del backend (6.727 ventas conocidas, 107 reportadas, 309 perdidas), no con las
estáticas del dataset. `live:true`. ✅

### Cómo apagarlo
```bash
ssh geografo@100.117.204.80 'pkill -f "ivi"'
```

### Detección de intención y datos vivos
El `IntentAnalyzer` clasifica la pregunta por scoring (no por keywords sueltas) y el
`DataPlanner` decide qué endpoints consultar. Cualquier pregunta comercial/analítica
dispara `live:true` y trae datos del backend (overview / comercial / cartera / lazo / tesorería).
Preguntas puramente conceptuales (ej. "¿qué es una venta?") se responden solo con el
conocimiento del modelo.

### Notas de estabilidad
- Si el chat no arranca: revisá `~/ia-local/lora-outputs/chat.log` en geógrafo.
- No usar `nohup ... &` directo por SSH en fish → usar el heredoc `bash -s` de arriba.
- No hay `tmux` instalado en geógrafo; `setsid` cumple para desacoplar el proceso.
- Pendiente (Fase 4): pasar a un **systemd user unit** para que sobreviva reinicios.

---

## 10. Archivos relevantes

| Ruta | Qué es |
|---|---|
| `goberna-kos/cqs/catalog.json` | Catálogo de CQs (12 de ventas, prefijo `cq-ventas-`) |
| `goberna-kos/ivi/` | **Ivi Analytical Engine** (12 módulos + server, ver sección 5) |
| `goberna-kos/scripts/chat_ivi.py` | Versión anterior (keyword + overview). Reemplazada por `ivi/server.py` |
| `goberna-kos/scripts/train-ventas-lora.py` | Script Unsloth LoRA (camino A, bloqueado) |
| `~/ia-local/modelfiles/Modelfile.ventas` | Modelfile de `ivi-ventas` en geógrafo |
| `~/ia-local/datasets/lora-ventas.jsonl` | Dataset JSONL (12 CQs, chat format) |
| `~/models/qwen3-8b-unsloth-bnb-4bit` | Modelo base descargado (7GB) |
| `server/src/routes/overview.ts` | Backend con datos vivos (Mac :4100) |

---

## 11. Próximo paso inmediato

**Correr el Analytical Engine en geógrafo** y confirmar el ciclo completo:

1. `rsync` de `goberna-kos/ivi/` a `~/ia-local/ivi/` en geógrafo.
2. Arrancar con `python3 -m ivi` (desacoplado vía `setsid`).
3. Preguntar *"como vamos en ventas esta semana"* y verificar que la respuesta
   trae: Resumen Ejecutivo · Datos Clave · Comparación · Interpretación ·
   Riesgos · Oportunidades · Acciones · Preguntas Relacionadas + bloque
   **Insights Detectados** generado por los motores (no por el usuario).
4. Confirmar que el `live:true` y que el LLM **no** hace sumas (los números
   vienen de `kpi_engine` / `analytics_engine`).

El engine ya resuelve el 80% del valor de análisis sin LoRA. El LoRA
(Fase 3) solo afinaría tono/formato sobre lo que el pipeline ya produce.
