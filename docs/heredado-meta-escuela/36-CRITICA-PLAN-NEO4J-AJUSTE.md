# 36 — Crítica y ajuste del plan Neo4j (docs/35), anclada en recon de datos

> Recon read-only contra `meta_escuela_prod_db` (VPS1), **2026-07-19**. Toda cifra verificada por SQL.
> No opina: mide. Complementa y **reordena** [`docs/35`](./35-PLAN-MAESTRO-NEO4J-EJECUCION.md).

---

## 0. TL;DR — el hallazgo que cambia el plan

**La atribución, que es el flagship (F1), hoy cubre 32 ventas de 6.448 cobradas = 0,5 %, desde 2
campañas, con los leads congelados desde el 19-may.** Y no es un bug de ingesta: es que **el negocio se
pasó de campañas de lead-form a campañas de WhatsApp/messaging, y la señal de campaña NO se está
capturando** (0 de 76.869 eventos de mensaje traen `campaign_id`/`ctwa_clid`; las ventas traen canal, no
campaña). → **Neo4j para 32 ventas es prematuro.** La inversión real no es un grafo: es **capturar la
atribución en la fuente**. Mientras tanto, atribución v1 = una tool SQL sobre las tablas que ya existen.

---

## 1. Verificación de los supuestos de docs/35

| Supuesto (docs/35) | Veredicto | Evidencia (SQL, 2026-07-19) |
|---|---|---|
| **C1** — atribución Campaña→Lead→Persona→Venta ya latente en Postgres | **PARCIAL / engañoso** | La *identidad* resuelve bien: **669/680** leads → persona (`identidades`+`vinculos_identidad`, 10.655 vínculos). Pero la cadena entera hasta la venta rinde **32 ventas cobradas atribuibles / 6.448 (0,5 %)**, de **2 campañas**. |
| **C2** — Neo4j en geografo por el blocker de RAM/iptables de VPS1 | **Mal encuadrado** | geografo tiene **62 GB de RAM, 19 libres**. Los "16 GB" son la **VRAM de la A4000**, que **Neo4j no toca** (corre en JVM/CPU). El recurso escaso real (VRAM para Ollama/reranker) no compite con Neo4j. El riesgo está puesto sobre la variable equivocada. *(geografo por sudo/precedente sigue siendo buena elección — por otras razones.)* |
| **C3** — la memoria es net-new, no migración | **OK** | Correcto: buffer efímero de 3 turnos (`web.py:194`). |

---

## 2. El cuello de botella real: la atribución no tiene señal (y no la arregla un grafo)

Por `source` en `public.events` (todo ingesta fresco al **11-jul**, salvo uno):

| source | eventos | último evento | ¿trae campaña? |
|---|---|---|---|
| `meta_message_fb` (WhatsApp/FB msg) | 76.869 | **2026-07-11** ✓ | **NO** — keys: `from`, `message`, `conversation_id`. Identidad sí, campaña no. |
| `meta_comment_fb` | 14.736 | 2026-07-11 ✓ | — |
| `meta_comment_ig` | 2.766 | 2026-07-11 ✓ | — |
| **`meta_lead_ad`** (lead-forms) | **680** | **2026-05-19** ✗ | Sí (`campaign_id`) — **pero muerto hace 2 meses** |

**Diagnóstico:** la ingesta funciona (mensajes/comentarios frescos al 11-jul). Los **lead-ad simplemente
dejaron de existir**: las 2 campañas de lead-form (`[ABR] OSINT Y SOCMINT` 530, `[MAY] ANALISTA DE
INTELIGENCIA` 150) pararon el 19-may y **no se lanzaron nuevas**. El gasto de hoy va a campañas **"WSP"**
(WhatsApp — ver los `[JUL]…WSP` de `governa.pauta.porCampana`). Click-to-WhatsApp **no genera lead
record**, y los eventos de mensaje **no guardan de qué anuncio vino** (0/76.869).

**Consecuencia dura:** para ~99,5 % de las ventas **no existe** un camino dato→campaña. Fixear "la
ingesta" no lo resuelve: **no hay señal que ingestar**. Las tres vías para tenerla son de captura, no de
modelado:
1. **click-to-WhatsApp con `ctwa_clid`** (config de Meta + guardarlo en el webhook) — la única vía para
   el canal que hoy factura.
2. **re-correr campañas de lead-form** (vuelven identidad+campaña, como abr-may).
3. **UTMs/tag en la venta** (Cerberus guarda `origen_venta`=canal; falta la campaña).

---

## 3. Gaps del plan, del peor al menor

1. **🔴 BLOQUEANTE — el flagship no tiene datos.** 32 ventas / 2 campañas / leads frozen. Construir
   proyector+grafo+tools+router para atravesar el 0,5 % es un demo. **Prerequisito real de F1:** que
   exista señal de atribución (§2) con una **cobertura objetivo como gate GO** (p.ej. "≥ 30 % de ventas
   con campaña conocida"). Hoy: 0,5 %.

2. **🔴 ¿Neo4j para 32 ventas?** La atribución de 2 campañas la resuelve **un CTE / 3 JOINs** sobre
   `leads + identidades + vinculos_identidad + venta` — ya existen, responde al instante. Neo4j se
   justifica con **multi-hop + GDS + escala**, nada de lo cual pide la data actual. **v1 honesta = tool
   SQL** `governa.atribucion.porIdentidad`; Neo4j entra cuando (a) haya señal y (b) las inferencias GDS
   sean necesarias de verdad.

3. **🟠 F2a (el sensor) es la joya y está mal empaquetada.** No necesita Neo4j, es barata, y alimenta el
   **bucle de fine-tuning** (captura gaps + 👎 → crece el golden set, hoy **n=18**, demasiado chico para
   gatear nada). Va **ya y desacoplada**. *(Ojo naming: ya existe `public.interactions` — mensajes de Meta,
   `meta/interactionsIngestor.ts`; nombrar la tabla del chat distinto, p.ej. `ivi.chat_interacciones`,
   para no confundir.)*

4. **🟠 El plan asume un RAG sólido; no lo es (todavía).** El bucle del crítico adversario destapó fallos
   de **ruteo** (preguntas de plata sobreajustadas a la frase) y de **grounding** (pasaba gasto de pauta
   como facturación con `grounding_ok=true`). Se arreglaron con ruteo determinista + un **backstop Ley I**
   (commit `3f47ec7`). Las tools del grafo **heredan el mismo problema de ruteo** y **deben obedecer el
   backstop** (atribución sin datos → honesto, no una cadena inventada). Requisito transversal, no supuesto.

5. **🟡 El "grafo del embudo" son islas.** 1.567 campañas de pauta (gasto, sin leads) vs 2 campañas con
   32 ventas. El grafo no conecta el 99,5 %; no responde "qué campaña generó ingresos" porque el puente
   lead→venta casi no existe.

6. **🟡 F2b (Graphiti) es lo más pesado (L) y prematuro.** Memoria bi-temporal no es el dolor actual —
   precisión y cobertura sí. Diferir hasta que los datos de F2a muestren que hace falta.

---

## 4. Lo que está BIEN — conservar tal cual

- **Ley I en el diseño del grafo**: nodos con claves/atributos categóricos, **sin montos**; folios→SQL.
  Impecable y coherente con el resto del sistema.
- **Honestidad "atribución por identidad, no causal-por-click"** — el registro correcto.
- **Aditivo + rollback + flags (`RAG_GRAFO=0`) + chequeo de consistencia Postgres↔Neo4j.**
- **geografo por sudo passwordless + precedente `ivi_rag_pg`** (por operabilidad, no por la RAM).

---

## 5. Plan ajustado (reordenado, con gates de DATOS)

```
 Fase A (YA, sin Neo4j) ──▶ Fase B (captura señal) ──▶ Fase C (atribución v1 = SQL) ──▶ Fase D (Neo4j/GDS, si se justifica)
   · F2a sensor de chat           · ctwa_clid / UTMs        · governa.atribucion.porIdentidad     · reevaluar con datos
   · seguir bucle crítico         · o re-correr lead-forms  · honesto, sobre tablas de hoy         · diferir F2b
   (ruteo/grounding)              GATE: %ventas c/campaña ≥ umbral
```

- **Fase A — ahora, desacoplada de Neo4j.** (1) `ivi.chat_interacciones` + hook de log en
  `responder.py`/`web.py` + feedback 👍/👎 → sensor + backlog de gaps + semilla de golden set. (2) Seguir
  el bucle del crítico endureciendo ruteo/grounding. **Es la F2a de docs/35, adelantada y sola.**
- **Fase B — el prerequisito que docs/35 no tiene: capturar la atribución.** Elegir vía (§2). **Gate GO
  para CUALQUIER atribución:** `% de ventas con campaña conocida ≥ umbral` (definir con Estephano). Sin
  esto, todo lo de grafo es demo.
- **Fase C — atribución v1 = SQL, sin grafo.** Tool `governa.atribucion.porIdentidad` (patrón
  `atribucion.ts`): función pura + registro, `read-only`, etiqueta "por identidad, no causal", **cero
  agregados** (folios→`governa.ventas.*`). Sirve las 32 de hoy y escala solo cuando llegue la señal de B.
- **Fase D — Neo4j / Graphiti / GDS: reevaluar, no asumir.** Recién cuando (a) la atribución tenga masa y
  (b) aparezca una pregunta real de **multi-hop** o **inferencia estructural** que SQL no responda bien.
  Hoy no existe. **Diferir F2b** (memoria temporal) hasta tener evidencia de F2a de que se necesita.

---

## 6. Preguntas abiertas para Estephano (definen B)

1. **¿Por qué se dejaron los lead-forms en mayo?** ¿Decisión (WhatsApp convierte mejor) o se cayó y nadie
   lo vio? Cambia si B es "re-correr lead-forms" o "vivir con WhatsApp".
2. **Si el futuro es WhatsApp:** ¿activamos **click-to-WhatsApp con `ctwa_clid`** y lo guardamos en el
   webhook? Es la **única** vía de atribución de campaña para el canal que hoy factura.
3. **¿Qué umbral de cobertura** de atribución hace que valga la pena el grafo? (define el gate de B→D.)
4. **¿Neo4j ahora o después?** Mi recomendación con la data de hoy: **después**. Fase A + C dan el 90 %
   del valor sin infra nueva; Neo4j se gana el sueldo cuando B traiga volumen.
