# Diagnóstico del embudo del bot — 3-ago-2026

**Pregunta que lo motivó**: el 34,6 % de las conversaciones del bot queda en estado `saludo` y solo
el 1,2 % llega a `calificando`. ¿Dónde se traba el embudo?

**Respuesta corta**: **no se traba**. Lo que el estado `saludo` cuenta no es gente que el bot perdió:
es gente que escribió una vez y no volvió — y lo hace en la misma proporción con el bot que con una
vendedora humana. Las tres hipótesis que parecían obvias se midieron y **las tres se cayeron**.

Este documento existe para que nadie las vuelva a dar por buenas. Si se hubiera «optimizado el
embudo» sin medir, se habría reescrito el flujo de primer contacto —que no está roto— y se habría
perdido la oportunidad de arreglar lo que sí lo está.

---

## Universo y método

- **81 conversaciones** que el bot llegó a tocar (`bot_estado_conversacion`), **91 leads** de la
  línea del bot (`51984429504`) entre el 30-jul y el 2-ago-2026.
- Contra **107 leads** de la línea de vendedoras (`51941654039`) en el mismo período, como control.
- Fuentes: `interactions`, `bot_respuestas`, `bot_estado_conversacion` en producción (solo lectura).

> ⚠️ **Muestra chica.** Con n≈90 por brazo, una diferencia de 5 puntos no es decidible. Todo lo que
> sigue vale como *orden de magnitud y descarte de hipótesis*, no como medición fina. Donde una
> diferencia entra en el ruido, se dice.

---

## Lo que se midió

### 1. El embudo es una tasa de rebote, no un atasco

| Veces que el lead escribió | Conversaciones | % |
|---|---:|---:|
| **1 (y no volvió)** | **38** | **46,9 %** |
| 2 | 12 | 14,8 % |
| 3–5 | 16 | 19,8 % |
| 6+ | 15 | 18,5 % |

Y ese rebote es **exactamente** lo que llena los estados «trabados»:

| Estado final | Conversaciones | De ésas, escribieron 1 sola vez |
|---|---:|---:|
| `saludo` | 28 | **23 (82,1 %)** |
| `desconocido` | 17 | **14 (82,4 %)** |
| `escalado` | 18 | 1 (5,6 %) |
| `informando` · `identificando` · `pausado` · `calificando` | 18 | 0 (0 %) |

El estado no mide qué tan bien atendió el bot: mide **hasta dónde llegó la conversación**. Si el lead
escribe una vez, termina en `saludo` por definición.

### 2. El bot rebota MENOS que las vendedoras humanas

Mismo período, mismo tipo de lead, mismo cálculo:

| Línea | Leads | Rebote (escribió 1 vez) |
|---|---:|---:|
| **BOT** `51984429504` | 91 | **45,1 %** |
| **Humanas** `51941654039` | 107 | **50,5 %** |

La diferencia (5,4 pts) está dentro del ruido para este n. Lo que **sí** se puede afirmar: el bot no
es peor. El rebote es una propiedad del canal —tráfico de click-to-WhatsApp— y no del que contesta.

### 3. ❌ Refutada: «se van porque el bot pide el nombre antes de dar valor»

La hipótesis era que el flujo *saludo → nombre → programa* gasta tres turnos antes de dar algo útil.
Se clasificó la **primera respuesta** del bot y se midió si el lead siguió:

| Primera respuesta del bot | Conversaciones | El lead siguió |
|---|---:|---:|
| **A. pide el NOMBRE** | 35 | **60,0 %** |
| **C. promete la info YA** («dame un momento y te paso…») | 34 | **52,9 %** |
| D. otra cosa | 7 | 42,9 % |
| (el bot no llegó a responder) | 5 | 20,0 % |

Pedir el nombre retuvo **más**, no menos. La diferencia no es significativa con este n — pero la
hipótesis pedía lo contrario y no aparece por ningún lado. **Cambiar el flujo de primer contacto no
está justificado por los datos.**

### 4. ❌ Refutada: «se van porque el bot tarda en contestar»

El promedio invitaba a creerlo: los que no volvieron esperaron **1925 s** de media contra **89 s**
los que siguieron — 21×. Ese promedio es **un artefacto de dos outliers**. La distribución completa:

| Espera hasta la 1ª respuesta | Leads | No volvieron | % rebote |
|---|---:|---:|---:|
| **hasta 1 min** | **81** | **37** | **45,7 %** |
| 1–5 min | 2 | 0 | 0 % |
| 5–30 min | 6 | 2 | 33,3 % |
| más de 2 h | 2 | 2 | 100 % |

**89 de 91 leads (98 %) reciben respuesta en menos de 5 minutos, y el rebote del ~46 % ocurre igual
con respuesta en menos de un minuto.** La latencia explica 2 casos de 41, no el fenómeno.

*(Mediana global: 19 s. Cuando la mediana es 19 s y el promedio 916 s, el promedio no describe nada.)*

### 5. ❌ Refutada: «los 2 casos de 10 h son un bug vivo»

Los dos outliers (`5215543219876` a las 00:51 y `573021234567` a las 01:10 del 1-ago, contestados
11:38 y 11:37) llegaron mientras el bot **estaba en modo `sombra`** durante su arranque — genera y
no manda. Sus `bot_respuestas` de esa madrugada están en `sombra` y `bloqueada`; la primera `enviada`
del día es 09:30. **Artefacto del rollout, no defecto permanente.**

### 6. Los que rebotan son leads buenos

De los 41 que escribieron una sola vez, el primer mensaje fue:

| Primer mensaje | Veces |
|---|---:|
| «Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia» | 24 |
| «Hola. ¿Puedo obtener más información sobre esto?» | 13 |
| otros (todos con intención explícita) | 4 |

**No es ruido.** Son leads pagados, que llegaron por el anuncio y preguntaron bien. Se fueron después
de una respuesta correcta entregada en menos de un minuto.

---

## Qué queda en pie

El embudo **no** es el problema. Lo que sí está medido y roto, del mismo corpus:

| Defecto | Medición |
|---|---|
| **Un tercio del gasto en LLM se tira** | 84 de 255 respuestas (32,9 %) se generaron y nunca salieron. El freno se consulta *después* de pagar el modelo. Caso extremo: 21 generaciones seguidas bloqueadas en una conversación que ya había tomado una vendedora. |
| **Desobedece reglas explícitas** | Pregunta el país **9** veces (regla `0b` lo prohíbe); anuncia que otra persona lo contactará **3** veces (regla `6b` lo prohíbe). Son 13 reglas duras para Haiku 4.5: parece saturación, no falta de reglas. |
| **Inventó una sede** | 1 vez: «Te escribo desde Panamá… Nuestra sede en la región es en Panamá». `CONTEXTO_NEGOCIO` lista Miami, CDMX, Lima, Guayaquil, Santa Cruz y Río. Panamá no existe, y además le mintió sobre desde dónde escribe. |
| **Identidad partida** | 39 respuestas firmadas «Kathy Alva, asesora académica» y 6 «Sofía Rodríguez, asesora comercial». **Arreglado** en PR #251. |
| **Un hecho filtraba su instrucción interna** | `precio-por-pais` se mandó literal, con el «Decile SOLO el precio de SU país…» adentro, a 2 leads. **Arreglado** en producción el 3-ago (partido por país). |

---

## Lo que esto le pide a la página de entrenamiento

Este diagnóstico tardó una mañana y consistió casi entero en **refutar cosas plausibles**. Ése es el
argumento más fuerte para la página: hoy cada pregunta de éstas es SQL a mano contra producción, y
la alternativa a preguntarlas es cambiar el bot por corazonada.

Tres requisitos que salen directo de acá:

1. **El embudo tiene que ser navegable, no un gráfico.** «34,6 % en `saludo`» es engañoso; «23 de
   esos 28 escribieron una sola vez» es el dato. La vista tiene que llegar hasta el hilo.
2. **Todo número necesita su control.** El 45 % de rebote del bot solo significa algo al lado del
   50 % de las humanas. Sin comparación, cualquier porcentaje parece un problema.
3. **El replay tiene que correr el mismo código que producción.** Ya hay 255 respuestas con su hilo,
   su estado y sus piezas: es un set de regresión gratis, y los 9 casos de «preguntó el país», los 3
   de «anunció otra persona» y el de la sede inventada son casos de prueba ya escritos. Si el banco
   arma su propio prompt, mide una ficción — la lección de #37, aplicada a tiempo.

**Advertencia de método para quien siga**: en este corpus el promedio miente (mediana 19 s, promedio
916 s). Cualquier medición de latencia o de conversión acá va con distribución, no con promedio.
