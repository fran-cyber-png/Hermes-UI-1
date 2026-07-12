# Reality Gaps

> Documento vivo. No es un spec, no es un backlog, no es una lista de TODOs.
> Es el registro de **lo que el modelo afirma sin haberlo observado**.
>
> Una deuda epistemológica, no técnica.

---

## Las dos leyes

> **1. Nunca diseñes el transporte antes de encontrar aquello que va a transportar.**
>
> **2. El modelo no crece por imaginación. Crece por evidencia.**

Y el orden, siempre:

```
Observar  →  Nombrar  →  Modelar  →  Automatizar
```

---

## Las dos clases de concepto (y por qué la distinción importa)

No todo se puede observar antes de construir. Confundir las dos clases produce dos errores
opuestos, y ambos matan proyectos.

### Tipo A — Hechos del mundo. **Se verifican ANTES de programar.**

Existen o no existen, independientemente de nuestro sistema. Si damos por sentado uno que no
existe, construimos una tubería vacía.

*¿Existe una venta? ¿Existe un community manager trabajando? ¿Existe una conversación?
¿Existe WhatsApp conectado? ¿Meta nos dio el permiso?*

### Tipo B — Propiedades emergentes. **Se descubren USANDO el sistema.**

No se pueden observar antes porque no existen hasta que el sistema vive. Exigirles evidencia
previa es lo que impide que nazcan.

*El vocabulario real de lo que la gente pregunta. Qué se siente urgente y qué no. Cómo se ve
una fusión mal hecha. Qué estados hacen falta de verdad.*

**La regla:** un Tipo A sin verificar **bloquea**. Un Tipo B sin verificar **se construye barato,
se observa, y se corrige**.

---

## Los estados del conocimiento

Un gap no se "hace". **Avanza de estado.** Un checklist miente; un estado no.

```
UNKNOWN → HYPOTHESIS → OBSERVED → VERIFIED → MODELED → IMPLEMENTED → MONITORED
```

**La regla con dientes:**

> **El modelo solo acepta entidades en estado `VERIFIED`. Todo lo demás vive acá.**

Si esta regla hubiera existido ayer, la tabla `conversiones` **no habría entrado al spec** como si
fuera un hecho. Es `HYPOTHESIS`, y es el centro del diseño.

## Los tipos de gap (y por qué cambian dónde buscas)

No es taxonomía decorativa: **el tipo determina la fuente de evidencia.**

| Tipo | Pregunta | Dónde se resuelve |
|---|---|---|
| **Existencia** | ¿Existe? | Código, base de datos, API |
| **Ubicación** | ¿Dónde vive? | Código, sistemas, personas |
| **Relación** | ¿Cómo se conecta con lo demás? | Código + base + API cruzados |
| **Comportamiento** | ¿Cómo funciona de verdad? | **Observación humana.** No hay `grep` que lo responda |
| **Medición** | ¿Cómo sabremos que cambió? | Diseño de experimento |
| **Responsabilidad** | ¿Quién lo mantiene? | Personas |
| **Temporalidad** | ¿Cuándo cambia? | Logs, histórico |
| **Confianza** | ¿Qué tan seguros estamos? | Metadato de todo lo anterior |

RG-002 es de **Comportamiento**. Por eso no se cierra con un agente: se cierra sentándose dos
horas al lado de quien atiende.

## Estado del registro

| ID | Suposición | Clase | Tipo | Estado | Importancia |
|---|---|---|---|---|---|
| [RG-001](#rg-001) | Existe un registro de ventas | **A** | Existencia | 🔍 `UNKNOWN` → buscando | **Crítica** |
| [RG-002](#rg-002) | Existe un flujo de community manager | **A** | **Comportamiento** | `UNKNOWN` | **Crítica** |
| [RG-003](#rg-003) | Meta aprueba `human_agent` | **A** | Existencia | `HYPOTHESIS` — no solicitado | **Crítica** |
| [RG-004](#rg-004) | Meta aprueba `page_events` | **A** | Existencia | `HYPOTHESIS` — no solicitado | **Crítica** |
| [RG-005](#rg-005) | Los comentarios están sobre posts promocionados | **A** | Relación | `HYPOTHESIS` — 0/8, sin barrer | Alta |
| [RG-006](#rg-006) | Los "teléfonos" en el texto son teléfonos | **A** | Confianza | `HYPOTHESIS` — regex sin validar | Alta |
| [RG-007](#rg-007) | Existe WhatsApp conectado | **A** | Existencia | `UNKNOWN` — cero mensajes | Media |
| [RG-008](#rg-008) | Un curso tiene un precio conocido | **A** | Ubicación | 🔍 `UNKNOWN` → buscando | Alta |
| [RG-009](#rg-009) | El vocabulario de `hechos` refleja lo que dicen | **B** | Comportamiento | `HYPOTHESIS` — copiado de papers | Media |
| [RG-010](#rg-010) | Hay identidades basura que fusionan mal | **B** | Existencia | `HYPOTHESIS` | Baja |
| [RG-011](#rg-011) | Alguien va a querer una inferencia | **B** | Existencia | `HYPOTHESIS` — nada la puebla | Baja |
| [RG-012](#rg-012) | Existe (o existirá) un bot respondiendo | **B** | Existencia | `HYPOTHESIS` — no hay bot | Baja |
| [RG-M001](#rg-m001) | **Existe un proceso estable para convertir incertidumbre en conocimiento** | **B** | Comportamiento | `HYPOTHESIS` — **N=1** | Alta |

**Estado del modelo, dicho sin adornos:** de 13 suposiciones, **cero están en `VERIFIED`.**
El spec está construido íntegramente sobre hipótesis. Eso no lo invalida — lo ubica.

---

## RG-001

**Suposición.** Existe, en algún sistema de Goberna, el registro de que una persona compró.

**Estado.** 🔍 En verificación (búsqueda en los repos: LMS, CRM, icarus, cerberus).

**Clase.** A — hecho del mundo.

**Importancia.** **Crítica. Es el cimiento.**

**Por qué duele.** El spec entero (`2026-07-12-ontologia-goberna-design.md`) declara que el
sistema existe para saber quién compró y decírselo a Meta. La tabla `conversiones` es su centro.
Diseñé la tubería completa —normalización, hasheo, idempotencia, reintentos, dataset— para
transportar un dato **que nunca verifiqué que exista**.

**Qué pasa según la respuesta:**
- *Existe, con correo o teléfono* → el lazo se puede cerrar. El plan sigue como está.
- *Existe, sin forma de unirlo a un lead* → el primer trabajo es construir ese puente, no CAPI.
- *No existe en ningún lado* → **el paso 1 del proyecto no es programar. Es conseguir que exista
  una venta registrada.** Y eso probablemente no es código.

**Acción.** Encontrar dónde vive el hecho "compra". Primero en el código; solo si el código no
responde, hablar con personas.

---

## RG-002

**Suposición.** Existe un flujo de trabajo de community manager que el sistema debe apoyar.

**Estado.** ❌ Nunca observado.

**Clase.** A.

**Importancia.** **Crítica.**

**Por qué duele.** Hay **una** respuesta registrada en 94.371 interacciones. Una. Estoy modelando
bandejas, colas, semáforos, asignación, estados y ventanas **para un trabajo que nunca vi hacer
a nadie**. Toda la sección 7 del spec (ventanas, estados, asignación advisory) es teoría sobre
un oficio que no observé.

**Acción.** Sentarse dos horas al lado de quien atiende y **mirar**. No preguntar qué necesita —
mirar qué hace. Qué abre primero. Qué ignora. Dónde se traba. Qué copia y pega.

---

## RG-003

**Suposición.** Meta nos va a dar `human_agent`.

**Estado.** ⏳ No solicitado. Confirmado ausente vía `debug_token`.

**Clase.** A.

**Importancia.** **Crítica.**

**Por qué duele.** Sin este permiso la ventana de Messenger es de **24 horas**, no de 7 días. Eso
significa que a las **34.118 conversaciones históricas no se les puede escribir, jamás**. El
backlog no es una cola de trabajo: es un archivo. Toda la bandeja de Messenger que el spec
describe depende de un permiso que no pedimos.

**Acción.** Iniciar App Review + Business Verification. Es trámite, no código, y bloquea todo lo
demás. Cada día que no se pide es un día perdido.

---

## RG-004

**Suposición.** Meta nos va a dar `page_events`.

**Estado.** ⏳ No solicitado. Probado: `GET /{PAGE_ID}/dataset` → `403: "App does not have
page_events permission on the Page"`.

**Clase.** A.

**Importancia.** **Crítica.**

**Por qué duele.** Sin `page_events` no hay Dataset, y sin Dataset **no hay Conversions API for
Business Messaging**. El lazo para Messenger y WhatsApp está cerrado.

**Mitigación conocida:** los 680 leads **no lo necesitan** — CAPI estándar con `lead_id` funciona
con el token actual. El lazo puede empezar sin esperar a Meta. Pero solo para ese 0,7%.

**Acción.** Solicitarlo junto con RG-003.

---

## RG-005

**Suposición.** Los 14.736 comentarios de Facebook están sobre posts promocionados, y por lo
tanto se pueden atribuir a anuncios vía `effective_object_story_id`.

**Estado.** ❌ Probado con los 8 anuncios de leads: **0 coincidencias**. Son dark posts
(`is_published: false`, cero comentarios). Falta barrer los anuncios de las 19 cuentas.

**Clase.** A.

**Importancia.** Alta.

**Por qué duele.** Es la única forma de decirle al pauteador y al creativo **qué anuncio genera
conversación**. Si ningún comentario está sobre un post promocionado, ese valor desaparece y la
tabla `atribuciones` pierde su mecanismo `post_promocionado`.

**Acción.** Enumerar todos los anuncios de las 19 cuentas, sacar sus `effective_object_story_id`,
y cruzarlos contra los `contexto_id` de la tabla. Es una consulta, no un diseño.

---

## RG-006

**Suposición.** El 23,7% de las interacciones (22.325) contiene un teléfono, y eso es el puente
entre Messenger y los leads.

**Estado.** ❌ Sin validar. Es un regex de 8+ dígitos.

**Clase.** A.

**Importancia.** Alta.

**Por qué duele.** Ese regex captura DNI, precios, años, códigos de curso y números de WhatsApp
ajenos. **Es el único puente cross-canal que tenemos**, y no sabemos si es un puente o una
alucinación. Si el 80% son falsos positivos, la fusión por teléfono es una fábrica de personas
mal unidas — exactamente el desastre que `vinculos_identidad` intenta poder deshacer.

**Acción.** Tomar 100 casos al azar y leerlos con ojos humanos. Contar cuántos son un teléfono
peruano/mexicano/chileno de verdad. Es una tarde de trabajo y decide si la regla `telefono` de
fuerza débil sirve o se descarta.

---

## RG-007

**Suposición.** WhatsApp es un canal de Goberna.

**Estado.** ❌ Cero mensajes en la base. La columna dice "Sin conectar".

**Clase.** A.

**Importancia.** Media — pero crece si el negocio depende de WhatsApp.

**Por qué duele.** El spec modela `wa_id`, `ctwa_clid` y el canal `whatsapp` en `hilos`. **No
tenemos ni un solo mensaje de WhatsApp.** Estoy modelando un canal que no existe todavía, basado
en lo que dice la documentación de Meta.

**Nota:** el teléfono de WhatsApp sería la **única identidad fuerte** que compartiría con los
leads. Es potencialmente el puente que resuelve RG-006. Pero hoy es una hipótesis.

**Acción.** Averiguar si Goberna usa WhatsApp Business hoy, con qué número, y si está en la
Cloud API o en la app gratuita (la app gratuita **no da webhooks ni `ctwa_clid`**).

---

## RG-008

**Suposición.** Un diplomado tiene un precio conocido, en una moneda conocida.

**Estado.** 🔍 En verificación.

**Clase.** A.

**Importancia.** Alta.

**Por qué duele.** El lazo de CAPI manda `custom_data: { value, currency }`. La **value-based
optimization** —hacer que Meta busque gente que gasta más, no solo gente que compra— depende de
mandar el valor real. Sin precio, el lazo funciona a medias.

Complicación: son 6 países con 6 monedas, y probablemente cuotas.

**Acción.** Encontrar el precio en el código, en las landings, o preguntarlo. Va junto con RG-001.

---

## RG-009

**Suposición.** La gente pregunta por precio, fechas, certificación; expresa compromiso; declara
objeciones. El vocabulario de `hechos` (`pregunto_precio`, `menciono_objecion`…) refleja eso.

**Estado.** ❌ Copiado de la literatura académica. **No leí un solo mensaje nuestro.**

**Clase.** **B** — emerge del uso.

**Importancia.** Media.

**Por qué NO bloquea.** Este vocabulario no se puede inventar bien desde afuera, pero tampoco
hace falta acertarlo antes de construir. Se construye barato (es una lista de strings), se mira
qué dice la gente de verdad, y se corrige.

**Pero hay una acción barata y obvia:** tenemos 94.371 textos reales. **Leer 200 al azar** y ver
qué preguntan de verdad. Probablemente descubramos categorías que ningún paper menciona —
"¿es presencial?", "¿dan certificado del Ministerio?", "¿puedo pagar en cuotas?" — y que dos o
tres de las que copié no existen.

---

## RG-010

**Suposición.** Hay correos y teléfonos institucionales (`informes@`, centralitas) que fusionarían
decenas de personas en una.

**Estado.** ❌ Nunca observado. Copiado del modelo de Segment.

**Clase.** **B.**

**Importancia.** Baja hasta que pase.

**Por qué NO bloquea.** La tabla `identidades_bloqueadas` cuesta cinco líneas. El daño que
previene es real y documentado en otros. Se construye vacía y se llena cuando la realidad la
llene.

---

## RG-011

**Suposición.** Va a hacer falta una capa de inferencias (score, etapa, intención).

**Estado.** ❌ Nada la puebla. Es un hueco para un futuro imaginado.

**Clase.** **B.**

**Importancia.** Baja.

**Riesgo real:** que se construya la tabla y nadie la use nunca. Es el antipatrón clásico.

**Decisión:** la separación hecho/inferencia **sí es un principio que se sostiene** (evita que
una opinión de modelo contamine el registro). Pero **la tabla no se crea hasta que exista la
primera inferencia que alguien pida**. El principio se respeta; la tabla espera.

---

## RG-012

**Suposición.** Va a haber un bot respondiendo, y hay que registrar si fue bot o humano.

**Estado.** ❌ No hay ningún bot.

**Clase.** **B.**

**Importancia.** Baja hoy. **Enorme el día que se prenda un bot.**

**Por qué se construye igual:** el campo `mensajes.autor` cuesta una columna. Y el efecto es el
más grande de toda la literatura de conversión: revelar que es un bot **reduce las compras un
79,7%** (Luo et al., 2019, *Marketing Science*, experimento de campo con 6.200 clientes).

Si no registramos quién respondió desde el día uno, el día que se prenda un bot **no vamos a poder
medir su efecto**, y la decisión ética se tomará a ciegas. La columna es barata; la ceguera no.

---

## RG-M001

**Suposición.** Existe un proceso estable para convertir incertidumbre en conocimiento — y ese
proceso se puede especializar en agentes.

**Estado.** `HYPOTHESIS`. **Un solo ciclo observado.** N=1.

**Clase.** B — solo se descubre usándolo.

**Tipo.** Comportamiento.

**Por qué está acá.** Toda metodología debe poder investigarse con su propia metodología. Si se
exceptúa a sí misma, deja de ser método y pasa a ser dogma. Este registro se aplica al registro.

**La hipótesis descartada (por ahora).** Se propuso un pipeline de agentes especializados **por
rol epistemológico**: Gap Hunter → Evidence Hunter → Validator → World Journal Writer → World
Model Architect → Impact Analyzer → Planner.

**Lo que la evidencia del N=1 muestra:** los agentes que funcionaron **no estaban especializados
por rol. Estaban especializados por FUENTE DE EVIDENCIA.** Y dos roles del pipeline propuesto
resultaron no necesitar un agente:
- El **Gap Hunter** fue una lectura del spec preguntando "¿qué realidad obligó a esta tabla?".
  Una pasada, cero agentes, y encontró que la tabla central no tenía evidencia.
- El **World Model Architect** es la conversación misma.

**Lo que sí se observó como real:** el rol de **Validator** existió (verificación adversarial de
tres votos en el deep research) y **mató casi todo lo que le pasó**. Ese rol está probado.

**Acción.** Repetir cinco veces. Llenar la tabla de abajo. **No construir nada hasta entonces.**

**Criterio de aceptación.** Que aparezcan patrones estables en: tipos de gap, fuentes de
evidencia, estados del conocimiento, y cambios reales al modelo.

**Prohibición explícita.** No se le pone nombre todavía. Un nombre bonito para algo que no sabemos
si existe es la forma más rápida de dejar de investigarlo.

---

## El libro mayor de la evidencia

La única forma de saber qué fuentes sirven es **anotar cuáles sirvieron**. Esta tabla se llena
después de cada ciclo, no antes.

### Ciclo 1 — 2026-07-12 · Ontología Goberna

| Gap | Fuente | ¿Encontró evidencia? | ¿Cambió el modelo? | Qué produjo |
|---|---|---|---|---|
| Varios | **Nuestra propia base de datos** | ✅ | ✅✅ | Reacciones sin identidad, comentarios anónimos, `conversation_id` existe, **el bug de los salientes**, el puente del teléfono en el texto |
| Varios | **API real de Meta** | ✅ | ✅✅ | **Faltan `human_agent` y `page_events`** — el hallazgo que cambió la operación, no solo el diseño |
| Varios | Documentación oficial | ✅ | ✅ | CAPI Business Messaging, **la frontera legal (3.a.v)**, retención real de audiencias |
| Varios | Papers académicos | ✅ | ✅ | Mató el event sourcing. Mató la atribución multi-touch. Reveló que **nadie sabe des-fusionar** |
| Varios | Psicología (papers) | ✅ | ✅ | Mató el "×21". Dio la separación **hecho/inferencia**. Dio el campo `autor = bot` |
| Varios | Repos (Chatwoot, SDKs) | ✅ | ✅ | Validó el modelo de identidad por convergencia. Nadie modela atribución |
| Varios | Ontologías de industria | ✅ | ✅ | **Fuerte vs débil**. CampaignMember. Los antipatrones |
| Varios | Foros | ⚠️ parcial | ⚠️ | Riesgo de ban del comment-to-DM (real). **Reddit y Stack Overflow bloqueados** |
| Varios | Deep research (109 agentes) | ✅ | ✅ | **El RCT de los 70.000 anunciantes.** Y la confirmación de que todo lo demás es humo |
| RG-002 | **Observación humana** | ❓ **sin hacer** | ❓ | — |

**Lecturas del ciclo 1, honestas:**

1. **Las dos fuentes más baratas fueron las más decisivas.** Consultar nuestra propia base y
   llamar a la API real cambiaron la operación. Ninguna requirió investigación externa.
2. **La investigación externa sirvió sobre todo para MATAR hipótesis**, no para construirlas.
   Es un rol distinto y hay que nombrarlo: no es *Evidence Hunter*, es **verdugo de hipótesis**.
3. **El deep research costó ~5 millones de tokens y produjo un (1) hallazgo decisivo** — pero ese
   hallazgo es el cimiento del proyecto, y de paso confirmó que el resto de la industria es humo.
   Saber que todo lo demás es humo **también es conocimiento**, y probablemente el más caro de
   conseguir por otros medios.
4. **La fuente que falta es la única que no se puede automatizar.** RG-002 se cierra mirando a
   una persona trabajar. Ningún agente lo va a hacer por nosotros.

---

## Las prohibiciones de los agentes

Baratas de aplicar (son líneas de prompt), caras de omitir. Un agente que salta de paso
contamina la evidencia con interpretación, y después nadie puede separarlas.

| Agente | **No puede** |
|---|---|
| El que busca gaps | Proponer soluciones. Solo identificar incertidumbre |
| El que busca evidencia | Interpretar. Solo traer lo que encontró, con su ruta y su cita |
| El que valida | Buscar evidencia nueva. Solo evaluar la que ya está |
| El que modela | Inventar conceptos. Solo incorporar lo que la evidencia hizo **inevitable** |
| El que planifica | Tocar el modelo. Solo convertir conocimiento validado en trabajo |

Y una prohibición que aplica a todos, incluido el hilo principal:

> **Si no encontraste, decí que no encontraste.** Una búsqueda negativa reportada honestamente
> vale más que un hallazgo inventado para no volver con las manos vacías.

(Funcionó: el agente de foros reportó que Reddit y Stack Overflow estaban bloqueados en vez de
rellenar con humo. El de papers dijo que no pudo verificar la cifra de Gartner sobre MDM y se
negó a citarla. Esas dos confesiones valen más que veinte párrafos de relleno.)

---

## Abstracción anticipada vs. abstracción comprimida

La pregunta que hay que hacerse antes de crear cualquier concepto nuevo:

> **¿Estoy anticipando una estructura, o comprimiendo una que ya observé?**

| | |
|---|---|
| **Anticipada** | *"Creo que van a existir estos siete agentes."* → Sin evidencia. Es una predicción disfrazada de diseño |
| **Comprimida** | *"Observamos seis investigaciones. Este patrón apareció siempre. Lo nombramos."* → Nace de la realidad |

Las mejores arquitecturas son **compresiones de patrones repetidos**, no predicciones de patrones
futuros.

Y el criterio de aceptación de cualquier concepto nuevo, que es el mismo para una tabla que para
un agente:

> **La arquitectura no crece cuando tenemos una buena idea.
> Crece cuando ya no podemos explicar la realidad sin introducir un concepto nuevo.**

Cada pieza tiene que ser **inevitable**.

---

## Cómo se usa este documento

1. **Cuando el modelo afirme algo que no observamos, se anota acá.** No en el spec.
2. **Un Tipo A crítico sin resolver bloquea el sprint.** No se programa el transporte de algo que
   no sabemos si existe.
3. **Un Tipo B se construye barato y se observa.** No se espera evidencia que solo el uso puede dar.
4. **El spec no se abre para "mejorarlo".** Se abre cuando una realidad observada lo obliga.
5. **Lo observado va al World Journal.** De ahí, si se repite, se gana un lugar en el modelo.

> El spec dice qué creemos. Este documento dice **qué de eso todavía no sabemos**.
> Un spec sin este documento al lado es una novela bien escrita.
