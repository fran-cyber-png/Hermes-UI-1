# Aprender de las conversaciones sin llenarse — el diseño del ciclo

> Diseño, no implementación. Escrito el **2026-07-28** a partir del pedido: *«quiero que estén
> ingestadas en tiempo real las conversaciones de Hermes, pero si solo ingestamos sin parar se nos va
> a llenar… tenemos que aprender constantemente»*.
>
> **La respuesta corta**: la mitad de esto **ya está diseñado y construido en Ivi**, y la política de
> olvido **ya la decidiste vos el 27-jul** — está escrita en la base. Lo que falta no es
> arquitectura: es **lo que la alimenta**. Y «tiempo real» es el requisito equivocado para el corpus,
> y el correcto para otra cosa.
>
> Complementa a [`mapa-ivi-rag.md`](mapa-ivi-rag.md) §5.

---

## 1. La premisa a corregir: **las conversaciones no son documentos**

Indexar conversaciones crudas en pgvector falla por tres razones, y ninguna es de capacidad:

**1.1 Una conversación es un flujo de eventos, no un documento.** Es mayormente «buenos días»,
«ok», «gracias» — y **el 45 % de los mensajes entrantes es multimedia sin texto** (notas de voz).
Indexar eso da un corpus de saludos: preguntes lo que preguntes, el vecino más cercano va a ser
*«buenos días, quisiera información»*.

**1.2 El valor no está en la conversación: está en el PATRÓN.** Una conversación de hace cinco
minutos tiene valor marginal ≈ 0 para responder la próxima pregunta. Cuatrocientas conversaciones
preguntando lo mismo son **una** pregunta canónica con `n = 400`. Y los patrones no cambian en
minutos: cambian en semanas. **Tiempo real sobre lo crudo = máximo costo, máximo ruido, mínimo
valor.**

**1.3 PII.** Las conversaciones traen nombres, teléfonos y cosas dichas en confianza. Que una
vendedora recupere lo que el lead B le dijo a la vendedora C es un problema de privacidad y
probablemente legal. Ivi ya tiene la columna `confidencialidad` y la regla de que lo `personal`
**nunca** entra al contexto — indexar conversaciones crudas la pasa por encima.

> **El error a evitar tiene nombre en tu propia casa**: es el mismo que «el RAG de embeddings es
> solo para texto, nunca para agregados». Un top-k por parecido sobre conversaciones trae *lo que
> suena parecido*, no *lo que pasa seguido*. Y lo que hace falta aprender es lo segundo.

---

## 2. Lo que YA existe (y está vacío esperando)

Medido en `ivi_rag_pg` el 28-jul. Esto es lo que cambia el plan:

| Tabla | Filas | Qué es |
|---|---:|---|
| **`ivi.retencion_politica`** | **4** | 🟢 **Tu decisión del 27-jul, ya en la base**: `publico` 90 d · `interno` 90 d · `sensible` 30 d · `personal` 30 d (sin cuerpo por CONSTRAINT) |
| **`ivi.chat_interacciones`** | 64 | 🟢 Telemetría de cada pregunta — y es **excelente** (§4) |
| **`ivi.episodios`** | **0** | 🟡 **La memoria L2, diseñada con el principio correcto y sin una sola fila** (§3.1) |
| `ivi.gimnasio_corridas` | 0 | 🟡 El gimnasio nunca registró una corrida en base |
| `rag.documentos` | 2.423 | 🔴 El corpus invertido de `mapa-ivi-rag.md` |

**«Se nos va a llenar» ya tiene respuesta y la escribiste vos hace un día.** El problema no es que
falte la política: es que no hay nada corriendo que la aplique, porque no hay nada entrando.

---

## 3. El modelo: **destilación, no ingesta** — y son TRES destinos, no uno

Una conversación no produce «un documento». Produce, si acaso, alguna de tres cosas — y cada una
tiene su almacén, su forma de recuperarse y su dueño:

### 3.1 → Un **EPISODIO** (`ivi.episodios`) · el «por qué» del período

El propio código lo define: *«un hecho del negocio con extensión temporal: una campaña, un cambio de
fecha de un evento, un incidente de pagos, una decisión de precio. Es el nivel que convierte a Ivi de
reportera en analista: hoy sabe decir «las ventas de julio cayeron 18 %» y no sabe decir POR QUÉ.»*

Y trae **dos decisiones de diseño que hay que respetar** (están escritas ahí y son correctas):

- **Se recupera por rango de fechas + dominio, en el `WHERE`. Jamás por similitud.** Si la pregunta
  es sobre julio, se traen **todos** los episodios de julio, no los top-k más parecidos. Por eso
  `ivi.episodios` **no tiene columna `embedding`** — y no es un olvido.
- **La memoria es CONTEXTO, nunca HECHO.** *«Un número recordado es un número viejo.»* Un episodio
  no satisface el gate `pide_dato`, y eso vive en el router, no en el prompt.

**Quién los escribe**: una persona, o una destilación que **propone** y una persona aprueba. Nunca
automático — es el mismo criterio que las plantillas propuestas de ADR 0019.

### 3.2 → Una **PIEZA candidata** (`catalogo/piezas` de Hermes) · lo que funcionó

Y acá está lo bueno: **Hermes ya diseñó de dónde sale esto, y no hace falta leer conversaciones
crudas.** ADR 0022 lo dice textual:

> *`null` es la LÍNEA DE BASE… es el **semillero de piezas nuevas** —«se puede en 2 cuotas» la
> improvisó una persona, no salió de ninguna plantilla— y por eso `HechosDeUnEnvio` lleva el `texto`:
> el corpus del frente 3 puede salir sin tocar el schema.*

O sea: **la destilación no lee 1.876 conversaciones. Lee los envíos a mano que funcionaron.** Eso es
un subconjunto chiquito y de altísima señal: lo que un humano improvisó **y** que obtuvo respuesta o
venta. El lazo ya sabe cuál de los dos pasó.

### 3.3 → Una **PREGUNTA CANÓNICA** · el patrón de lo que se pregunta

No va a ningún índice: va al **golden de vendedora** (P5 del mapa) y a la lista de huecos. Es lo que
convierte «ingestemos el negocio» en una lista con orden de prioridad medido.

> **Ninguno de los tres destinos es «indexar la conversación».**

---

## 4. La telemetría que ya existe y es el motor del aprendizaje

`ivi.chat_interacciones` captura, por pregunta:

```
pregunta · respuesta · consulta_retrieval · tipo · modo · eje_dato · dominio · confidencialidad
fuentes · redactor · modelo · tokens_in · tokens_out · costo_usd · traza_id
ms_total · ms_retrieval · ms_sdk · ms_redactor
grounding_ok · numeros_no_verificados · edad_del_dato_s · error · degradado
```

Eso es observabilidad de primer nivel para un RAG: **costo por respuesta, latencia por etapa,
grounding, y edad del dato**. Y habilita el ciclo de aprendizaje más barato que existe:

> **Cada `tipo = SIN_EVIDENCIA` es un pedido de conocimiento.** Agrupar los SIN_EVIDENCIA por tema y
> ordenarlos por frecuencia **ES la lista de trabajo de qué ingestar**, priorizada por demanda real
> en vez de por intuición.

No hace falta construir nada nuevo para esto: la tabla ya está y ya tiene 64 filas. Lo único que
falta es que Ivi reciba preguntas de verdad — hoy Hermes recibe 404 porque el endpoint no está
desplegado.

**Y el mismo lugar responde «¿se está agrandando el contexto?»**: `tokens_in` y `costo_usd` por
interacción. No es una preocupación teórica, es una serie de tiempo que ya se está guardando.

---

## 5. Dos almacenes, dos leyes

| | **El log** | **El corpus** |
|---|---|---|
| Qué es | Event store de Hermes + `chat_interacciones` | `rag.documentos` + `ivi.episodios` |
| Crece | **Sin límite** | **ACOTADO** — cientos de docs, no cientos de miles |
| Lo lee el LLM | **Nunca** | Sí |
| Ley | Retención por confidencialidad (90/90/30/30) | **Todo documento tiene dueño y vigencia** |
| Costo | Disco, barato | **Calidad de recuperación** — es el recurso escaso |

**La destilación es sustractiva**: 1.876 conversaciones → ~50 preguntas canónicas → ~30 piezas
aprobadas. Ese es el único movimiento que agranda el corpus, y lo hace con aprobación humana.

### 5.1 El olvido, y la sutileza de las **dos vidas**

Una pieza retirada **sale del índice RAG** (no se recupera nunca más) pero **se queda en el
catálogo** para que el lazo siga cerrando el join con los `envios_wa` viejos. **Mismo objeto, dos
vidas distintas.** Sin esa distinción, «olvidar» rompería la atribución histórica — que es
exactamente lo que ADR 0022 construyó para que no pase.

La maquinaria de caducidad ya existe (`PENALIZAR_PROCEDIMIENTO_DEROGADO = 1.0`, `vigente_desde`,
`estado`) y hoy sirve a cuatro documentos sin dueño.

---

## 6. Qué SÍ debe ser tiempo real

La intuición era buena, apuntada al lugar equivocado. Lo que sí quiere latencia baja:

| Cosa | ¿Tiempo real? | Dónde vive |
|---|---|---|
| El estado de **este** contacto | ✅ sí | Ya lo es — es el panel de Hermes, no un problema de RAG |
| Los **números** (Capa 2, `governa.*`) | ✅ sí — **y hoy están congelados desde el 13-jul** | El bug de frescura real |
| La **telemetría** de cada pregunta | ✅ sí | `chat_interacciones`, ya lo hace |
| El **corpus** de conocimiento | ❌ **no** — semanal/nocturno | La destilación |
| Los **episodios** | ❌ no — cuando pasan | Los escribe una persona |

**Batch donde el patrón manda, tiempo real donde el estado manda.** Poner la conversación de hace
cinco minutos en el índice no le sirve a nadie; que el precio de Cerberus esté al día, a todo el
mundo.

---

## 7. El plan (diseño; nada de implementación todavía)

Encaja como **P0** y **P6** del plan de `mapa-ivi-rag.md`:

**A0 · Encender el lazo de demanda** *(no necesita nada nuevo)*
Desplegar el endpoint de Ivi para que Hermes deje de recibir 404, y **leer los `SIN_EVIDENCIA`
agrupados**. Eso produce la lista priorizada de P2 con demanda medida en vez de intuición.
Precondición honesta: sin preguntas reales no hay aprendizaje que valga.

**A1 · La primera destilación, a mano y chica**
Sobre los envíos `A_MANO` que **obtuvieron respuesta**, no sobre las conversaciones. Salida: un
puñado de piezas candidatas y un puñado de preguntas canónicas. Se hace una vez, a mano, para
descubrir la forma antes de automatizar nada.

**A2 · Los primeros episodios**
Escribir a mano los 5–10 episodios de los últimos 60 días (la campaña de julio, el cambio de fecha
del Foro, el incidente de la auto-respuesta del 27-jul). Es lo que convierte a Ivi de reportera en
analista, y la tabla lleva un día vacía.

**A3 · La destilación periódica**
Nocturna o semanal, **propone** — nunca escribe sola. Aprobación humana con el molde de ADR 0019
(Aprobar · Editar antes · Descartar). Lo aprobado entra al catálogo, y el lazo mide si vende.

**A4 · Aplicar la retención**
El job que ejecuta `retencion_politica` (90/90/30/30). Hoy la política existe y nadie la corre.

**A5 · Caducidad por resultado**
Una pieza cuya conversión medida cae por debajo de la línea de base sale del índice (y se queda en
el catálogo, §5.1). Requiere el lazo cerrado — o sea, depende de E2 del plan de agosto.

```
A0 (encender demanda) ──► A1 (destilar a mano) ──► A3 (destilar periódico) ──► A5 (caducar por resultado)
        │                        │                                                      ▲
        └──► A2 (episodios) ─────┴──────────────► A4 (retención) ────────────────────────┘
```

---

## 8. Resumen en cinco líneas

1. **Las conversaciones no se indexan: se destilan**, y salen tres cosas distintas — episodios,
   piezas candidatas y preguntas canónicas. Ninguna es «la conversación».
2. **No hace falta leer 1.876 conversaciones**: el semillero son los envíos `A_MANO` que
   funcionaron, y Hermes ya guarda su texto por diseño (ADR 0022).
3. **«Se nos va a llenar» ya tiene respuesta**: el log crece sin límite y el LLM no lo lee jamás; el
   corpus es acotado, curado, con dueño y vigencia. La política de retención la decidiste el 27-jul
   y está en la base.
4. **El motor del aprendizaje ya está instrumentado**: cada `SIN_EVIDENCIA` de
   `ivi.chat_interacciones` es un pedido de conocimiento, y agruparlos es la lista de trabajo.
5. **Tiempo real sí, pero para los números y el estado del contacto** — no para el corpus. Lo que
   está roto de frescura hoy es la Capa 2, congelada desde el 13-jul.

---

*Fuentes: `ivi.retencion_politica`, `ivi.chat_interacciones`, `ivi.episodios` y `rag.documentos` en
geografo (lectura, 28-jul); `rag/episodios.py` y `rag/ask.py` de `ivi-cerebro@main`; ADR 0019 y 0022
de este repo. El diagnóstico del corpus: [`mapa-ivi-rag.md`](mapa-ivi-rag.md).*
