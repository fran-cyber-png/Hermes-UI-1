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

## Estado del registro

| ID | Suposición | Clase | Estado | Importancia |
|---|---|---|---|---|
| [RG-001](#rg-001) | Existe un registro de ventas | **A** | 🔍 En verificación | **Crítica** |
| [RG-002](#rg-002) | Existe un flujo de community manager | **A** | ❌ Nunca observado | **Crítica** |
| [RG-003](#rg-003) | Meta aprueba `human_agent` | **A** | ⏳ No solicitado | **Crítica** |
| [RG-004](#rg-004) | Meta aprueba `page_events` | **A** | ⏳ No solicitado | **Crítica** |
| [RG-005](#rg-005) | Los comentarios están sobre posts promocionados | **A** | ❌ 0/8 verificado, sin barrer | Alta |
| [RG-006](#rg-006) | Los "teléfonos" en el texto son teléfonos | **A** | ❌ Sin validar | Alta |
| [RG-007](#rg-007) | Existe WhatsApp conectado | **A** | ❌ Cero mensajes | Media |
| [RG-008](#rg-008) | Un curso tiene un precio conocido | **A** | 🔍 En verificación | Alta |
| [RG-009](#rg-009) | El vocabulario de `hechos` refleja lo que la gente dice | **B** | ❌ Copiado de papers | Media |
| [RG-010](#rg-010) | Hay identidades basura que fusionan mal | **B** | ❌ Nunca observado | Baja |
| [RG-011](#rg-011) | Alguien va a querer una inferencia | **B** | ❌ Nada la puebla | Baja |
| [RG-012](#rg-012) | Existe (o existirá) un bot respondiendo | **B** | ❌ No hay bot | Baja |

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

## Cómo se usa este documento

1. **Cuando el modelo afirme algo que no observamos, se anota acá.** No en el spec.
2. **Un Tipo A crítico sin resolver bloquea el sprint.** No se programa el transporte de algo que
   no sabemos si existe.
3. **Un Tipo B se construye barato y se observa.** No se espera evidencia que solo el uso puede dar.
4. **El spec no se abre para "mejorarlo".** Se abre cuando una realidad observada lo obliga.
5. **Lo observado va al World Journal.** De ahí, si se repite, se gana un lugar en el modelo.

> El spec dice qué creemos. Este documento dice **qué de eso todavía no sabemos**.
> Un spec sin este documento al lado es una novela bien escrita.
