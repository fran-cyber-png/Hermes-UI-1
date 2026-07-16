# Ivi — Contexto de Sesión y Objetivo

> Documento de trabajo vivo. Reúne lo hecho, el estado, el problema actual
> (conversaciones rotas) y el plan para llegar a un **Analytical Intelligence Engine**
> conversacional y especializado.

---

## 1. Objetivo final

Convertir a **Ivi** de un chatbot que concatena JSON en un **motor de análisis
comercial conversacional** comparable a un analista senior de BI, que:

- Responde con: qué pasó · por qué · contra qué se compara · qué significa ·
  qué debe hacerse.
- Nunca hace el LLM cálculos matemáticos (los motores Python los precalculan).
- Consulta datos vivos del backend de meta-escuela (Cerberus espejado).
- Soporta consultas especializadas: ventas por mes/semana/día, tendencia, forecast,
  embudo, tesorería, cartera, atribución ROAS/CAC, productos, sedes, Meta/CAPI.

---

## 2. Estado actual (2026-07-15)

### Arquitectura entregada — `goberna-kos/ivi/` (12 módulos + server)
```
Usuario → IntentAnalyzer → DataPlanner → DataCollector → KPIEngine
        → AnalyticsEngine → InsightEngine → RecommendationEngine
        → PromptBuilder → LLM (ivi-ventas) → ResponseFormatter
```
- `intent_analyzer.py` — scoring de intención (19 intenciones), extrae mes/año pedido.
- `data_planner.py` — mapea intención → endpoints mínimos.
- `cache.py` + `data_collector.py` — fetch paralelo, TTL cache, normaliza.
- `kpi_engine.py` — deriva ticket, totales, serie diaria, forecast, ROAS.
- `analytics_engine.py` — variaciones, rolling, momentum, ranking, anomalías, **semanas EXACTAS** (desde serie diaria).
- `insight_engine.py` — riesgos/oportunidades automáticas + hipótesis marcadas.
- `recommendation_engine.py` — acciones priorizadas con dueño.
- `memory.py` — follow-ups ("¿y solo Lima?") sin re-preguntar.
- `prompt_builder.py` — narrativa de 7 secciones + bloque "Mes solicitado".
- `response_formatter.py` — garantiza "Insights Detectados" + "Preguntas Relacionadas".
- `server.py` — cablea todo, HTTP en :8080.

### Backend — `server/src/` (Mac :4100)
- `/api/overview/comercial` ahora expone **`diaria`** (ventas por día reales) y **`forecast`** (regresión lineal: pendiente, R², error, proyección).
- Nuevo `/api/overview/atribucion` → **ROAS/CAC por país** (reusa `roasPorPais`).
- `typecheck` limpio, **49 tests pasan**.

### Lo que YA funciona
- Pipeline end-to-end con datos simulados: intención, KPIs, comparaciones,
  insights, acciones, narrativa de 7 secciones.
- "julio 2026" → el engine filtra la serie mensual y le pasa al modelo
  `MES SOLICITADO (2026-07): 372 ventas, USD 353400 | vs 2026-06: +24 (+6.9%)`.

---

## 3. EL PROBLEMA (RESUELTO 2026-07-15 — deploy activado)

Las conversaciones salen rotas. Ejemplo real:

```
Ivi (saludo): "Hola, soy Ivi. Sé sobre ventas en Cerberus (...) y puedo
      consultar datos en vivo cuando me preguntes por números actuales."
Tú:  "hola quiero analizar las ventas de este mes"
Ivi: "Hola, ¿en qué mes te refieres? Los datos que tengo son globales y no
      están segmentados por período específico. Si necesitas un análisis
      detallado por mes, necesitaríamos datos de ventas por mes, que no están
      disponibles en este momento."
Tú:  "a mes de julio 2026"
Ivi: "No tengo datos específicos para el mes de julio 2026, ya que los datos
      proporcionados son en vivo al momento de la consulta y no incluyen
      información histórica..."
```

### Diagnóstico (raíz)
El **SYSTEM prompt del modelo `ivi-ventas`** (en geógrafo) es el de un
"asistente de reglas" viejo:

```
SYSTEM: "Eres Ivi, asistente experto en el sistema Goberna... Tienes
conocimiento certificado sobre VENTAS en Cerberus... Cuando te pregunten
sobre ventas, usa esta información [12 CQs con cifras ESTÁTICAS: 5.134
ventas, 4.729 pagadas]... Si no sabes algo, dilo claramente."
```

Ese prompt **contradice al engine**:
1. Dice que solo consulta "números actuales" → el modelo ignora la serie mensual que el engine le inyecta.
2. Trae cifras estáticas viejas (5.134) → el modelo las prefiere sobre los datos vivos.
3. Le da un tono de FAQ de reglas, no de analista BI.
4. No sabe que el engine le pasa `MES SOLICITADO`, `SERIE`, `FORECAST`, `ROAS`.

**El engine YA tiene los datos correctos.** El fallo es que el modelo no los usa
porque su SYSTEM lo desorienta.

---

## 4. Plan de arreglo (en ejecución)

### 4.1 Engine (hecho en esta sesión)
- [x] `intent_analyzer` extrae `target_month` / `target_year` ("julio 2026", "2026-07", "año 2025").
- [x] `prompt_builder` inyecta bloque `-- Mes solicitado --` con el mes filtrado + vs mes previo.
- [x] Verificado: "julio 2026" → `MES SOLICITADO (2026-07): 372 ventas, USD 353400 | vs 2026-06: +24 (+6.9%)`.

### 4.2 SYSTEM prompt del modelo (ACTIVADO en geógrafo 2026-07-15)
- [x] Creado `IVI-MODEL-SYSTEM.md` con el nuevo SYSTEM (incluye la nueva sección
      `-- Semana solicitada --`).
- [x] Modelfile final versionado en `goberna-kos/Modelfile.ventas` y staged en
      geógrafo como `~/ia-local/modelfiles/Modelfile.ventas.new` (el modelo vivo
      NO fue tocado).
- [x] **Validado E2E sin deploy** (2026-07-15): prompt real del pipeline +
      SYSTEM nuevo vía `qwen3:8b` con `system` override contra el Ollama de
      geógrafo. "este mes" y "julio 2026" → narrativa de 7 secciones, cifras
      correctas del backend vivo, cero "no tengo datos" / "¿en qué mes?".
- [x] **ACTIVADO** (2026-07-15, deploy corrido por el operador con
      `deploy-ivi-geografo.sh`): `ivi-ventas` recreado (b64ebe6c0765),
      `chat_ivi.py` reemplazado por `python3 -m ivi.server` en :8080.
      Smoke tests en producción OK: "ventas de este mes" (155, -54,3% vs junio)
      y "esta semana" (93 vs 92, +1%), ambos con `live: true` y sin
      "no tengo datos".

### 4.3 Conversaciones / follow-ups (mejoras)
- [x] `memory.py` ya resuelve follow-ups por sede/país.
- [x] "este mes" / "esta semana" resuelven contra la última fecha de la serie
      (`relative_period` en `intent_analyzer` + resolución en `prompt_builder`,
      con nota de "puede estar incompleto"). "julio" sin año → el julio más
      reciente de la serie. Verificado contra backend vivo.
- [x] El saludo del server nuevo ya es de analista BI; el saludo viejo muere
      junto con `chat_ivi.py` al desplegar.

### Hallazgos de infraestructura (2026-07-15)
- En geógrafo el `:8080` lo sirve **el `chat_ivi.py` VIEJO** (`~/ia-local/scripts`,
  nohup suelto, padre pid 1, sin systemd ni cron) — el engine nuevo no estaba
  desplegado. Las conversaciones rotas del §3 salían de ahí.
- `voz-ivi/server.py` es otro proceso (127.0.0.1:8600), no confundir.
- Datos REALES de julio 2026 (backend vivo): **155 ventas, USD 19.989**
  (-54,3% vs junio: 339). Los "372 ventas / USD 353.400" de este doc eran
  datos simulados de la sesión anterior.

### 4.4 Consultas especializadas (siguiente)
- [ ] Conectar `/api/leads/stats` y costo-por-lead → embudo Lead→Venta→Pago.
- [ ] Usar `/api/overview/atribucion` (ROAS/CAC) en preguntas de pauta.
- [ ] Forecast real ya servido; añadir estacionalidad (años previos) cuando haya >12 meses.

---

## 5. Archivos clave

| Ruta | Qué es |
|---|---|
| `goberna-kos/ivi/` | Engine analítico modular (12 módulos + server) |
| `goberna-kos/IVI-ANALISIS.md` | Análisis y roadmap original (actualizado) |
| `goberna-kos/IVI-MODEL-SYSTEM.md` | **Nuevo SYSTEM prompt + cómo aplicarlo** |
| `server/src/analisis/comercial.ts` | `serieDiaria()`, `forecastVentas()` |
| `server/src/routes/overview.ts` | `/comercial` (diaria+forecast), `/atribucion` (ROAS) |
| `~/ia-local/modelfiles/Modelfile.ventas` (geógrafo) | SYSTEM del modelo — **hay que reescribirlo** |

---

## 6. Cómo verificar el arreglo (criterio de éxito)

**Ya verificado el 2026-07-15 vía API (system override, sin deploy)** — respuesta
real obtenida con datos vivos:

```
Tú:  "hola quiero analizar las ventas de este mes"
Ivi: ## Resumen Ejecutivo
      Las ventas de julio 2026 registraron 155 ventas (USD 19.989),
      un descenso del 54,3% frente a junio (339). ...
      ## Datos Clave / ## Comparación / ## Interpretación /
      ## Riesgos / ## Oportunidades / ## Acciones Recomendadas /
      ## Preguntas Relacionadas
```

Después de correr `deploy-ivi-geografo.sh`, repetir la misma pregunta en
`http://100.117.204.80:8080` — ya NO debe aparecer "no tengo datos por mes"
ni "¿en qué mes te refieres?". Script de prueba reutilizable:
`test_e2e_system.py` / `test_periodos.py` (scratchpad de la sesión 2026-07-15).
