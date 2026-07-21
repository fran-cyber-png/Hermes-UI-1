# 21 — Goberna KOS Gen-2: el Sistema Operativo de IA

> Sesión 2026-07-16 (noche). Encargo: rediseño total de la plataforma como
> "Sistema Operativo de IA" para una consultora política, cuestionándolo todo,
> con horizonte de 5 años, pensado como producto licenciable. Este documento es
> la respuesta completa: veredicto sobre los 39 componentes pedidos, los
> anti-patrones del sistema actual con evidencia, la arquitectura nueva por
> capas con contratos, la comparación con los 11 sistemas de referencia, y el
> plan de asedio para llegar sin demoler lo que ya factura conocimiento.
>
> Continúa (y absorbe): docs/09 (CQ Engine), docs/19 (plan Ivi v3), docs/20
> (P0), la "iteración 1 del SO" (SDK + cuarentena del Capability Registry) y la
> ontología vigente (spec 2026-07-12).

---

## 0. El encargo — y los cuatro desafíos al encargo

Pediste que piense como OpenAI, Anthropic, Microsoft, Cursor, LangChain o AWS.
Acepto — y ahí está el primer desafío, porque **así es como piensan de verdad
esas casas**:

**Desafío 1 — Los grandes no tienen 39 componentes: tienen pocas primitivas
despiadadamente bien elegidas.** Unix ganó con *todo-es-un-archivo* + pipes.
Kubernetes es UNA idea (estado deseado + reconciliación) con N tipos de
recurso. Temporal es UNA idea (ejecución durable). Git es UNA idea (DAG de
objetos content-addressed). Anthropic corre productos de millones de usuarios
sobre infraestructura *aburrida*. La lista de 39 componentes que mandaste es un
inventario de **nombres del mercado**, no de **piezas necesarias** — y tratarla
como checklist es, en sí misma, el anti-patrón más caro de la lista ("módulos
con demasiadas responsabilidades" tiene un gemelo peor: *responsabilidades con
demasiados módulos*). Mi respuesta: los 39 nombres colapsan en **8 piezas de
kernel, ~15 filas de catálogo, ~6 disciplinas y ~7 rechazos con gatillo de
revival**. Cada nombre recibe su veredicto (§9) — ninguno se ignora.

**Desafío 2 — "No quiero cambios incrementales" confunde el salto con la
demolición.** El salto generacional está en el **modelo de cómputo** (§1: las
tres leyes) y en el **contrato** (§5: el ABI del kernel) — no en reescribir.
Tu propia regla dura #4 ya legisla esto: toda reescritura documenta qué
reemplaza y archiva al predecesor *al llegar a paridad*. Los grandes hacen
exactamente eso: la plataforma se **extrae** de productos vivos, jamás se
construye en el vacío. El diseño de este doc es una generación nueva; la
entrega es un asedio (§12), no un big bang.

**Desafío 3 — "Licenciable" no significa genérico: significa contratos.** Lo
que otra empresa podría licenciar de KOS no es un binario — es (a) el esquema
del kernel, (b) el SDK con sus syscalls, (c) el protocolo de manifests de
capacidad, (d) las tres leyes como marco de gobernanza. La prueba de
licenciabilidad no es hipotética: es que el **segundo tenant interno** —
Goberna Electoral (war-room, centurion, cartografía) — corra sobre el mismo
kernel que Escuela **sin forkearlo**. Si eso pasa, hay producto. Si no, no
había producto, había wishful thinking.

**Desafío 4 — Tu escala real hoy: 4 personas, 1 GPU de 16GB, datos batch con
días de rezago, 142K chars de dato crudo total.** La arquitectura debe hacer
**posibles** los cientos de capacidades, decenas de modelos y múltiples GPUs —
sin **pretender que existen**. Todo lo que sigue distingue: qué se construye
ya, qué queda como contrato listo para crecer, y qué gatillo lo despierta.

Lo único que declaraste intocable — *el modelo nunca calcula negocio, solo
redacta* — no solo se conserva: se asciende a constitución.

---

## 1. Las tres leyes (la filosofía de Ivi, ascendida a constitución)

Todo KOS se deduce de tres leyes. Cada pieza del kernel existe para hacer
cumplir al menos una; cada capacidad las hereda gratis.

**Ley I — Ley del Hecho.** *Todo número y todo hecho nace en código
determinista, versionado y testeado. Los modelos redactan, ilustran, traducen,
proponen — jamás originan hechos.* Toda cifra servida lleva etiqueta
HECHO / ESTIMACIÓN / SIN EVIDENCIA (ya vigente en Ivi; se extiende a todo
artefacto: el claim de un video sale de la capa de hechos, no del modelo que
lo guiona).

**Ley II — Ley del Efecto.** *Leer es libre; tocar el mundo exterior pasa por
UNA compuerta.* Todo lo que sale de la casa — escribir a Meta, enviar
WhatsApp, publicar una landing, mandar un mail, deployar — es un **efecto**:
pasa por evaluación de política, tiene modo simulación, exige dry-run cuando
es masivo, queda auditado y es idempotente. `DECISIONES_MODO=simulacion` fue
la primera ley II del sistema; hoy es un interruptor suelto — pasa a ser una
compuerta única (§6.4).

**Ley III — Ley de la Derivación.** *Todo producto es una función pura de
(snapshot de datos, capacidad@versión, modelo@versión, parámetros) —
content-addressed, cacheable, reproducible, auditable.* Es la generalización
exacta del caché P1 de docs/19 (clave = sha256 del prompt): si nada cambió,
no se recalcula; si algo cambió, la invalidación es *por construcción*, no
por TTL. Un análisis, un video, una landing y un reporte son la misma cosa:
**derivaciones**. Esto convierte a KOS en un *build system* del negocio — la
lección de Bazel/Nix aplicada a una consultora.

Corolario que responde tu anti-patrón favorito: el pipeline lineal de Ivi
(Intent→…→LLM) **no es el pecado**. Dentro de una capacidad, la composición
lineal de funciones puras es exactamente lo que la Ley III quiere (collect
cuesta 0,2s; checkpointear entre etapas de microsegundos es cargo cult). Los
pecados reales del sistema actual son otros — §3.

---

## 2. Radiografía: lo que hay, y qué ya es embrión del kernel

Lo que existe no es un demo de agente — es más sano de lo que el encargo
supone. Inventario honesto:

| Existe hoy | Qué es | Veredicto Gen-2 |
|---|---|---|
| `server/src/sdk/registro.ts` | SDK Governa + cuarentena de capabilities (iteración 1) | **embrión del Catálogo** |
| `goberna-kos/cqs/` (18 Capabilities, 105 CQs) | CQ Engine: QUÉ debe poder responder el sistema | **embrión del Catálogo** (la mitad "conocimiento") |
| `server/src/ontologia/derivarHechos.ts` | hechos derivados de eventos crudos | **embrión del Ledger** + Ley I |
| `server/src/lazo/worker.ts` + `DECISIONES_MODO` | worker CAPI con modos simulación/test/real | **embrión de Compuerta + Runtime** |
| `pauta_snapshots` + regla "recolecta limpia" | snapshots as-of con criterio de servibilidad | **embrión de la semántica as-of** (Ley III) |
| Ivi (pipeline 10 etapas, Python puro + tests) | la primera capacidad completa | **la capacidad de referencia** |
| P0 recién commiteado (37a8ba3) | systemd + `/api/health` + sesiones | **embrión del contrato de worker** |
| P1/P2 planeados (docs/19) | caché por huella + warmer | **embrión de derivaciones + scheduler** |
| engram (2.700+ observaciones) | memoria de desarrollo | **patrón probado para la Memoria** |
| esquemas `fuentes`/`ontologia` en Postgres | entidades y fuentes tipadas | **embrión del Conocimiento** |
| Runners GitHub por repo con labels | flota de ejecución etiquetada | **cultura de Worker Registry ya operando** |

La conclusión estratégica de la radiografía: **no hay que inventar el kernel —
hay que reconocerlo, nombrarlo y darle contratos.** Está naciendo disperso en
dos lenguajes y cuatro repos.

---

## 3. Anti-patrones encontrados (con evidencia y costo)

Los que pediste chequear, y los que encontré. Cada uno: qué, evidencia, costo.

1. **El doble cerebro.** La matemática del negocio vive DOS veces: en TS
   (`server/src/analisis/*.ts`, sirve dashboards) y en Python
   (`ivi/kpi_engine.py` + `analytics_engine.py`, sirve narrativa). Ya pagaste
   este anti-patrón: prod sirvió durante días un impact_engine desactualizado
   que decía "-54%" cuando la base comparable daba "+28%" (docs/18). Dos
   cerebros = dos verdades = una mentira garantizada a plazo. **El fix Gen-2:
   la métrica vive en SQL** (vistas/funciones `kos_metricas.*` versionadas);
   TS y Python *leen*, ninguno calcula (§12, K1).
2. **Capacidad fusionada a superficie.** "Analizar ventas" solo existe como
   chat (Ivi); el dashboard reimplementa. Una capacidad debe ser un paquete
   invocable desde N superficies (chat, dashboard, reporte, MCP, cron).
3. **Sin tenancy.** Escuela está hardcodeada como EL negocio. Cliente,
   campaña y proyecto no son dimensiones del sistema — son el eje de
   crecimiento real de una consultora (más clientes × más campañas, no más
   QPS). Este es el gap más caro del diseño actual frente a tus 5 años.
4. **Efectos con compuertas dispersas.** `DECISIONES_MODO` (env var), deploys
   (scripts SSH), WhatsApp (política en un doc), publicaciones (manuales). El
   instinto es correcto; falta LA puerta única con auditoría (Ley II).
5. **Memoria cuádruple sin contrato.** engram (dev), sesiones Ivi (in-proc),
   snapshots (pauta), `docs/*.md` (memoria organizacional de facto). Cuatro
   memorias, cero política de cuál manda ni cómo se consulta.
6. **El pasado muta en silencio.** Vouchers confirmados tarde (p90 3,9 días) +
   backfill Meta 37 meses. Lo resolviste UNA vez (recolecta limpia) para
   pauta; no es semántica global. Gen-2: todo dato lleva `valido_en` /
   `observado_en` (bitemporal liviano) y las derivaciones se cuelgan del
   snapshot, jamás de "la tabla ahora".
7. **Config con IP hardcodeada, sin identidad de servicio.**
   `ivi/config.py: BACKEND = "http://100.98.60.92:4100"`. Un cambio de red
   rompe prod en silencio.
8. **Trabajo sin cola.** El warmer será un thread dentro del server (P2), los
   backfills son scripts a mano, los renders Remotion/Flux se lanzan
   artesanalmente. Sin cola no hay reintentos, prioridades, checkpoints ni
   backpressure — y la GPU es UN recurso compartido peleado a codazos.
9. **Caché sin procedencia.** P1 lo arregla para respuestas de chat; el resto
   del sistema no sabe de dónde salió nada (¿este PNG con qué datos/modelo se
   generó?). Para una consultora política, procedencia no es lujo: es defensa
   legal y reputacional.
10. **Deploy sin gate de evals.** Prod mintió días porque nada comparaba
    "lo que responde" contra "lo esperado" al deployar. El smoke del paso 7/8
    del deploy actual es el embrión; falta el harness dorado como compuerta.
11. **Contexto artesanal y miedoso.** `prompt_builder` descarta el 92% del
    dato por una ventana autoimpuesta de 8K (el modelo soporta 40K). El
    problema del sistema NO es "contextos gigantes" — es contexto *raquítico
    ensamblado sin presupuesto explícito*. El Contexto Gen-2 ensambla bajo
    presupuesto declarado, con etiquetas de frescura y clase de dato.
12. **Los que NO encontré** (honestidad): lógica de negocio dentro del LLM
    (vuestra filosofía lo impidió — es la joya del sistema), dependencias
    circulares (no detectadas), herramientas sin contrato en TS (Zod ya
    disciplina el lado server; el lado Python no tiene contratos — a medias).

---

## 4. El colapso 39→8: la taxonomía

La operación intelectual central del rediseño: separar **qué es un proceso
corriendo** (kernel), **qué es una fila versionada** (catálogo), **qué es una
disciplina transversal** (se cumple en cada pieza, no se instala), y **qué se
rechaza con gatillo de revival escrito** (para que el futuro no re-litigue).

```
KERNEL (8 piezas que corren)          CATÁLOGO (filas, no servicios)
├─ 1. Catálogo (control plane)       ├─ capacidades      ├─ prompts
├─ 2. Runtime (cola+scheduler+       ├─ herramientas     ├─ workflows
│      workers+checkpoints)          ├─ modelos          ├─ agentes
├─ 3. Ledger (eventos+auditoría+     ├─ políticas        ├─ fuentes/corpus
│      costos+métricas)              ├─ workers (heartbeat) ├─ crontab
├─ 4. Compuerta de Efectos           └─ ontología (entidades/relaciones)
├─ 5. Inferencia (model gateway)
├─ 6. Contexto & Memoria             DISCIPLINAS (transversales)
├─ 7. Bóveda (artefactos+procedencia)├─ observabilidad (health+logs+ledger)
└─ 8. Puerta (API+MCP+auth)          ├─ seguridad (tailnet+identidades+secretos)
                                     ├─ evaluación (evals en cada manifest)
RECHAZADOS (con gatillo, §12)        ├─ versionado (semver+content-hash)
├─ broker de eventos (Kafka/NATS)    ├─ checkpointing (viene con Ley III)
├─ Temporal/Airflow/Prefect          └─ tenancy (scope en TODA fila)
├─ Kubernetes / service mesh
├─ A2A ├─ vector DB dedicada
├─ experiment engine ├─ OTel stack
```

**Sustrato** (debajo del kernel, todo aburrido a propósito): **Postgres 17
para todo** — catálogo, cola (`SKIP LOCKED`), ledger, memoria, conocimiento,
estado — hasta que un gatillo diga lo contrario; filesystem + `assets.goberna.us`
(→ R2 por gatillo) para bytes de artefactos; **Tailscale como la malla**
(identidad por nodo, cifrado, ACLs — ES el service mesh a esta escala);
**systemd como el supervisor de procesos** (patrón `ivi.service` recién
probado); Ollama + APIs cloud como plano de modelos.

---

## 5. La arquitectura por capas y el ABI del kernel

### Las capas

```
S5 SUPERFICIES   chat Ivi · dashboards React · reportes · CLI · MCP (Claude Code,
                 agentes externos) · webhooks entrantes · Mattermost (aprobaciones)
                 ── contrato: solo hablan la API de la Puerta (runs + catálogo-lectura)
S4 CAPACIDADES   paquetes versionados en userland: analizar.* investigar.* crear.*
                 publicar.* automatizar.* — cada uno manifest + core determinista +
                 slots generativos + evals
                 ── contrato: solo llaman syscalls del SDK; jamás sustrato directo
S3 KERNEL        Catálogo · Runtime · Ledger · Compuerta · Inferencia ·
                 Contexto&Memoria · Bóveda · Puerta
                 ── contrato: el ABI de abajo; único dueño del sustrato
S2 SUSTRATO      Postgres · FS/R2 · Tailscale · systemd · Ollama/APIs
S1 MUNDO         Cerberus · Meta · WhatsApp oficial · grupogoberna · VPS clientes ·
                 GPU geógrafo · bancos/vouchers · JNE/ONPE (lo electoral)
```

Regla de dependencia: **estricta hacia abajo**. Una capacidad no conoce
Postgres; una superficie no conoce capacidades (conoce *runs* de capacidades).
Reemplazar un modelo, mover un worker de servidor o cambiar Postgres por otra
cosa no toca S4/S5 — ese es el desacople que pediste.

### El ABI: 12 syscalls

Este es el contrato que hace al sistema un *sistema operativo* y no una app.
Cabe en una página a propósito — un ABI que no cabe en una página no es un ABI.

| # | Syscall | Firma conceptual | Garantías |
|---|---|---|---|
| 1 | `catalogo.resolver` | (tipo, id, restricción_versión) → definición | lectura versionada; nunca 404 silencioso |
| 2 | `derivar` | (capacidad@v, entradas, scope) → derivación | Ley III: hash de (código+datos+modelo+params); cache-hit no ejecuta; registra en ledger SIEMPRE |
| 3 | `cola.encolar` | (derivación \| efecto, prioridad, scope) → job_id | at-least-once + idempotencia por hash; checkpoints por paso |
| 4 | `programar` | (spec_cron \| "al llegar dump X", capacidad, scope) → regla | el scheduler es una fila + un tick |
| 5 | `ledger.registrar` | (evento tipado, scope, actor, causa) → seq | append-only, orden total, encadenado por hash |
| 6 | `medir` | (recurso, unidades, usd, scope) → — | costo SIEMPRE atado a derivación/efecto y scope |
| 7 | `contexto.armar` | (tarea, presupuesto_tokens, scope, clase_max_dato) → contexto etiquetado | jamás mezcla scopes (muralla china); declara frescura |
| 8 | `memoria.recordar / evocar` | (clase, contenido, scope) / (consulta, scope) → — / recuerdos | 3 clases (§6.6); una sola vía de escritura por clase |
| 9 | `inferir` | (necesidad: chat\|embed\|imagen\|video, clase_dato, presupuesto) → salida | el router elige modelo por política; PII jamás sale de la casa; medición automática |
| 10 | `efecto.solicitar` | (tipo, payload, scope, clave_idempotencia) → solicitud | Ley II: simulado→pendiente→aprobado→ejecutado; dry-run first para lo masivo |
| 11 | `artefacto.guardar / leer` | (bytes, tipo, procedencia, scope) → hash | content-addressed; sin procedencia no se guarda |
| 12 | `politica.evaluar` | (acción, contexto, scope) → permitir\|simular\|aprobar\|negar + motivo | evaluada AS-OF; el motivo queda en ledger |

El SDK (TS y Python, mismos nombres) implementa estos 12 y **nada más**. Todo
lo demás es userland.

---

## 6. El kernel, pieza por pieza

Formato por pieza: existe/por qué → responsabilidades → NO hace → habla con →
modo (sinc/async/eventos/colas/estado) → escala → prueba → observa → versiona.

### 6.1 Catálogo (control plane)

**Existe porque** hoy hay cuatro registros dispersos (CQ Engine, registro.ts,
Modelfiles, prompts en código) y "agregar una capacidad" toca el núcleo.
**Resuelve**: una sola fuente de verdad versionada de TODO lo declarable:
capacidades, herramientas (contratos MCP), modelos, prompts, políticas,
workflows, agentes, fuentes, crontab, workers. **Responsabilidades**: CRUD
versionado, validación de manifests contra schema, resolución con restricción
de versión, estados (borrador→canario→estable→archivado). **NO hace**:
ejecutar nada, guardar estado de runs, evaluar políticas. **Habla con**: todos
leen; escriben humanos y CI (nunca capacidades en runtime). **Modo**:
síncrono, lecturas cacheables en memoria de proceso con invalidación por
LISTEN/NOTIFY. **Estado**: Postgres (`kos_catalogo.*`). **Escala**: es
lectura-pesada y minúscula; no escala, sobra. **Prueba**: fixtures de
manifests válidos/ inválidos; contrato de resolución. **Observa**: cada
resolución con versión servida va al ledger (muestreado). **Versiona**:
semver en manifests + content-hash de cada versión (los prompts se *pinnean*
por hash en cada derivación — replay exacto).

### 6.2 Runtime (cola + scheduler + workers + checkpoints)

**Existe porque** hay trabajo de segundos (chat), de minutos (warmer, render
de video), de horas (backfills, investigaciones) y recurrente (cron) — y hoy
todo eso es threads, nohup y manos. **Resuelve**: ejecución durable con
reintentos, prioridades, checkpoints y atribución de recursos; la GPU deja de
pelearse a codazos. **Responsabilidades**: cola en Postgres (`FOR UPDATE SKIP
LOCKED`), workers systemd que se auto-registran con labels (`gpu`, `vram16`,
`render`, `efectos`, `mac`, `vps1`…), scheduler = tabla crontab + tick worker,
checkpoints = resultados de paso content-addressed en Bóveda (retomar = saltar
pasos con hash presente — semántica Temporal sin Temporal). **NO hace**:
decidir QUÉ correr (eso es catálogo+políticas), hablar con el mundo (eso es
Compuerta). **Modo**: asíncrono por definición; eventos de estado al ledger;
`derivar` corto puede ejecutar in-process (camino rápido del chat) — misma
semántica, sin viaje por la cola. **Estado**: Postgres. **Escala**: agregar
workers = instalar una unidad systemd en otra máquina del tailnet (el patrón
runner-por-repo que ya operás, generalizado). **Prueba**: harness con cola
efímera: reintento tras crash de worker, idempotencia (mismo hash dos veces =
una ejecución), prioridad, checkpoint-resume. **Observa**: `/api/health` por
worker (contrato P0 ya escrito), profundidad de cola y edad del job más viejo
como métricas cardinales. **Versiona**: el job registra capacidad@versión y
worker que lo corrió.

### 6.3 Ledger (eventos + auditoría + costos + métricas de sistema)

**Existe porque** hoy no hay historia: hay logs efímeros y tablas mutables.
Audit Layer, Event Bus, Cost Layer, Telemetry y Observability de tu lista son,
a esta escala, **la misma tabla bien diseñada**. **Resuelve**: ¿qué pasó, en
qué orden, quién lo causó, cuánto costó? — respondible SIEMPRE, incluso (sobre
todo) cuando prod miente. **Responsabilidades**: log append-only con orden
total, encadenado por hash (inmutabilidad demostrable — sos objetivo político:
tu auditoría debe resistir a un perito hostil); eventos tipados (dato_llegó,
derivación_{iniciada,cacheada,completada,fallida}, efecto_{solicitado,…},
política_evaluada, costo_medido); **outbox**: los consumidores (warmer,
detectores, notificadores) leen por LISTEN/NOTIFY + cursor propio — semántica
de bus sin broker; costos como eventos con rollups materializados por scope →
**margen por campaña/cliente** (esto convierte al Ledger en producto de
negocio, no solo forense: una consultora que sabe su margen por campaña en
vivo cobra mejor). **NO hace**: guardar bytes grandes (van a Bóveda), servir
dashboards en caliente (vistas materializadas). **Modo**: escritura síncrona
(parte de la transacción del que registra), consumo asíncrono. **Estado**:
Postgres, particionado por mes cuando duela. **Escala**: a tu volumen (batch,
decenas de usuarios) Postgres aguanta años; gatillo de broker en §12.
**Prueba**: replay determinista (reconstruir un estado desde eventos y
comparar), verificación de cadena de hashes. **Observa**: se observa a sí
mismo (es la observabilidad); alarma si la cadena se rompe o el reloj
retrocede. **Versiona**: esquemas de evento con `schema_version`, aditivos.

### 6.4 Compuerta de Efectos

**Existe porque** la Ley II sin una puerta única es un cartel de "portate
bien". Ya casi la construiste tres veces (CAPI, deploys, dry-run WhatsApp).
**Resuelve**: que "IA con manos" jamás signifique "IA sin frenos" — en una
consultora política un efecto malo no cuesta plata: cuesta la licencia social
del negocio. **Responsabilidades**: recibir `efecto.solicitar`, evaluar
política (syscall 12), decidir modo (simulado / auto-aprobado / requiere
humano), producir el **diff de dry-run** (destinatarios visibles para envíos
masivos — tu regla dura 7), publicar la tarjeta de aprobación en Mattermost
(`chat.goberna.us` — la infraestructura de aprobación YA existe), ejecutar con
clave de idempotencia, registrar todo. Tipos de efecto v1: `meta.capi`,
`meta.pauta` (presupuestos/estados), `web.publicar` (landings), `whatsapp.oficial`,
`correo`, `notificar` (Mattermost). **NO hace**: lógica de negocio (recibe
payloads ya decididos), reintentos ciegos de efectos no-idempotentes. **Modo**:
asíncrono con máquina de estados; `notificar` de bajo riesgo se auto-aprueba
por política. **Estado**: Postgres (`kos_efectos.solicitudes`). **Escala**: N
workers de efectos, pero **serializados por (tipo, scope)** — el orden importa
más que el throughput. **Prueba**: la de mayor valor del sistema: cada tipo de
efecto con su simulador dorado (¿qué HABRÍA hecho?); tests de política
(matriz acción×scope×modo). **Observa**: tasa simulado/real, latencia de
aprobación humana, efectos negados y por qué. **Versiona**: el payload guarda
la versión de la política que lo aprobó (defensa futura).

### 6.5 Inferencia (model gateway + model registry)

**Existe porque** "decenas de modelos" solo es gobernable si el modelo es
**dato, no código**: hoy `MODEL = "ivi-ventas"` está hardcodeado y Gemini
quedó como rama documentada apagada (P5). **Resuelve**: enrutar cada
`inferir` al modelo correcto por necesidad (chat/embed/imagen/video), clase de
dato, costo y disponibilidad — con fallback y medición. La regla que ya
decidiste, ahora ejecutable: **PII y P&L jamás salen de la casa** → el router
la cumple porque los modelos declaran `clase_max_dato` (ivi-ventas local:
`pii_electoral`; Gemini/Claude: `interno`) y el contexto llega etiquetado
(syscall 7). **Responsabilidades**: registry de modelos como filas (familia,
host, ctx, VRAM, costo/token, clases, scores de evals), colas por GPU
(NUM_PARALLEL como capacidad declarada del worker, no folklore), health del
plano de modelos, medición por llamada al ledger. **NO hace**: prompts
(Contexto), decidir contenido (capacidades). **Modo**: síncrono con timeout y
presupuesto; jobs largos (video) van por Runtime. **Estado**: sin estado
propio (registry en Catálogo, medición en Ledger). **Escala**: agregar GPU =
worker de inferencia nuevo con labels; agregar modelo cloud = fila nueva +
secreto referenciado. **Prueba**: router con modelos falsos (política de
clase, fallback, presupuesto agotado); evals por modelo contra los goldens.
**Observa**: latencia por modelo, cola por GPU, USD/día por proveedor, % local
vs cloud. **Versiona**: modelo@versión pinneado en cada derivación (cambia el
modelo → cambia el hash → cache inválida sola — Ley III trabajando gratis).

### 6.6 Contexto & Memoria

**Existe porque** el contexto artesanal (anti-patrón 11) y la memoria
cuádruple (anti-patrón 5) son la misma enfermedad: nadie es dueño de "qué sabe
el sistema al momento de pensar". **Resuelve**: ensamblado de contexto como
función presupuestada y auditable; memoria con clases y contratos.
**Las tres clases de memoria** (tus cinco nombres colapsan acá):
- **de trabajo** (short-term): la sesión conversacional — P0 la acaba de hacer
  thread-safe y por navegador; TTL corto, jamás persiste decisiones;
- **episódica** (project/organization memory): qué pasó y qué se decidió, por
  scope — el patrón engram generalizado a Postgres, escrita SOLO vía
  `memoria.recordar` (una vía de escritura = fin de la duplicación);
- **semántica** (knowledge): lo curado — documentos con dueño y frescura
  (Knowledge Registry = filas `fuentes`), la **ontología** (esquema ya
  existente, crecido a entidades/relaciones del mundo político: candidato,
  distrito, medio, encuesta, alianza — enlazable al geovisor), y embeddings
  **solo cuando un corpus no entra en el contexto de la tarea** (tu propia
  regla de docs/19: hoy el dato entra 28 veces — pgvector dormido hasta el
  gatillo).
**Responsabilidades del Contexto**: `contexto.armar(tarea, presupuesto,
scope, clase_max)` → selecciona de hechos + memoria + conocimiento, etiqueta
cada bloque (HECHO/…, frescura "datos hasta el D", clase de dato), respeta
murallas (jamás mezcla scopes de clientes distintos), y deja en el ledger QUÉ
entró al prompt (depurable: "¿por qué dijo eso?" tiene respuesta). **NO
hace**: llamar modelos, calcular hechos. **Modo**: síncrono, es una
biblioteca del SDK con tablas propias — no un servicio. **Escala**: con el
corpus. **Prueba**: presupuesto respetado, murallas (test de fuga entre
scopes — el test más importante de KOS), etiquetado completo. **Versiona**:
la *receta* de contexto de cada derivación queda content-addressed (replay).

### 6.7 Bóveda (artefactos + procedencia)

**Existe porque** vas a producir miles de piezas (imágenes Flux, videos
Remotion, landings, PDFs, decks) y hoy nadie sabe de qué datos/modelo/versión
salió cada una. **Resuelve**: almacenamiento content-addressed con
**procedencia obligatoria** (la derivación que lo produjo — sin procedencia
no se guarda, es un error). Para una consultora política, esto es el registro
que te deja demostrar ante un cliente, un medio o un juez qué generaste, con
qué insumos, cuándo y quién lo aprobó — tu C2PA casero, y una feature
licenciable por sí sola. **Responsabilidades**: guardar/leer por hash,
metadatos + scope, derivados (thumbnails) como derivaciones más, GC por
retención contractual por cliente (borrar-al-terminar-el-contrato es cláusula
real en política). **NO hace**: servir tráfico público (eso es
`assets.goberna.us`/CDN — la Bóveda es el origen). **Modo**: síncrono;
almacenamiento FS local → R2 por gatillo (la interfaz no cambia). **Prueba**:
round-trip, integridad de hash, negación sin procedencia, GC respeta
retención. **Observa**: bytes por scope, huérfanos. **Versiona**: no versiona
— es inmutable por hash (versionar es guardar otro hash).

### 6.8 Puerta (API + MCP gateway + auth)

**Existe porque** N superficies × M capacidades sin una puerta = acoplamiento
N×M. **Resuelve**: UNA API (runs: crear/estado/resultado/stream; catálogo:
leer; artefactos: leer firmado) con authN/Z por scope. Y el **MCP gateway**:
cada capacidad `estable` del catálogo se expone automáticamente como
herramienta MCP con su contrato — Claude Code (donde ya trabajás todos los
días) se vuelve la primera superficie agéntica de KOS sin escribir un agente;
agentes futuros, IDEs y hasta clientes externos consumen lo mismo. En
espejo, MCP servers de terceros se consumen registrándolos como herramientas
en el catálogo — sin tocar el núcleo. **NO hace**: lógica; es traducción +
permisos + rate limits. **Modo**: síncrono con SSE para streams. **Prueba**:
contratos de API + matriz de permisos por scope. **Observa**: runs por
superficie, latencias p95. **Versiona**: `/v1` estable; MCP hereda versión de
manifests.

---

## 7. Userland: el paquete de capacidad

La respuesta a "cientos de capacidades sin tocar el núcleo". Una capacidad es
un **paquete instalable** (carpeta versionada + fila en catálogo):

```yaml
# manifest.yaml — el contrato completo de una capacidad
id: analisis.ventas          # namespace.nombre
version: 3.1.0
scope_soportado: [org, cliente, campana]
contrato:
  entrada:  {pregunta: string, periodo?: rango, filtros?: mapa}   # JSON Schema
  salida:   {respuesta: markdown_etiquetado, hipotesis: [...], acciones: [...]}
necesita:
  hechos:    [kos_metricas.ventas_serie, kos_metricas.roas_pais]  # SQL, Ley I
  inferencia: {necesidad: chat, clase_dato: pii_electoral, presupuesto_tok: 16000}
  herramientas: []            # MCP ids si consume externas
  efectos: []                 # esta capacidad no toca el mundo
memoria: {lee: [episodica, semantica], escribe: [episodica]}
politicas: [pii-solo-local]
evals:                        # SIN esto no se promueve a estable
  goldens: tests/goldens/*.json          # las "5 preguntas doradas" de docs/19
  fidelidad_numerica: warn               # números de la salida ⊆ contexto
  presupuesto: {latencia_p95_s: 35, usd_max: 0.00}
ciclo: estable                # borrador → canario → estable → archivado
```

El mismo shape para productos radicalmente distintos — eso lo prueba:
`creativo.landing` (necesita: inferencia imagen+chat clase `interno`, efecto
`web.publicar`, evals: responsive + pixel wire-up), `pauta.fatiga` (necesita:
hechos de atribución, efecto `meta.pauta` con política `gasto>umbral→humano`),
`investigacion.actor_politico` (necesita: herramientas MCP de búsqueda,
memoria semántica, evals de citación). **Instalar** = validar manifest + evals
en verde + fila en catálogo. **El núcleo no se entera.** Los 18
capabilities/105 CQs del CQ Engine se convierten en la mitad "qué debe poder
responder" de estos manifests: el CQ Engine deja de ser un módulo aparte y
pasa a ser el *linter de completitud* del catálogo (¿qué CQ no tiene capacidad
que la cubra? = backlog).

Workflows = capacidades compuestas (DAG declarado de capacidades, checkpoints
gratis por Ley III). Agentes = fila que ata (prompt@hash + herramientas
permitidas + políticas + presupuesto) — un agente es *configuración*, no
runtime nuevo; el loop agéntico es una capacidad más que llama syscalls.

---

## 8. Tenancy y gobernanza política (lo que ningún framework genérico trae)

El eje de escala de una consultora es **clientes × campañas**, y su riesgo
existencial es **la confianza**. Por eso esto va en el kernel y no en una
"capa":

- **Scope en toda fila**: `(org, cliente, campaña, proyecto)` — catálogo,
  ledger, memoria, artefactos, costos, efectos. Sin scope no hay INSERT.
- **Murallas chinas**: dos candidatos rivales pueden ser clientes. La muralla
  se cumple donde es barata y verificable: `contexto.armar` jamás mezcla
  scopes; la memoria episódica/semántica se consulta por scope; los evals de
  fuga (¿aparece el dato del cliente A en una derivación del cliente B?)
  corren en CI.
- **Clases de dato**: `publico < interno < cliente < pii_electoral` — el dato
  se etiqueta al ingresar; el router de Inferencia y el Contexto las
  respetan mecánicamente (tu "nada del P&L sale de casa", ejecutable).
- **Procedencia de creativos** (Bóveda): toda pieza pública generada es
  trazable a insumos+modelo+aprobador. En año electoral, con deepfakes en la
  conversación pública, poder demostrar qué NO generaste vale tanto como lo
  que sí.
- **Aprobaciones humanas donde ya vivís**: tarjetas en Mattermost con diff de
  dry-run; aprobar escribe la fila y libera la Compuerta. El humano decide en
  10 segundos porque el sistema le muestra exactamente qué va a pasar.
- **Costo → margen**: cada derivación/efecto mide (GPU-s, tokens, USD ads,
  minutos humanos de aprobación) contra su scope → el reporte "margen por
  campaña" sale del Ledger sin proyecto nuevo. La gobernanza se paga sola.
- **Retención por contrato**: política por cliente (borrado al término,
  export entregable). El GC de la Bóveda y la memoria la ejecutan.

---

## 9. Los 39 componentes: tabla de veredictos

| Componente pedido | Veredicto | En KOS Gen-2 es… |
|---|---|---|
| Capability Registry | SÍ (filas) | `kos_catalogo.capacidades` — absorbe CQ Engine + registro.ts |
| Tool Registry | SÍ (filas) | `catalogo.herramientas` con contrato MCP |
| Knowledge Registry | SÍ (filas) | `catalogo.fuentes` (dueño, frescura, clase de dato) |
| Worker Registry | SÍ (filas vivas) | `catalogo.workers` con heartbeat + labels (cultura runner ya existente) |
| Model Registry | SÍ (filas) | `catalogo.modelos` (clases de dato, costo, ctx, host) servido por Inferencia |
| Policy Engine | SÍ (kernel) | syscall `politica.evaluar` + tablas; enforcement en Compuerta/Contexto/Inferencia |
| Context Engine | SÍ (kernel-lib) | syscall `contexto.armar` — presupuestado, etiquetado, con murallas |
| Execution Engine | SÍ (kernel) | Runtime §6.2 |
| Memory Engine | SÍ (kernel) | Memoria §6.6 — 3 clases, 1 vía de escritura por clase |
| Scheduler | SÍ (dentro de Runtime) | tabla crontab + tick worker; "al llegar dump" como trigger |
| Task Queue | SÍ (dentro de Runtime) | Postgres SKIP LOCKED; broker por gatillo |
| Event Bus | SÍ (como Ledger+outbox) | append-only + LISTEN/NOTIFY + cursores; broker por gatillo |
| Agent Registry | SÍ (filas) | agente = prompt@hash + herramientas + políticas + presupuesto |
| Prompt Registry | SÍ (filas) | prompts versionados por content-hash, pinneados por derivación |
| Workflow Registry | SÍ (filas) | DAGs declarados de capacidades |
| Evaluation Engine | SÍ (disciplina + runner) | evals obligatorias en manifest; runner en Runtime; **gate de promoción y de deploy** |
| Experiment Engine | NO (por ahora) | experimentos = capacidad de análisis + flags; Meta ya es tu motor A/B de pauta. Gatillo: >20 experimentos propios simultáneos |
| Observability Layer | SÍ (disciplina) | contrato `/api/health` (P0) + logs estructurados + Ledger; sin stack aparte |
| Telemetry Layer | SÍ (= Ledger) | eventos medidos; no hay segunda tubería |
| Metrics Layer | SÍ (= vistas del Ledger) | rollups materializados; Grafana opcional encima |
| Cost Layer | SÍ (= Ledger) | syscall `medir`; margen por campaña como producto |
| Governance Layer | SÍ (= Políticas+Compuerta+Ledger) | no es capa: es las tres leyes ejecutadas |
| Security Layer | SÍ (disciplina) | tailnet, identidades por servicio, secretos por referencia, clases de dato, cadena de hashes |
| Audit Layer | SÍ (= Ledger) | el ledger ES la auditoría; inmutable demostrable |
| Plugin Layer | SÍ (= paquete de capacidad) | un solo mecanismo de extensión |
| Extension Layer | NO como segunda vía | duplicar mecanismos de extensión es deuda instantánea |
| Service Mesh | NO | Tailscale + systemd ES la malla a esta escala. Gatillo: >10 servicios con authZ mutua fina |
| MCP Gateway | SÍ (en Puerta) | capacidades expuestas como MCP; MCP externos consumidos vía catálogo |
| A2A Communication | NO | coordinación via cola+ledger; no hay agentes pares autónomos que negocien. Gatillo: federación real con agentes de terceros |
| Artifact Storage | SÍ (kernel) | Bóveda §6.7 — content-addressed + procedencia obligatoria |
| State Store | SÍ (= Postgres) | no es componente: es el sustrato |
| Checkpoint Engine | SÍ (gratis) | pasos = derivaciones content-addressed; retomar = saltar hashes presentes |
| Long-term Memory | SÍ | = episódica + semántica (§6.6) |
| Short-term Memory | SÍ | = de trabajo (P0 la acaba de endurecer) |
| Semantic Memory | SÍ | = conocimiento curado + embeddings por gatillo |
| Project Memory | SÍ | = episódica con scope proyecto |
| Organization Memory | SÍ | = episódica/semántica con scope org |
| Knowledge Graph | SÍ (mínimo) | ontología poblada + joins SQL; graph-DB solo si las consultas de camino lo exigen (gatillo) |
| Ontology | SÍ (ya existe) | esquema `ontologia` crecido a entidades/relaciones políticas, enlazado al geovisor |

---

## 10. Tres jornadas por dentro (parada por parada, con ejemplo real)

### A. Martes 10:14 — «¿riesgos comerciales?» en el chat

1. **Puerta**: POST run `{capacidad: analisis.ventas, entrada: {...}, scope: (goberna, escuela)}`, sesión del navegador.
2. **Catálogo**: resuelve `analisis.ventas@3.1.0` estable + prompt@hash.
3. **Capacidad** (camino rápido, in-process): hechos desde `kos_metricas.*`
   (SQL — el único cerebro), detectores puros → hipótesis/acciones (Ley I).
4. **Contexto**: arma bajo presupuesto 16K, etiqueta HECHO/…, "datos hasta el
   2026-07-11", clase `pii_electoral`.
5. **`derivar`**: hash(código+snapshot+modelo+prompt+params) → **HIT** (el
   warmer pasó a las 06:00). No se toca la GPU.
6. **Ledger**: `derivacion_cacheada` (+0 USD). **Puerta**: respuesta en 0,4s.
   El usuario siente "Ivi instantáneo" — que es exactamente P1+P2 de docs/19:
   ese plan ES este diagrama en miniatura.

### B. Jueves 03:00 — llega el dump de Cerberus

1. **Ingesta** (capacidad `datos.cerberus`): normaliza, etiqueta clases,
   snapshot **as-of** con la regla recolecta-limpia; `ledger.registrar(dato_llegó, frescura=2026-07-16)`.
2. **Outbox**: el tick del Runtime despierta a los suscriptores del evento.
3. **Warmer**: las 12 frecuentes re-derivan (hashes cambiaron solos — Ley
   III); 12×27s de GPU, prioridad baja, 3 slots libres para humanos.
4. **Detectores** (`pauta.fatiga`, `analisis.anomalias`): corren como
   derivaciones; H1 encuentra ROAS México -38% con gasto plano.
5. **Efecto `notificar`** (clase bajo riesgo → auto-aprobado por política):
   tarjeta en Mattermost con el hecho, la hipótesis y la acción sugerida
   citando su insight (id) e impacto en USD.
6. A las 08:30 el equipo abre el chat: todo ya está pensado y tibio. **La
   "inferencia en background" que pediste en v3 es esto, generalizado.**

### C. «Generá 3 landings del diplomado para México y publicá la mejor»

1. **Puerta→Runtime**: workflow `creativo.landing.torneo` (3 derivaciones en
   paralelo, labels `gpu` para Flux + redacción con clase `interno` — puede
   usar modelo cloud, no hay PII).
2. Cada landing = **artefacto** en Bóveda con procedencia (datos del curso,
   modelo, prompt@hash, versión de capacidad).
3. **Evals automáticas** como pasos: responsive (mobile/desktop), pixel/form
   wire-up, peso de página. Una candidata cae (CTA cortado a 1366×768 — tu
   clase de bug conocida); quedan 2.
4. Humano elige en la UI (o política: torneo lo decide un juez-derivación).
5. **`efecto.solicitar(web.publicar, grupogoberna.com/...)`** → política:
   publicar a dominio productivo = **aprobación humana** → tarjeta Mattermost
   con **diff de dry-run** (URL staging, screenshot, pixel events que va a
   disparar) → aprobado por Estephano 14:02 → ejecución idempotente →
   `ledger`: quién, qué, cuándo, costo total de la jornada (GPU 11 min +
   Claude $0,84 + 0 USD ads) contra `(goberna, escuela, campana:diplomado-mx)`.
6. Fin de mes: el margen de la campaña incluye ese costo sin que nadie haga
   una planilla.

---

## 11. Préstamos y rechazos: los 11 sistemas de referencia

| Sistema | Se roba | Se rechaza |
|---|---|---|
| **LangGraph** | grafos con checkpoint + interrupt/resume para humano-en-el-loop (nuestros workflows+Compuerta lo dan) | el runtime como framework en tu proceso; orquestación atada a Python |
| **MCP** | **se adopta entero** como ABI de herramientas: capacidades expuestas como MCP, externas consumidas como filas | nada — es el estándar correcto y ya vivís dentro de él (Claude Code) |
| **Agent Protocol** | la forma REST de runs/threads para la Puerta | como capa aparte: queda subsumido |
| **Event-driven (puro)** | outbox, append-only, consumidores idempotentes con cursor | broker-primero; coreografía para efectos (los efectos se ORQUESTAN — el orden y la culpa importan) |
| **Microservicios** | bounded contexts, contratos en las costuras | partir por red por defecto. KOS es **monolito modular + workers**; las DOS costuras de red reales: inferencia (GPU está en otra máquina) y efectos (aislamiento de blast radius) |
| **Sistemas operativos** | kernel/userland, syscalls, permisos, *todo-es-una-derivación* (nuestro todo-es-un-archivo) | microkernel-purismo; drivers = capacidades de ingesta |
| **Motores de juego (Unity/Unreal)** | el **asset pipeline** (import→process→bundle con procedencia = la Bóveda), ECS (entidades = cliente/campaña/candidato; las capacidades les *adjuntan* comportamiento), el editor como producto (el war-room electoral ES el editor de KOS) | el frame-loop de tiempo real: nuestro tick es el dump y el cron |
| **Kubernetes** | estado deseado + reconciliación (catálogo=deseado, workers reconcilian), CRDs (=manifests), labels/selectors (=workers) | correr K8s. systemd + tailnet dan el 95% a 4 personas. Gatillo: >3 nodos heterogéneos con scheduling dinámico real |
| **Airflow** | data-interval como semántica (la derivación se ata al intervalo del dato, no al reloj), backfill como ciudadano de primera (vivís backfilleando) | el monolito-scheduler con UI como centro de gravedad |
| **Temporal** | la **semántica** de ejecución durable: idempotencia, replay determinista, historia por workflow — implementada como disciplina en cola+checkpoints | el cluster hoy. Gatillo: sagas multi-servicio o >50 workflows concurrentes de >1h |
| **Prefect** | "negative engineering lo absorbe la plataforma": el autor de capacidades escribe el happy path, KOS pone reintentos/timeouts/presupuestos | otro orquestador que cuidar |

---

## 12. El asedio: K0 → K3

El salto se entrega por **anillos**, cada uno útil solo. P1–P4 de docs/19 no
se tiran: **se re-etiquetan como el primer habitante del kernel** (regla de
extracción: nada entra al kernel sin dos consumidores reales — Ivi es el
primero, el segundo lo eligen los anillos).

**K0 — el kernel nace de trabajo ya planeado (2 semanas, convive con P1/P2)**
- Esquemas `kos_catalogo`, `kos_ledger`, `kos_cola` en el Postgres existente.
- P1 (answer cache) registra hit/miss como eventos → primer uso del Ledger.
- P2 (warmer) se encola como job recurrente → primer uso de cola+crontab.
- Manifest de `analisis.ventas` como primera fila (absorbe sus CQs).
- `/api/health` (P0, hecho) queda declarado contrato de todo worker futuro.
- **Criterio de éxito**: el chat de Ivi no cambió para el usuario; el ledger
  ya cuenta la historia.

**K1 — matar el doble cerebro + la Compuerta (este trimestre)**
- **La métrica vive en SQL**: `kos_metricas.*` (vistas+funciones versionadas,
  testeadas con fixtures); `analisis/*.ts` e `ivi/kpi_engine.py` pasan a
  *leer*. Primer test de paridad TS≡Python≡SQL, después se borra el cálculo
  duplicado (regla dura 4: ADR + archivo del predecesor).
- Compuerta v1 absorbiendo CAPI (retrofit de `lazo/worker.ts` — ya tiene
  modos) + `web.publicar` + `notificar` con tarjetas Mattermost.
- Puerta v1: API de runs + **3 capacidades expuestas por MCP** (probalas
  desde Claude Code — dogfooding inmediato).
- Costos v1: medición de GPU/tokens por derivación.
- **Criterio**: cero envíos a Meta fuera de la Compuerta; primer reporte de
  costo por capacidad.

**K2 — la flota y la fábrica (este año)**
- Workers systemd en geógrafo + VPS1/2 + Mac con labels; scheduler formal.
- Bóveda content-addressed con procedencia (Flux/Remotion/landings entran).
- Memoria unificada (engram-pattern a Postgres, 3 clases, scopes).
- Evals como gate de promoción y de deploy (el harness dorado de docs/19 P4
  generalizado).
- Tenancy completo: scope en toda fila; murallas testeadas en CI.
- Ontología política poblada (candidato/distrito/medio/alianza) enlazada al
  geovisor; el CQ Engine como linter de completitud.
- Segundo tenant: **Goberna Electoral** (war-room) sobre el mismo kernel.
- **Criterio**: margen por campaña en vivo; una capacidad nueva se instala
  sin tocar núcleo (medirlo: PRs de capacidad tocan 0 archivos del kernel).

**K3 — por gatillo, no por calendario**

| Pieza dormida | Gatillo que la despierta |
|---|---|
| Broker (NATS/Kafka) | >100 ev/s sostenidos o ≥3 consumidores que Postgres no acompaña |
| Temporal | sagas multi-servicio reales o >50 workflows concurrentes >1h |
| Kubernetes | >3 nodos heterogéneos con scheduling dinámico genuino |
| Vector DB dedicada | corpus fuera-de-contexto por tarea Y pgvector >10M vectores o p95>200ms |
| R2/S3 para Bóveda | FS >500GB o necesidad de servir multi-región |
| OTel completo | >3 servicios y debugging cross-servicio semanal |
| Service mesh | >10 servicios con authZ mutua fina |
| Graph DB | consultas de camino/centralidad que SQL recursivo no da |

---

## 13. Riesgos honestos del diseño (qué mataría a KOS)

1. **Plataforma sin segundo consumidor** = museo. Mitigación: regla de
   extracción (dos consumidores reales o no entra al kernel) + el segundo
   tenant electoral como prueba de fuego con fecha.
2. **El catálogo como burocracia** (manifests que nadie mantiene). Mitigación:
   el manifest se valida en CI y se genera asistido; si duele, es demasiado
   grande — recortarlo, no abandonarlo.
3. **Kernel sin dueño operativo** (son 4 personas). Mitigación: kernel
   aburrido a propósito — Postgres+systemd+Tailscale, cero tecnología que
   exija un SRE dedicado. Todo K3 tiene gatillo escrito para resistir el CV-
   driven development.
4. **Gobernanza teatral** (políticas que todos bypassean por SSH). Mitigación:
   el camino gobernado debe ser el camino FÁCIL (el SDK hace lo correcto por
   defecto); el bypass se audita (drift prod≠ledger alarma — regla dura 6).
5. **Sobre-plataformizar antes de facturar**: cada anillo K debe pagar su
   costo con un beneficio de negocio visible (K0: Ivi instantáneo; K1: fin de
   las mentiras de prod + Compuerta; K2: margen por campaña + fábrica
   creativa). Si un anillo no paga, se detiene el asedio — el sistema queda
   útil en cada corte.
6. **Datos políticos = objetivo**. PII electoral cifrada at-rest, clases de
   dato mecánicas, retención contractual ejecutable, y el ledger encadenado
   como evidencia. La seguridad de KOS se audita con el mismo harness que
   todo lo demás.

---

## Cierre

El salto generacional no está en agregar 39 cajas — está en **tres leyes, 12
syscalls y 8 piezas aburridas** que convierten lo que ya demostraron tus
propios docs (el modelo no calcula; los efectos se gatean; si nada cambió, no
se regenera) en la constitución de TODO lo que Goberna produzca los próximos
cinco años: análisis, video, landings, campañas, estrategia. Ivi deja de ser
el producto — pasa a ser la primera ciudadana de un sistema operativo cuyo
segundo ciudadano (electoral) prueba que es licenciable.

*Siguiente decisión que te pido: aprobar K0 (2 semanas, convive con P1/P2 ya
planeados) — o discutir el anillo que te haga ruido.*
