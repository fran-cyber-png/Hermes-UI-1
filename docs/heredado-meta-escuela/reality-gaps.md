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
| [RG-001](#rg-001) | Existe un registro de ventas | **A** | Existencia | ✅ `OBSERVED` — vive en Cerberus | **Crítica** |
| [RG-002](#rg-002) | Existe un flujo de community manager | **A** | **Comportamiento** | `UNKNOWN` — **nadie lo miró nunca** | **Crítica** |
| [RG-003](#rg-003) | Meta aprueba `human_agent` | **A** | Existencia | `HYPOTHESIS` — no solicitado | Media ⬇ |
| [RG-004](#rg-004) | Meta aprueba `page_events` | **A** | Existencia | `HYPOTHESIS` — no solicitado | Media ⬇ |
| [RG-005](#rg-005) | Los comentarios están sobre posts promocionados | **A** | Relación | ✅ `OBSERVED` — **31,6% sí** | Alta |
| [RG-006](#rg-006) | Los "teléfonos" en el texto son teléfonos | **A** | Confianza | ✅ `OBSERVED` — **97 de 100 sí** | Alta |
| [RG-007](#rg-007) | Existe WhatsApp conectado | **A** | Existencia | ✅ `OBSERVED` — **Baileys, no oficial** | **Crítica** |
| [RG-008](#rg-008) | Un curso tiene un precio conocido | **A** | Ubicación | ✅ `OBSERVED` | Alta |
| [RG-009](#rg-009) | El vocabulario de `hechos` refleja lo que dicen | **B** | Comportamiento | ✅ `OBSERVED` — **estaba casi todo mal** | Media |
| [RG-010](#rg-010) | Hay identidades basura que fusionan mal | **B** | Existencia | `HYPOTHESIS` | Baja |
| [RG-011](#rg-011) | Alguien va a querer una inferencia | **B** | Existencia | `HYPOTHESIS` — la tabla espera | Baja |
| [RG-012](#rg-012) | Existe (o existirá) un bot respondiendo | **B** | Existencia | ✅ `OBSERVED` — **ya existe, y niega serlo** | **Alta** ⬆ |
| [RG-013](#rg-013) | **Una venta se confirma dentro de los 7 días de CAPI** | **A** | **Temporalidad** | `UNKNOWN` | **Crítica** |
| [RG-014](#rg-014) | Las 5.134 ventas históricas se pueden mandar por CAPI | **A** | Comportamiento | `HYPOTHESIS` — probablemente NO | Alta |
| [RG-015](#rg-015) | El CRM usa la API oficial de WhatsApp | **A** | Existencia | ✅ `OBSERVED` — **NO. Baileys** | **Crítica** |
| [RG-016](#rg-016) | Nadie resolvió antes el cruce venta × anuncio | **A** | Relación | ✅ `OBSERVED` — **`goberna-dashboard` sí lo hace** | Alta |
| [RG-017](#rg-017) | Existe un camino seguro de lectura hacia Cerberus | **A** | Ubicación | ✅ `OBSERVED` — **webhook + dump** | Alta |
| [RG-018](#rg-018) | Icarus está viejo / abandonado | **A** | Existencia | ✅ `OBSERVED` — **FALSA. Commit de hace 2 días** | **Crítica** |
| [RG-019](#rg-019) | **La tienda web no tiene lazo con Meta** | **A** | Existencia | ✅ `OBSERVED` — **el CAPI ya corre, sin `Purchase`** | **Crítica** |
| [RG-020](#rg-020) | La ingesta guarda todo lo que Meta devuelve | **A** | Comportamiento | ✅ `OBSERVED` — **NO. Dos bugs que borran datos** | Alta |
| [RG-M001](#rg-m001) | **Existe un proceso estable para convertir incertidumbre en conocimiento** | **B** | Comportamiento | `HYPOTHESIS` — **N=1** | Alta |

**Estado del modelo:** 21 suposiciones. **Once en `OBSERVED`. Cero en `VERIFIED`.**

**Y de las once observadas, seis salieron distintas de lo que el spec afirmaba.** Ese es el
rendimiento real del método: más de la mitad de lo que dábamos por cierto era falso.

---

## Lo que cambió el 2026-07-12 (ciclo 1)

### Gaps cerrados a favor del diseño
- **RG-005** — 31,6% de los comentarios de FB (4.661 de 14.736) **sí son atribuibles a un anuncio**,
  vía `effective_object_story_id`. Y es un **piso**, no un techo (ver RG-020). Instagram: **0%**.
- **RG-006** — El puente del teléfono **funciona**: 97 de 100 son teléfonos reales, 50 de 50 correos
  válidos. Me preocupé de más. Igual hay que validar por país (rechazaría los 3 malos por la razón
  correcta, no por casualidad).
- **RG-017** — El camino a Cerberus **ya existe, dos veces**: un webhook que ya empuja cada venta, y
  un `/descargar-bd/` con `mysqldump --single-transaction`. **Cero infraestructura nueva.**

### Gaps cerrados en contra
- **RG-009** — El vocabulario de `hechos` que copié de papers **estaba casi todo mal**.
  `pregunto_certificacion`: 0 de 200. `expreso_compromiso`: 0 de 200. Y la categoría **dominante
  (37%)** no está en ningún paper: **la gente escribe su número de teléfono y se va.** No es una
  pregunta — es una entrega.
- **RG-015** — El CRM usa **Baileys**, no la API oficial. Y con Baileys **es estructuralmente
  imposible cerrar el lazo de mensajería** (CAPI exige un WABA ID que Baileys no genera).
- **RG-018** — Icarus **no está viejo**. Último commit hace 2 días, en vivo, con tests y usuarios.
  El clon local estaba 14 commits atrás y nos mintió.
- **RG-012** — El bot **ya existe** (`prompts.ts:160`, "Kathy Alva") y tiene instrucción explícita
  de **negar ser un bot** (`prompts.ts:182`). La decisión ya está tomada; lo que no existe es la
  instrumentación para saber si funcionó.

### El hallazgo que reordenó el plan
- **RG-019** — **El lazo con Meta ya está construido y corriendo.** Pixel `513556103518928`, nuestro,
  activo desde 2022, **con CAPI server-side funcionando** (630 eventos por servidor en 24 h).
  Pero transporta la carga equivocada:

  | | |
  |---|---|
  | Eventos `Purchase` en 24 h | **0** |
  | Correos en ~1.200 eventos | **3** |
  | Teléfonos | **1** |

  Y hay un campo oculto llamado `fbclid` con el valor **hardcodeado en `"ORGANICO"`** — no falta la
  captura: **hay una captura que miente.**

  **No hay que construir el lazo. Hay que darle la carga correcta**: las 4.729 ventas pagadas de
  Cerberus, con correo (99,5%) y teléfono (100%). Y eso **no necesita `human_agent`, ni
  `page_events`, ni App Review, ni migrar WhatsApp** — por eso RG-003 y RG-004 bajan a Media.

### RG-020 — Dos bugs de ingesta que borran datos en silencio
1. `interactionsIngestor.ts:111-113` **descarta los mensajes salientes de la página**. La base no
   sabe a quién le respondimos.
2. `interactionsIngestor.ts:63,146` — `comments.limit(50)` **hardcodeado**, y `getAll()` nunca sigue
   la paginación anidada de `post.comments`. **Todo post con más de 50 comentarios se trunca.**
   112 posts tocan el tope exacto; entre los atribuidos, 48 de 274 (17,5%).

Los dos invisibles. Los dos encontrados **mirando los datos, no leyendo el código.**

---

## RG-001

**Suposición.** Existe, en algún sistema de Goberna, el registro de que una persona compró.

**Estado.** ✅ **`OBSERVED`** — 2026-07-12. *(No `VERIFIED`: los números salen del export CSV que
vive en el repo, no de la base viva. Falta un conteo contra la MySQL de producción, que requiere
autorización.)*

**Clase.** A. **Tipo.** Existencia.

### La respuesta

**La venta vive en Cerberus** (`~/goberna/ceberusapp`), un ERP en Django sobre la MySQL de
producción `goberna_app`. Modelo `Venta` — `sales/models.py:90-303`.

| | |
|---|---|
| Ventas históricas | **5.134** |
| En estado "Pagado" | **4.729** |
| Con correo del comprador | **99,5%** |
| Con teléfono del comprador | **100%** |
| Monedas | 7 (USD, MXN, PEN, BOB, DOP, COP, CLP), con tipo de cambio congelado por venta |
| Pagos registrados | 5.255 · Cuotas: 8.400 · Matrículas: 3.386 · Clientes: 5.657 |

Modelos alrededor: `DetalleVenta`, `Cuota`, `Pago` (con foto del voucher y confirmación de
Tesorería), `MetodoPago`, `Matricula` (que cuelga de `DetalleVenta` y tiene `moodle_user_id`).

### Lo que NO existe, en ningún repo

**Ni `ad_id`, ni `lead_id`, ni `fbclid`, ni `utm_*`.** El único rastro del origen es un
desplegable que llena **el vendedor a mano**: `origen` (Facebook/WhatsApp/Google/…) y `medio`
(Pagado/Orgánico/PostVenta/…).

**Y no importa.** El mecanismo probado (§ el RCT de los 70.000 anunciantes) **no necesita saber
qué anuncio produjo la venta**. Le decimos a Meta quién compró, con correo y teléfono hasheados,
y su optimizador hace el resto. La atribución multi-touch —lo único que necesitaría ese
identificador— es un espejismo que se equivoca por 3×.

**El eslabón que faltaba resultó ser el eslabón que no hacía falta.**

### Lo que cambia en el plan

El spec decía "empezar por CAPI con los 680 leads". **Está mal.** El activo son las **4.729
ventas pagadas**, y hay dos caminos con tiempos distintos:

1. **Audiencia de valor — hoy, sin permisos, sin ventana de tiempo.** Subir los 4.729 clientes
   (correo + teléfono hasheados + **cuánto pagó cada uno**) como Custom Audience → **Lookalike
   basado en valor**. *"Búscame más gente parecida a la que realmente paga, ponderada por cuánto
   paga."* Es la palanca más grande y la más barata.
2. **El lazo continuo — cada venta nueva.** `Purchase` por CAPI con correo/teléfono hasheados.
   **Bloqueado por RG-013 y RG-014.**

### El hallazgo colateral que reordenó el registro

> **2.981 de las 5.134 ventas vienen de WhatsApp. El 58%.**
> Y no tenemos WhatsApp conectado.

RG-007 pasa de Media a **Crítica**. El canal que produce más de la mitad del dinero es el único
que no está en el sistema.

---

## RG-013

**Suposición.** Una venta queda confirmada dentro de los 7 días que CAPI acepta como `event_time`.

**Estado.** `UNKNOWN`.

**Clase.** A. **Tipo.** **Temporalidad.**

**Por qué importa.** Las ventas de Goberna **se registran a mano**: el asesor sube la foto del
voucher, y **Tesorería la confirma después** (`Pago.confirmado_por`, `sales/models.py:480-559`).
Si esa confirmación demora cinco o seis días, estamos raspando el límite de CAPI. Si demora más,
**el lazo no cierra y no nos enteramos** — Meta rechaza el evento en silencio.

**Acción.** Una consulta a Cerberus: distribución de `Pago.fecha_pago − Venta.fecha_venta`.
Mediana, p90, p99. Es SQL, no opinión.

---

## RG-014

**Suposición.** Las 5.134 ventas históricas se pueden mandar a Meta por CAPI.

**Estado.** `HYPOTHESIS` — **probablemente NO.**

**Clase.** A. **Tipo.** Comportamiento.

**Por qué.** La documentación dice que `event_time` admite **hasta 7 días hacia atrás**. Eso deja
afuera todo el histórico. Y la Offline Conversions API —que era el camino para datos viejos de
CRM— **está muerta desde mayo de 2025**.

**Pero:** para la **Custom Audience de valor no hay ventana de tiempo.** El histórico igual
trabaja, solo que enseñándole a Meta *a quién buscar*, no *qué anuncio funcionó*.

**Acción.** Confirmar en la documentación si existe una ventana más larga para datos de CRM
(`action_source: system_generated` / `physical_store`). Si no existe, el histórico va **solo** a
audiencias, y hay que dejarlo escrito para que nadie lo prometa.

---

## RG-015

**Suposición.** El CRM usa la API oficial de WhatsApp.

**Estado.** 🔍 Auditando.

**Clase.** A. **Tipo.** Existencia.

**Importancia.** **Crítica.**

**Por qué duele.** Si usa una biblioteca no oficial (Baileys, whatsapp-web.js), entonces:
viola los términos de WhatsApp, **el número se puede banear — y con él se va el 58% de las
ventas**, y no hay `ctwa_clid` ni webhooks ni CAPI. **El canal que más vende sería el único que
no puede cerrar el lazo con Meta.**

---

## RG-016

**Suposición.** Nadie en Goberna resolvió antes el cruce venta × anuncio.

**Estado.** `HYPOTHESIS` — y hay indicios de que **es falsa**.

**Clase.** A. **Tipo.** Relación.

**Por qué.** `goberna-dashboard` se describe a sí mismo como *"BI satélite: ventas × Meta Ads"*.
Si alguien ya construyó ese cruce, hay que **mirarlo antes de rediseñarlo**. Puede estar mal,
puede estar bien, pero ignorarlo sería arrogancia, no ingeniería.

Lo mismo con Icarus: ya tiene `contacts.total_usd_spent`, `n_purchases`, `first_purchase_at` y un
`import-erp.py` que replica Cerberus. **Puede ser el camino que necesitamos, ya escrito.**

---

## RG-017

**Suposición.** Existe un camino seguro de lectura hacia Cerberus.

**Estado.** 🔍 Mapeando.

**Clase.** A. **Tipo.** Ubicación.

**Por qué.** No se hacen consultas analíticas contra la MySQL que corre el negocio. Necesitamos
una copia de solo lectura. `goberna-dashboard` dice conectarse read-only con `managed=False`, e
Icarus ya importa desde un dump. **Si el camino seguro ya existe, se usa. No se inventa otro.**

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
