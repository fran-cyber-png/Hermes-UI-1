# Arquitectura — Cerberus Intelligence

> **Fecha**: 2026-08-11. Todo número está medido contra producción; lo que no se pudo medir
> dice `UNKNOWN — REQUIERE DATOS`.
> **Documentos hermanos**: `taxonomy_v0.json` · `ontology_v0.json` · `signal_catalog_v0.json` ·
> `labeling_functions_v0.py` · `classification_schema_v0.json` · `training_dataset_schema.json` ·
> `evaluation_plan.md`.

---

## 0. Tres hechos que reordenan el pedido

**1. «Cerberus» no es el origen de los datos citados.** Las cuatro cifras del pedido salen de
**tres bases distintas**, ninguna de ellas el ERP:

| Cifra del pedido | Dónde vive de verdad | Medido |
|---|---|---|
| ~53.000 contactos | `goberna_crm_db` → `crm.contacts` | **53.366** |
| ~76.869 mensajes | `meta_escuela_prod_db` → `interactions` | **76.869** ✓ |
| ~34.118 PSIDs | misma base, `persona_id` distintos | **34.118** ✓ |
| ~680 leads con email+teléfono | misma base, `public.leads` | **680** ✓ |

Cerberus (el ERP, Django+MySQL, VPS2) es la fuente de la **venta**, y su espejo vivo es
`icarus.sales`.

**Matriz de solapamiento por sufijo telefónico de 9** (medida a mano el 11-ago-2026 extrayendo los
conjuntos de las cuatro bases e intersectándolos):

| | HERMES 3.941 | ICARUS 69.654 | GOBERNACRM 52.905 | LEADSCRM 57.358 |
|---|---|---|---|---|
| **HERMES** | — | 1.369 · 34,7 % | 723 · 18,3 % | 1.237 · 31,4 % |
| **ICARUS** | 34,7 % | — | 52.572 · **99,4 %** | 56.632 · **98,7 %** |
| **GOBERNACRM** | 18,3 % | 99,4 % | — | 52.905 · **100,0 %** |
| **LEADSCRM** | 31,4 % | 98,7 % | 100,0 % | — |

Unión de los cuatro: **72.926** personas. Suma ingenua: 183.858 → **inflación 2,52×**.
El **71,8 %** de la gente aparece en exactamente **tres** almacenes.

🔴 **Dos lecturas que ninguna auditoría previa había hecho:**
1. **GOBERNACRM está contenido al 100,0 % en LEADSCRM** — subconjunto estricto, sin una sola
   excepción. Mantenerlo vivo no agrega una persona.
2. **Quien conversa NO es quien está en el padrón**: de las 3.941 personas con conversación en
   Hermes, **2.572 (65,3 %) no aparecen en ICARUS**. Los tres padrones grandes describen la misma
   población histórica, y el canal vivo trae gente que la base de contactos no conoce. *Ése* es el
   problema de identidad — no la duplicación entre padrones, sino que el canal vivo y el padrón casi
   no se tocan.
   ⚠️ **Consecuencia directa sobre §1**: el scoring tabular sobre formularios, que es el motor que
   recomiendo, **no puntúa a dos de cada tres personas que están escribiendo ahora**. Hay que decirlo
   al presentarlo.

De los 34.118 PSIDs de Messenger sólo **918 (2,69 %)** se pueden atar a un cliente.
*Caveat*: el sufijo de 9 produce falsos positivos entre países (cicatriz #119). La dirección es
robusta; las cifras exactas llevan ruido de colisión.

**2. Esto ya se construyó dos veces y las dos están apagadas.**
`leads_crm` tiene 59.707 leads, 34.523 interacciones, **12.338 embeddings de 768 dims con
índice HNSW**, 86 reglas de intención, 29 intents de LLM, 501 respuestas aprendidas y un
router en producción. El contenedor del bot **ya no existe** — fue desmantelado, no detenido.
`goberna_crm` tiene el esquema `ai.*` completo con **cero filas**.
La tabla que iba a capturar el ground truth (`ai_feedback`, 25 columnas) tiene **2 filas con el
shadow mode prendido**. Y de las 7 escalaciones que el bot generó, **las 7 fallaron al notificar**.
> La lección no es «faltó modelo». Es: **la inteligencia funcionó y el caño hacia una persona
> nunca se conectó.**

**3. La inferencia no es el problema de costo.** Medido en el sistema previo:
**US$ 0,519756 en 18 días** sobre 1.045 requests, **≈ $0,0012 por mensaje procesado de punta a
punta** (router + generador + reranker + reintentos + fallos).
⚠️ *El denominador es aproximado a propósito*: `ai_request_costs.interaction_id` es **NULL en el
100 % de las filas**, así que la tabla no puede atar un costo a un mensaje. El rango medido va de
$0,00122 a $0,00141 según cómo se cuente. El orden de magnitud es lo que decide, y no se mueve.
Mi modelo con los tokens medidos del bot de Hermes coincide:
clasificar **el corpus histórico completo** (89.962 mensajes) cuesta entre **$54 y $269** según
modelo, y el tráfico corriente sale **$3–$20 al mes**.

> **Consecuencia dura**: la premisa del pedido —«sin depender eternamente de llamadas costosas a
> un LLM»— **no se sostiene con estos volúmenes**. Destilar el LLM a un clasificador chico para
> ahorrar costo de inferencia cuesta mucho más en horas de ingeniería que los $20/mes que ahorra.
> El costo real de este sistema es **etiquetar, evaluar y mantener**, no inferir.

---

## 1. El error de encuadre, y el reencuadre

El pedido asume que el problema es **clasificar la intención de la conversación**. Los datos
dicen que ahí no hay ni señal suficiente ni resultado que aprender:

| | Volumen de outcome | ¿Entrenable? |
|---|---|---|
| conversación → **venta** | **17** de 1.464 (re-medido por mí, independiente) | ❌ |
| conversación → **respuesta** | **1.129** pares (11,42 %) | ✅ débil |
| **formulario → venta** | **1.002** positivos sobre 19.670 (5,09 %) | ✅ **sí** |

> ⚠️ **El 17 NO dice que conversar no venda.** `conversiones_wa` cubre 2024-03 → 2026-08;
> `interactions` de Hermes cubre **tres semanas** (2026-07-21 → 2026-08-11). Los 1.447 «anteriores»
> son ventas de gente que compró **antes de que Hermes tuviera un solo mensaje suyo**. Es un límite
> de instrumentación, no un hecho comercial. Lo que autoriza a decir es: **Hermes todavía no puede
> medir si la conversación vende** — y ése es el arreglo, no el modelo.

Y del lado de la entrada, sobre 3.219 entrantes vivos de WhatsApp:
**845 sin texto (26,3 %) + 817 prellenados por Meta (25,4 %) + 516 saludos (16,0 %) = 67,7 %
sin intención que inferir.** Queda ~21 % de texto humano libre: **unos 230 mensajes por semana.**

> **El reencuadre**: el primer motor que rinde no clasifica conversaciones. **Puntúa contactos**
> sobre la población de formularios, donde el resultado tiene volumen (1.002 positivos) y las
> variables son tabulares. Eso es regresión logística o gradient boosting, no un LLM.
> La clasificación de texto viene después, es chica, y es barata.

---

## 2. La arquitectura

```
                          ENTRADA (mensaje · formulario · evento de campaña)
                                             │
                    ┌────────────────────────┴────────────────────────┐
                    ▼                                                 ▼
        ┌───────────────────────┐                         ┌────────────────────────┐
        │ 1. PROCEDENCIA        │  determinística         │ 1'. INGESTA TABULAR    │
        │    regex + longitud   │  0 costo, 0 latencia    │     formulario/campaña │
        │    resuelve 67,7 %    │                         └───────────┬────────────┘
        └───────────┬───────────┘                                     │
                    │ humano_libre (~21 %)                            │
                    ▼                                                 │
        ┌───────────────────────┐                                     │
        │ 2. ENTIDADES          │  regex + diccionario existente      │
        │    tel · mail · curso │  (`alias_curso`, 57 filas)          │
        │    cargo · partido    │  ── descubierto: candidatos         │
        └───────────┬───────────┘                                     │
                    ▼                                                 │
        ┌───────────────────────┐                                     │
        │ 3. LFs + vecino       │  vota o SE ABSTIENE                 │
        │    embedding          │  cobertura medida: 47 % / 11,5 %    │
        └───────────┬───────────┘                                     │
                    │                                                 │
              ¿hay consenso?                                          │
          ┌─────────┴─────────┐                                       │
          ▼ sí                ▼ no (la mayoría)                       │
     ACEPTAR            ┌──────────────┐                              │
                        │ 4. LLM       │  ~230/semana · $0,0011 c/u   │
                        │    Haiku 4.5 │  con caché + salida tipada   │
                        └──────┬───────┘                              │
                               ▼                                      │
                    ┌──────────────────────┐                          │
                    │ 5. CONFIANZA         │  calibrada, no softmax   │
                    └──────────┬───────────┘                          │
              ┌────────────────┼────────────────┐                     │
              ▼ alta           ▼ media          ▼ baja                │
           ACEPTAR         A REVISIÓN       DESCONOCIDO               │
              │                │                │                     │
              └────────────────┴────────────────┘                     │
                               ▼                                      ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ 6. ALMACÉN DE SEÑALES  (deriva; no guarda salvo caro) │
                    └────────────────────────┬─────────────────────────────┘
                                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ 7. SCORING — y acá está el modelo que SÍ se entrena   │
                    │    fit (tabular) · intención · engagement · urgencia  │
                    │    outcome = formulario→venta (1.002 positivos)       │
                    └────────────────────────┬─────────────────────────────┘
                                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ 8. RANKING  →  la cola que YA existe (`cola/urgencia`)│
                    └────────────────────────┬─────────────────────────────┘
                                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ 9. ACCIÓN — humana por default (ADR 0018)            │
                    └────────────────────────┬─────────────────────────────┘
                                             ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ 10. OUTCOME → LAZO  (`procedencia/` + `resultados/`) │
                    │     🔴 ESTE es el eslabón que falló las dos veces     │
                    └──────────────────────────────────────────────────────┘
```

### Por qué esta forma y no la del pedido

El diagrama del pedido pone `SIGNAL ENGINE → SEMANTIC PARSER → ENTITY/INTENT/STATE → ROUTER`.
Tres cambios, cada uno por una medición:

1. **`PROCEDENCIA` va primero y es determinística.** En el diagrama original el parser semántico
   recibe todo. Acá recibe el 21 %. Es la diferencia entre razonar sobre 3.219 mensajes por
   semana y razonar sobre 230.
2. **`STATE ENGINE` no existe: ya está construido.** `etapaEfectivaSql` deriva las cinco etapas
   desde acciones del comprador (ADR 0044/0050), con tests de paridad. Construir otro es #37.
3. **El `SCORING` no cuelga de la clasificación**: cuelga de la población de formularios, que es
   donde hay outcome. En el diagrama original el score es consecuencia del intent; acá son dos
   caminos que se encuentran recién en el ranking.

---

## 3. Lo que NO hay que construir porque ya existe

Medido leyendo el árbol de `hermes/server/src/`. Reimplementar cualquiera de estos es la
cicatriz #37 del repo (la misma regla en dos lados que divergen):

| Capacidad del pedido | Ya vive en | Mecanismo |
|---|---|---|
| Señal de cotización | `senales/cotizacion.ts` | regla pura + veto |
| Señal de enfriamiento | `senales/enfriamiento.ts` | reloj inyectado ⚠️ umbral mal fijado |
| Clasificador de producto | `cursos/` + `alias_curso` (57) | diccionario + precedencia + test de paridad SQL↔TS |
| Estado / etapa | `etapaEfectivaSql` (ADR 0044/0050) | derivada de acciones del comprador |
| Ranking / urgencia | `cola/urgencia.ts` + `urgenciaSql.ts` | niveles + test de paridad |
| Ventana de contacto | `cola/ventana.ts` | 24 h / 7 d, pura + gemelo SQL |
| Momentos de venta | `sugerencias/estado.ts` | vocabulario compartido día y noche |
| Catálogo direccionable | `catalogo/` + `piezas/` | `{clase,id}` + versión por hash |
| **Lazo de resultados** | `procedencia/` + `resultados/` | Wilson 95 %, muestra mínima 30, nombres sin causalidad |
| Clasificación del bot | `bot/` (Bedrock, Haiku 4.5) | temperatura · motivo · escalada |
| Extracción de eventos | `eventos/` | 6 tipos tipados |

> **`procedencia/` + `resultados/` es el módulo más importante del repo para este proyecto** y ya
> está escrito: mide de qué pieza salió cada envío y qué pasó después, con intervalo de Wilson y
> la regla de que ningún nombre promete causalidad. **El motor de inteligencia debe enchufarse
> ahí, no al lado.**

---

## 4. Modelo: qué usar y por qué

| Opción | Veredicto para Cerberus |
|---|---|
| **Determinístico (regex/diccionario)** | ✅ **Primera capa, obligatoria.** Resuelve 67,7 % de la entrada a costo cero. |
| **Embedding + vecino más cercano** | ✅ **Segunda capa.** Ya hay 12.338 vectores de 768 dims con HNSW construido. Reusar antes que re-entrenar. |
| **LLM few-shot con salida tipada** | ✅ **Tercera capa y motor principal.** 230 mensajes/semana × $0,0011 = **$0,25/semana**. |
| Regresión logística / GBM tabular | ✅ **Para el scoring de contactos** — 1.002 positivos, variables tabulares. Es el único modelo con datos para entrenarse. |
| SetFit | ⚠️ Diseñado para pocos ejemplos, y es el caso… pero **no hay ni 300 etiquetas**. Reevaluar en la fase 4. |
| Transformer chico afinado | ❌ Sin conjunto dorado no hay con qué. |
| LLM causal afinado | ❌ Complejidad sin sustento. |
| **Destilación LLM→modelo chico** | ❌ **Rechazada por costo medido.** Ahorra $20/mes y cuesta meses. Reevaluar si el tráfico crece 100×. |

**Modelos concretos** (IDs de primera parte; en Bedrock llevan prefijo `anthropic.` y **precio
propio** — ver `aws.amazon.com/bedrock/pricing`):
`claude-haiku-4-5` ($1/$5 por MTok) para clasificar · `claude-sonnet-5` ($3/$15) para el
etiquetado semilla y el juez · `claude-opus-5` ($5/$25) sólo para inducir taxonomía sobre
clusters.

🔴 **Dos defectos medidos en la integración actual del bot**:
1. **El caché de prompt no pega.** `agente.ts` coloca bien el `cache_control` (bloque estable
   primero, contacto volátil después), y sin embargo las **404 llamadas registran 0 tokens de
   caché**. El input promedio es **4.145 tokens** y el mínimo cacheable de Haiku 4.5 es **4.096**:
   el prefijo estable está *por debajo del mínimo* y el caché no puede engancharse nunca.
2. **`agente.ts:51` hace `?? 0`**, así que «no hubo caché» y «Bedrock no informó el campo» se
   guardan idénticos. Con eso, el defecto (1) es **inobservable desde la base**.
   Arreglo: distinguir `null` de `0`, y engordar el prefijo estable por encima de 4.096 (o
   cambiar de modelo). Ahorro estimado sobre el input: **~75 %**.

Además, `clienteBedrock.ts` usa `AnthropicBedrock` (la ruta legacy InvokeModel); para código
nuevo la recomendada es `AnthropicBedrockMantle`. ⚠️ En Bedrock **no hay Batch API** y no hay
caché automático (sí `cache_control` explícito): el backfill de 89.962 mensajes con 50 % de
descuento **exige la API de primera parte**.

---

## 5. Confianza y abstención

Cuatro cosas distintas que el sistema previo mezclaba:
`similitud de embedding` ≠ `probabilidad del modelo` ≠ `confianza calibrada` ≠ `fuerza de evidencia`.

- Sólo la **confianza calibrada** (Platt o isotónica sobre validación) decide el ruteo.
- **El umbral es POR CLASE**, fijado por el costo asimétrico del error: `soporte_postventa` se
  revisa de más (es alguien que ya pagó); `pide_info_generica` se exige más.
- **`ABSTENIDA` es una salida de primera clase**, no un fallo. El sistema nunca está obligado a
  elegir: el 88,5 % del texto libre de WhatsApp no recibe voto de ninguna regla, y forzar una
  clase ahí es inventar.

---

## 6. Aprendizaje continuo y descubrimiento

**Cola de revisión, por prioridad** (no muestreo al azar):
`outcome contradice la predicción` → `LLM ≠ regla` → `clase de alto valor` → `nadie votó` →
`cluster nuevo`.

**Descubrimiento de clases nuevas**: los `OTRO` se agrupan semanalmente; un cluster de ≥ 20 con
cohesión estable durante 2 semanas se le presenta a una persona con 5 ejemplos y un nombre
propuesto por un LLM. **La persona aprueba; el LLM no crea clases.**
Ya hay una clase descubierta así: **`se_presenta_como_candidato`** (2,3 % de los entrantes libres
de WhatsApp) — el puente al negocio de consultoría, que hoy ninguna pantalla captura.

---

## 7. Base de datos

**No se crea un almacén nuevo.** Se agregan cuatro cosas al esquema de Hermes, que ya tiene event
store y proyecciones:

| Tabla | Por qué |
|---|---|
| `mensaje_procedencia` | la compuerta; se escribe al ingresar, no al consultar |
| `clasificaciones` + `clasificacion_evidencia` | el contrato de `classification_schema_v0.json` |
| `taxonomia_definiciones` + `taxonomia_versiones` | la taxonomía versionada y migrable |
| `revisiones_humanas` | el conjunto dorado, que hoy no existe |

Y **se reusa**: `envios_wa` (procedencia de pieza, ya versionada por hash), `eventos_contacto`
(tipado), `conversiones_wa`, `icarus.*` en solo lectura.

⚠️ **No se replican los contactos.** GOBERNACRM ya demostró que un tercer padrón aporta 333
personas y un problema de sincronización.

---

## 8. Agentes: dónde sí y dónde no

| Pieza | Agente o servicio |
|---|---|
| Procedencia · entidades · señales · scoring · ranking | **servicio determinístico** |
| Clasificación del texto libre | **una llamada tipada**, no un agente |
| Inducción de taxonomía sobre clusters | **agente**, offline, con humano aprobando |
| Conversación con el lead | **agente** — ya existe (`bot/`), supervisado |
| Enriquecimiento / investigación | ❌ no hay caso de uso medido |

> **No se construye un «super agente».** Y de las siete cajas del pedido (Classifier, Research,
> Enrichment, Sales, Followup, CRM, Review), **cinco son servicios determinísticos**.

---

## 9. Riesgos

1. 🔴 **NO es que el corpus se apague: LA INGESTA ESTÁ ROTA.** La primera lectura fue «la línea que
   aporta el 66 % calló el 28-jul». La verificación adversarial lo corrigió, y el hecho corregido es
   peor: `max(occurred_at)` mide cuándo Hermes dejó de **ingerir**, no cuándo la línea dejó de
   operar. Comprobado **fuera de la base**: `/srv/hermes/server/.wa-sessions/51986394450.db` tiene
   su última escritura en el **segundo exacto** de su última fila; la misma firma se repite en
   `51941654039`, y `51944531711` tiene sesión del 27-jul y **cero filas en toda su historia**.
   **Tres de las cuatro sesiones whatsmeow están muertas y las tres siguen declaradas en
   `WHATSAPP_NUMEROS` con `activo=true`.** Los últimos 5 registros de la línea grande son 5
   salientes en el **mismo segundo** a 5 personas distintas: se cortó a mitad de una difusión.
   **Esto se arregla antes que nada.** No hay motor de inteligencia que compense una ingesta caída.
2. 🔴 **Este sistema ya fracasó dos veces por la misma razón**: nadie conectó el lazo de
   evaluación. `ai_feedback` = 0 filas con shadow mode prendido; 7 de 7 escalaciones sin notificar.
   *Si en la fase 1 no hay tablero de frescura y cola de revisión, no empieces la fase 2.*
3. **Tres taxonomías vivas y sin hablarse** en el sistema previo (86 tags regex · 31 intents de
   LLM · 12 tipos de `funnel_events`; sólo 6 de 95 plantillas cableadas). Reusarlas tal cual
   arrastra el conflicto.
4. **Deriva de producto de 10 años**: entrenar con 2016–2026 mezclado es entrenar sobre un negocio
   que ya no existe.
5. 🔴 **`n_purchases` NO miente — falta la ventana. Esto corrige una creencia escrita en el
   `CLAUDE.md` de Hermes.** La cifra bruta se reproduce (10.634 dicen haber comprado · 4.832 con
   venta · **5.802 sin respaldo = 54,56 %**), pero mide la **cobertura temporal del espejo**, no la
   veracidad del contador: **4.527 de los 5.802 (78 %) tienen su primera compra ANTES de que
   `icarus.sales` empiece**. Por año de primera compra, el desacuerdo es **100,00 % exacto en 2020,
   2021, 2022 y 2023**, 80,19 % en 2024, y cae a **0,68 % en 2025** y **2,06 % en 2026**.
   *Un 100,00 % exacto durante cuatro años seguidos es la firma de una ventana faltante, no la de
   un contador fabricado.* Dentro de la ventana que el espejo cubre de verdad, el desacuerdo real
   es **1,26 %**.
   **Consecuencia**: la regla «exigí una venta que lo respalde» sigue siendo correcta para
   etiquetar, pero **el motivo escrito en el repo es equivocado**, y con él la conclusión de que
   «el 55 % del padrón afirma compras que ninguna venta respalda». Lo que falta es historia, no
   veracidad.
6. **`sales` es multimoneda sin normalizar**: sumar el total produce una cifra sin significado.
7. **Sumar las tres fuentes de venta inventa ~21.000 ventas.** Son la misma venta espejada.
8. **Regla dura #7 de Goberna**: nada de esto autoriza envío masivo ni apertura en frío por
   whatsmeow. El motor **prioriza**; no manda.
