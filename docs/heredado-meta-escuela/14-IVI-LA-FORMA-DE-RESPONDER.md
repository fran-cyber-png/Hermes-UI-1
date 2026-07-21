# Ivi — la forma de responder: el caso del 2026-07-16 y cómo mejorarla

> Material de trabajo para la sesión "mejorar cómo responde Ivi". Contiene: una conversación
> REAL diseccionada afirmación por afirmación contra la base, la respuesta patrón (cómo debería
> haber sido), el diagnóstico por componente con `file:line`, y las palancas ordenadas.
> Todo número de este doc se verificó el 2026-07-16 contra `/api/overview/comercial` y Postgres.

---

## 1. El caso real

**Pregunta** (usuario, chat de Ivi, 2026-07-16): *"Hola como vamos en la ventas este mes?"*

**Respuesta de Ivi (condensada — el formato de 9 secciones se cumplió bien):**
- "Ventas en julio caen **54,3%** (-184) vs junio: 155 vs 339. Ingresos USD 19.989 (-18.414)."
- "**273 ventas se pierden fuera de la ventana de Meta**, encarece el CAC" (confianza: alta).
- "Julio 48% bajo el promedio de 3 meses (297). Momentum **-32%**."
- "Forecast 390 ventas próximos 30 días (R²=0.002)."
- "Revenue en riesgo por ventana: **USD 21.111** (273 × ticket USD 77,33) [ESTIMACIÓN]."
- Acciones: "Reordenar bandeja de Tesorería por antigüedad / medir latencia de confirmación".

## 2. El fact-check (cada afirmación contra la base)

| Afirmación de Ivi | Veredicto | La realidad verificada |
|---|---|---|
| "Julio cae 54,3% vs junio (155 vs 339)" | **FALSA — artefacto de mes parcial** | La serie diaria llega al **11/07**. Mismos días (1–13): junio 140 ventas · julio **155 (+11%)** |
| "Ingresos -USD 18.414" | **FALSA — mismo artefacto** | 1–13: junio $15.008 · julio **$19.988 (+33%)** |
| "Momentum -32% / 48% bajo el promedio" | **FALSA** | Derivadas de la misma comparación coja. El ritmo diario de julio es el MEJOR del trimestre |
| "273 ventas SE PIERDEN fuera de ventana, encarece el CAC" (alta) | **DESACTUALIZADA** | Es el **backlog histórico** del cron que no existía (16/06–04/07, $32.926 — `docs/10` §2). No es pérdida corriente: con `yaEnMeta()` + cron listo, lo confirmado sale a diario. El contador nunca va a bajar: es acumulado |
| "Ticket promedio USD 77,33" | **ENGAÑOSA** | Es el promedio del **mix histórico completo** (`kpi_engine.py:131-135`). El ticket de julio es **$129** (junio: $107) |
| "Revenue en riesgo USD 21.111 (273 × 77,33)" | **ESTIMÓ LO YA MEDIDO** | El valor real de esas 273 está medido: **$32.926** (docs/10 §2). La estimación quedó 36% corta |
| "Forecast 390 próximos 30d (R²=0.002)" | **PRECISIÓN FABRICADA** | R²=0.002 = no hay tendencia. Lo honesto: "ritmo estable ~13/día ± 6,5" |
| "Producto más vendido: Manual de Inteligencia…" | **ENGAÑOSA** | Es el top del mix **histórico total** (648 u.), no de julio |
| "Reordenar bandeja de Tesorería / medir latencia" | **OBSOLETA** | El Reloj de Tesorería ya existe (`/tesoreria`, arreglado `0419011`) y la latencia ya se mide: p50 1,8 / p90 **3,9** — el propio payload que Ivi recibió lo traía |
| Facebook 55,6% vs IG 44,4% de interacciones | CIERTA pero VIEJA | La ingesta está parada desde el **11/07** — son datos de hace 5 días presentados en presente |

**El formato NO fue el problema**: las 9 secciones, las etiquetas [HECHO]/[ESTIMACIÓN] y el
caveat del R² salieron como el SYSTEM manda. Lo podrido entró **antes del prompt**: en los KPIs
y en las plantillas de insights. El modelo redactó bien datos mal cocinados.

## 3. La respuesta patrón (cómo debería haber sido)

> **Resumen Ejecutivo**
> Datos hasta el **11 de julio** (el dump de Cerberus es del 13/07): julio es un mes PARCIAL y
> no se compara entero contra junio. Comparando los mismos días (1–13), julio va **arriba**:
> **155 ventas (+11%)** y **$19.988 (+33%)** vs junio (140 / $15.008), con ticket $129 (+21%).
> El ritmo es estable: ~13 ventas/día (±6,5), sin tendencia estadística (R²≈0). No hay señal de
> caída; la única alerta operativa es la frescura de los datos (2 días de rezago del dump y la
> ingesta de interacciones parada desde el 11/07).
>
> **Evidencia** — junio completo: 339 / $38.403 · junio 1–13: 140 / $15.008 · julio 1–11: 155 /
> $19.988 · ticket jul $129 vs jun $107 · abril 328 / mayo 398 / junio 339 (la escala mensual).
>
> **Sobre el lazo** — Meta tiene 107 compras reportadas. Las 273 "fuera de ventana" son el
> backlog del período sin cron (16/06–04/07, $32.926 [HECHO]); no es pérdida corriente y no se
> arregla con Tesorería (su p90 real es 3,9 días). El paso pendiente es encender `LAZO_RELOJ`
> en simulación y validar.
>
> **Qué NO sé con estos datos** — el mix de productos DE JULIO (el mix disponible es histórico
> total); ventas por sede de julio; nada posterior al 11/07.
>
> **Acciones** — (1) refrescar el dump de Cerberus (3 días de rezago); (2) reconectar la ingesta
> de interacciones (parada desde el 11/07); (3) encender el lazo en simulación y comparar contra
> `ontologia.conversiones`.

Regla de oro que esta respuesta aplica y la de Ivi no: **antes de comparar períodos, igualar
las ventanas; antes de narrar, decir hasta cuándo llegan los datos; nunca estimar lo que ya
está medido; y una tendencia con R²≈0 no es una tendencia.**

## 4. Dónde nace cada error (diagnóstico por componente)

El pipeline (`goberna-kos/ivi/`, 1.892 líneas): `server.py:159 handle_chat` → `intent_analyzer`
→ `data_planner` (catálogo a mano de endpoints BFF, `data_planner.py:12-52`) → `data_collector`
→ `kpi_engine` → `analytics_engine` → `insight_engine` → `recommendation_engine` →
`impact_engine` → `prompt_builder` (289 líneas) → Ollama (`ivi-ventas`, qwen3:8b, ctx 8192,
temp 0.3, SYSTEM en `Modelfile.ventas`) → `response_formatter`.

| Error | Componente | Detalle |
|---|---|---|
| Mes parcial vs mes completo | `kpi_engine.py:59-63` (`last_month`/`prev_month`) y quienes los consumen en `analytics_engine` | Compara los 2 últimos buckets mensuales tal cual. **La serie diaria exacta YA llega del backend** (`kpi_engine.py:55,140` — `comercial.diaria`, hasta el 11/07) y la comparación no la usa. El scope guard del diseño v3 ("nunca comparar acumulado con período", el fix del bug 309) está diseñado y NO construido |
| Narrativa vieja del lazo con confianza alta | `insight_engine.py:37-45` | Plantilla horneada: *"Tesorería confirma el voucher después de los 7 días… encarece el CAC"*, dispara si `perdidas/conocidas > 2%` — un **acumulado histórico** (273/6.727) que nunca baja. docs/10 §2 la desmintió: medía nuestro cron, no a Tesorería |
| Ticket engañoso | `kpi_engine.py:131-135` | `ticket_promedio_usd` = mix histórico completo, no del período preguntado |
| Estimar lo medido | `impact_engine.py` (revenue en riesgo = `perdidas × ticket`) | El valor real de las 273 existe ($32.926). Falta exponerlo (p. ej. `governa.lazo.estado`) y usarlo como [HECHO] |
| Forecast con R²≈0 | `analytics_engine` → `impact_engine` (spec v2: "HECHO + caveat si r2<0.3") | El caveat salió, pero una proyección sin señal no debería presentarse como número. Umbral de supresión |
| Frescura invisible | `data_collector.py` → `prompt_builder.py` | Nadie calcula ni transporta "datos hasta el 11/07" / "dump del 13/07" / "interacciones paradas desde el 11/07". El modelo narra en presente |
| Acciones recicladas | `recommendation_engine.py` | Recomienda construir lo que ya existe (Reloj de Tesorería) porque sus plantillas no saben qué existe |
| Top producto sin período | mix del BFF (`analisis/comercial.ts`) sin `desde/hasta` | El gap que la spec v3 §9 ya documenta: mix/sedes/embudo no aceptan rango |

**El SYSTEM (`Modelfile.ventas`) está bien** — 10 fases, "NUNCA calcules", HECHO/ESTIMACIÓN.
Es la palanca CHICA: puede exigir fecha de corte y prohibir presente continuo sobre acumulados,
pero no puede arreglar KPIs mal cocinados. La inteligencia vive en el engine, y ahí se corrige.

## 5. Las palancas, en orden (plan sugerido para la sesión)

1. **P1 — Scope guard / períodos comparables** (`kpi_engine` + `analytics_engine`): si el último
   mes es parcial, comparar 1..N vs 1..N usando `serie_diaria`, etiquetar "mes parcial (hasta el
   D)". Python puro, testeable sin LLM. **Mata la mentira más gorda.**
2. **P2 — La frescura como dato**: `data_collector` calcula "datos hasta" por endpoint (max día
   de `diaria`, `ultima_interaccion`, edad del snapshot) → `prompt_builder` la inyecta →
   el SYSTEM obliga a abrir el Resumen con la fecha de corte.
3. **P3 — Desintoxicar `insight_engine`**: reescribir el insight del lazo con la verdad de
   docs/10 (backlog histórico ≠ pérdida corriente; Tesorería p90 3,9); revisar las demás
   plantillas contra docs/10-12 antes de que repitan historia vieja.
4. **P4 — Forecast honesto**: si `r2 < 0.3`, no proyectar — decir "ritmo estable ~X/día ± e".
5. **P5 — No estimar lo medido**: exponer el valor real del backlog fuera de ventana (SDK,
   `governa.lazo.estado` o lazoDetalle) y que `impact_engine` lo tome como [HECHO].
6. **P6 (estructural) — `collect()` al SDK**: reemplazar el catálogo a mano
   (`data_planner.py:12-52`) por `/api/sdk/catalogo` + `invocar` — frescura, `fuentes` y CQs
   vienen gratis. Es la iteración "Ivi al SDK" ya identificada en docs/11.
7. **P7 — Retoques al SYSTEM** (`Modelfile.ventas`): fecha de corte obligatoria, prohibido el
   presente continuo sobre acumulados, confianza calibrada (un acumulado histórico no puede
   sostener "confianza: alta" sobre el presente). *Deploy del Modelfile a geógrafo lo hace el
   operador — no el agente.*

**El arnés que ancla todo**: *golden questions*. Guardar pregunta + respuesta patrón (§3 es la
primera) y testear el ENGINE sin LLM (asserts sobre KPIs/insights/impact: "julio parcial ⇒
comparación 1..N", "no existe insight de Tesorería si p90<7", "forecast suprimido si r²<0.3").
Ya existe la costura: `goberna-kos/tests/test_impact_engine.py`. El E2E con LLM queda como
smoke, no como assert de texto.

## 6. Cómo correr y probar

```bash
# El chat (geógrafo debe estar arriba; el backend es esta laptop vía Tailscale)
open http://100.117.204.80:8080
curl -s -XPOST http://100.117.204.80:8080/api/chat -H 'content-type: application/json' \
  -d '{"message":"¿cómo vamos en las ventas este mes?","sid":"golden-1"}' | jq -r .response

# Lo que Ivi ve (el insumo crudo)
curl -s localhost:4100/api/overview/comercial | jq '{serie: .serie[-4:], forecast: .forecast.r2, latencia: .latencia.p90}'

# Tests del engine (geógrafo no hace falta)
cd goberna-kos && python3 -m pytest tests/ -q
```

Estado del entorno al cierre (2026-07-16): chat vivo y probado E2E; datos de Cerberus al 13/07;
serie diaria al 11/07; ingesta de interacciones parada desde el 11/07; pauta con snapshot limpio
del 15/07 (post-fix `9b0bedf`). Pendientes de aprobación en `docs/13`.
