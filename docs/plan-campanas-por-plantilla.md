# Campañas por plantilla aprobada — plan de implementación

> **4-ago-2026.** Todo lo de abajo está verificado contra el código instalado y la doc oficial de
> Meta; donde no se pudo verificar, se dice.
> Disparador: `promo_3x1_cursos` quedó **Active - Quality** y hay **147 leads** del 31-jul/1-ago/2-ago,
> **138 con la ventana de 24 h cerrada**.

---

## 0 · Lo que hay que hacer HOY, antes de escribir una línea de código

### 0.1 · Prender la captura de métricas (irreversible, y no es retroactiva)

```
POST /<WABA_ID>?is_enabled_for_insights=true
```

La doc lo dice literal: *«Once confirmed, the API begins capturing template analytics… template
analytics cannot be disabled»*. **Empieza a capturar desde ese momento.** Si la campaña sale antes,
esa campaña no va a tener con qué medirse — nunca, ni hacia atrás.

Es una línea, no tiene contra documentada, y hay que hacerla aunque después decidas no construir nada.

### 0.2 · Tres arreglos en la plantilla misma

| Qué | Por qué |
|---|---|
| **El idioma dice `English`** y el cuerpo está en español | El envío se resuelve por el par `(name, language)`. Pedirla como `es` da **132001** («the template does not exist in the specified language»). Funciona pidiéndola como `en`, pero queda una plantilla española declarada inglesa — y eso pesa en la calidad del número. |
| **«SOLO POR HOY» es texto fijo** | El cuerpo aprobado **no se edita al vuelo**: cada cambio vuelve a revisión. Una plantilla que dice «solo por hoy» miente cada vez que se manda después del primer día. Tiene que ser una variable. |
| **El link de pago es directo** (`api.openpay.pe/occ/…`) | No pasa por el formulario de Cerberus, así que la venta **no lleva `venta_request_key`** — la llave que la ata a la conversación. Sin eso solo queda adivinar por teléfono, con techo medido de **2,1 %**. Vendés y no podés demostrarlo. |

---

## 1 · Fase 1 — El vocabulario. **Es ahora o nunca**

Sin esto, los 147 envíos se registran como **línea de base** — la fila `a-mano`, que representa «lo
que una persona escribió de cero» y es **el número contra el que se compara todo lo demás**. No
falla: ensucia, en silencio, y **no se puede re-atribuir después**.

| Qué | Dónde | Por qué |
|---|---|---|
| **Clase nueva `hsm`** | `piezas/direccion.ts:97` | `CLASES_DE_PIEZA` es lista cerrada de cuatro y una HSM no es ninguna. Meterla en `plantilla` colisiona espacios de ids (esa clase es la secuencia interna `plantillas`+`plantilla_pasos`, la única que admite `orden`). |
| **Vía nueva `campana`** | `procedencia/pieza.ts:138` | No es `automatica` (que tiene UN productor: el acuse nocturno) ni `bot`. El propio comentario del repo dice por qué mezclarlas es un error: «el acuse nocturno quedaría midiendo el rendimiento de un flyer». |
| **Catálogo local del HSM** | como `catalogo/codigo.ts` | El cuerpo vive en Meta. Hermes necesita nombre + idioma + cuerpo aprobado + estado para **tres** cosas a la vez: auditar (`envios_wa.texto`), proyectar el saliente al hilo, y **versionar la pieza**. |
| 🔴 **`marcadoresDe` no reconoce `{{1}}`** | `catalogo/pieza.ts:175` | El regex es `[a-z_]+`, que no matchea dígitos. Los parámetros de una HSM son posicionales. Hoy el catálogo le afirmaría a Ivi que la plantilla **no necesita contexto y está lista para mandar**. Es una mentira, no un hueco. |

**Schema: cero cambios.** Las seis columnas de `envios_wa` ya están migradas, y `(clase, ref)` es
textual a propósito para que esto entre sin tocar la base.

> ⚠️ **El modo de fallo silencioso del catálogo local**: si alguien edita la plantilla en Meta y la
> copia de Hermes no se entera, el `sha256` no cambia y **dos textos distintos se miden como uno**.
> El estado se puede leer por API (`GET /<TEMPLATE_ID>?fields=status`), así que la sincronización
> tiene que ser verificable, no un copiar-y-pegar.

---

## 2 · Fase 2 — El emisor

### 2.1 · El transporte: ~15 líneas

`TransporteCloudApi.post()` ya inyecta `messaging_product`, arma el Bearer y apunta a
`/{phoneNumberId}/messages`. Un `enviarPlantilla` reusa **eso mismo**, la misma guarda de
`estado !== 'conectado'`, el mismo `normalizarTelefono` y el mismo retorno.

El payload es el mismo POST con otro `type` (literal de la doc):

```json
{ "messaging_product": "whatsapp", "to": "…", "type": "template",
  "template": { "name": "promo_3x1_cursos", "language": { "code": "en" },
                "components": [ { "type": "header", "parameters": [ { "type": "image", "image": { "id": "…" } } ] },
                                { "type": "body",   "parameters": [ { "type": "text", "text": "…" } ] } ] } }
```

**La asimetría no rompe la interfaz.** `TransporteWhatsapp` ya tiene métodos opcionales, y ya hay
una capacidad que un transporte no implementa: `fotoDePerfil?` la tienen `falso` y `whatsmeow`, y
**no** `cloud-api`. Un `enviarPlantilla?()` es exactamente el mismo patrón, al revés.

### 2.2 · `EnvioControlado`: acá está el costo real

`enviar()` **rechaza sin auditar** cualquier orden sin `texto` y llama `enviarTexto`. Hace falta un
tercer método que reuse `conGuardas` — el patrón ya lo usó `enviarMedia`, que **fabrica** un texto
descriptivo justamente para poder auditar.

Para una HSM ese texto tiene que ser **el cuerpo aprobado renderizado localmente**: Meta devuelve
solo un id. Sin esa copia, el hilo de la vendedora muestra un envío sin contenido y `envios_wa`
guarda una fila que no dice qué se mandó.

---

## 3 · Fase 3 — El despachador. Casi todo ya está escrito

### Se reusa tal cual

- **`programar()`** — puro, con reloj y azar inyectados: espaciado 60–240 s, techo por hora que
  salta a la próxima, techo por día que posterga con motivo, orden «el que más esperó primero».
  Su sexto parámetro `ventanas` **existe justamente para un segundo consumidor**.
- **`repartirAprobadas()`** — **es** el repartidor de campaña que se necesita: toma un lote que una
  persona aprobó, lo reparte sobre la banda horaria entera y devuelve `noEntran[]` con el motivo.
- **Los frenos**: cerrojo de una a la vez, una por tick, freno TOTAL ante `temporary_ban` o
  desconexión, sin reintento a ciegas.
- **`rechazo.ts`** — las tres formas de decir que no, puras y sesgadas al falso negativo.
- **`ventanaDeServicioAbierta()`** — ya implementada y con tests: es la función que parte los 147 en
  «9 texto libre / 138 solo HSM».

### NO se reusa

`decidir.ts` y `candidatos.ts` son la capa de decisión **del acuse nocturno** y rechazarían a los
147: `decidir()` tiene techo de antigüedad de 12 h (los leads promedian **76**) y `candidatos.ts`
solo mira conversaciones **sin responder** de los últimos 3 días — y **146 de 147 ya fueron
contestadas**.

La campaña necesita su propia selección. Eso es lo único genuinamente nuevo del despachador.

### El dry-run, con la lección de #166 aplicada

Un simulacro que muestra el **resultado** y no las **condiciones** no verifica nada. El plan del
27-jul se veía impecable y estaba mal de siete formas porque imprimía la hora de salida y nunca la
de llegada. Para una campaña, cada renglón tiene que decir: **quién, a qué línea escribió, cuándo
escribió, si su ventana está abierta o cerrada, qué preguntó, y si ya le mandaron precio.**

---

## 4 · Fase 4 — Leer `statuses`. **El mayor valor por línea de código**

`recibirWhatsapp` atiende `field === "calls"` y `field === "messages"`; todo lo demás cae en un
`continue`. Grep sobre todo `server/src`: **cero apariciones** de `statuses`, `pricing` o `billable`.

Consecuencia dura: **hoy Hermes no puede saber si una HSM se entregó, se leyó, falló o si la
bloquearon.** La campaña sale a ciegas, y el «apartado tipo Template Insights» no tiene los hechos
crudos con los que construirse.

Es también la única forma de enterarse de que el número está en problemas antes de que Meta lo
pause.

---

## 5 · Fase 5 — Las métricas de Meta: lectura pura

```
GET /<WABA_ID>/template_analytics?start=…&end=…&granularity=DAILY&template_ids=[…]&metric_types=COST,SENT,DELIVERED,READ,CLICKED
```

Devuelve **literalmente** `amount_spent`, `cost_per_delivered` y `cost_per_url_button_click`, más
sent/delivered/read/clicked.

Encaja exacto en el molde de ADR 0022: **el server trae hechos crudos, el veredicto se deriva puro**.
Y trae `n` y `base` de fábrica —`sent`/`delivered` son la base natural de `read` y `clicked`—, así
que no hay que inventar ninguna métrica ni ningún nombre causal. **`cost_per_delivered` no se
recalcula**: ya viene, y recalcularlo sería la segunda implementación que diverge.

---

## 6 · Fase 6 — La pantalla, última y a propósito

`routes/resultados.ts:15-28` ya explica por qué no hay pantalla: *«una pantalla hoy sería una tabla
vacía durante semanas»*. Con 147 envíos, esta campaña sería **la primera pieza del sistema en cruzar
`MUESTRA_MINIMA = 30`** — o sea, la primera que se puede decidir con estadística en vez de con
impresión.

Lo que la pantalla mostraría, y que **Meta estructuralmente no puede**:

| | Meta | Hermes |
|---|---|---|
| gastado · costo por entrega · entregados | ✅ | ❌ (hasta la fase 4) |
| quién es, qué vendedora, qué curso | ❌ | ✅ |
| **si hubo VENTA en Cerberus, con folio y monto** | ❌ | ✅ |
| **¿la plantilla le gana a que la vendedora escriba a mano?** | ❌ | ✅ (línea de base + Wilson) |

> ⚠️ **El «Conversions/Purchases» del panel de Meta es el ECO de lo que Hermes le manda**, no una
> segunda fuente: `lazo/worker.ts` le envía `Purchase` al CAPI desde las ventas de Cerberus. Leerlo
> como validación independiente es leerse a uno mismo.

---

## 7 · El ADR. No es un parámetro

ADR 0015 enumera cuatro prohibiciones. Una campaña de seguimiento a quien escribió primero **no cae**
en «no inicia conversaciones» (§37) — no es contacto en frío — pero **sí cae** en «**no insiste**»
(§41) y tiene la forma de envío masivo (§38).

El repo ya cruzó esa línea una vez y lo tramitó como corresponde: `bot/correrReenganche.ts`, con
**ADR 0028 que revierte 0015 solo para él**, apagado por default y con tope por corrida. Y el propio
0015 dice que volver sobre esto **«es un ADR nuevo, no un parámetro»**.

Así que la fase 0 del trabajo no es código: es tu ADR.

---

## 8 · Los tres frenos de Meta que el código no puede esquivar

1. **Estado de la plantilla** — hay que consultarlo (`GET /<TEMPLATE_ID>?fields=status`) **antes** de
   armar la lista, no descubrirlo en el primer 400. `PAUSED` y `DISABLED` no son rechazos de
   revisión: son consecuencia de la calidad en producción.
2. **El tope por usuario de marketing es adaptativo y sin número publicado.** Una parte de los 147 va
   a fallar con **131049** y Hermes **no puede predecir cuál**. El despachador tiene que tratarlo
   como resultado normal, no como error.
3. **Llegan desde otro número.** Los 138 escribieron a las líneas de las vendedoras; la HSM sale de
   `51984429504`. Para ellos es un número desconocido, sin hilo previo.

---

## 9 · El orden, y qué se puede saltear

| # | Qué | ¿Bloquea el envío? | ¿Es ahora-o-nunca? |
|---|---|---|---|
| 0 | Prender insights · arreglar idioma, urgencia y link | sí (idioma) | **sí** (insights) |
| 1 | Vocabulario: clase, vía, catálogo local, `{{1}}` | no | **sí** |
| 2 | Emisor: transporte + `EnvioControlado` | **sí** | no |
| 3 | Despachador: selección propia + dry-run | **sí** | no |
| 4 | Leer `statuses` | no | no, pero sin esto sale a ciegas |
| 5 | `template_analytics` | no | no |
| 6 | Pantalla | no | no |

**Lo único que se puede saltear sin pagarlo después es la 6.** La 1 se paga para siempre; la 4 se
paga en esta campaña.

---

## 10 · Hallazgo aparte, y probablemente más rentable

Los leads que llegan por **Click-to-WhatsApp abren una ventana gratis de 72 h** si se les contesta
dentro de las primeras 24. No necesita plantilla, ni aprobación de Meta, ni código nuevo: pide
contestar a tiempo — que es exactamente el agujero que la auto-respuesta (#125) ya intenta tapar y
que hoy está apagada.

---

## 11 · Deuda que este frente destapa (no la arregla, la anota)

- **`momento_venta` se estampa y nunca se usa**: no entra en la clave de agrupación ni hay corte por
  momento. Para una campaña sería la pregunta «¿funciona mejor en los tibios o en los fríos?».
- **«¿Hubo venta?» es un conteo, no plata.** `conversiones_wa.monto` existe (numeric, con moneda),
  pero el seam `ventasPorClave` devuelve **solo fechas**. Para decir «esta campaña movió S/ X» hay
  que ensanchar ese seam, no inventar tabla.
- **La fuente de ventas cruza por TELÉFONO** cuando la llave determinista ya existe y está indexada.
  El propio archivo promete el arreglo («cambiar un WHERE en un solo archivo») y ya está disponible.
- **No hay corte por curso ni por línea**, aunque el dato existe en las dos tablas.
