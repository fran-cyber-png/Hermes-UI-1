# Cómo se vende en Goberna

> Escrito el **1-ago-2026** mirando 66 conversaciones reales de un solo día en la línea
> `51984429504` (Diploma de Inteligencia y Contrainteligencia). No es teoría de ventas: cada regla
> de acá salió de ver qué preguntó una persona concreta y qué pasó después.
>
> **Para qué sirve**: es el plan contra el que se configura el bot. Todo lo que el bot puede decir
> tiene que estar acá o en el catálogo (`hechos`), y todo lo que acá se prohíbe tiene que estar
> prohibido en el código, no en una recomendación.

---

## 0. El número que ordena todo

De las **66 personas** que escribieron ese día, **cero dijeron que no**. Ni una.

- 🔥 **14 calientes** — pidieron precio, forma de pago o cuotas
- 🌡 **12 tibios** — preguntaron algo concreto del contenido
- ❄️ **38 fríos** — solo el copy del anuncio, nunca preguntaron nada propio

Y el dato que duele: **siete de los catorce calientes recibieron una promesa explícita de «el precio
en tu moneda» o «te paso el link» que nunca se cumplió**. De las 66 personas, **solo tres llegaron a
ver datos bancarios**.

> **No perdemos por precio ni por desconfianza. Perdemos por no contestar lo último que preguntaron.**

Esa frase es el diseño entero de esto.

---

## 1. La secuencia, como la hace un vendedor de la casa

Observada sobre el hilo de `51932557675` («mic mic»), el más avanzado del día, y confirmada en
otros seis. El vendedor real hace esto:

| # | Paso | Por qué |
|---|---|---|
| 1 | **Saluda, se presenta con nombre y pide el nombre** | Sin nombre no hay conversación, hay formulario |
| 2 | **Pregunta qué área le interesa** | Filtra al que vino por otro producto |
| 3 | **Manda el paquete completo** — texto + temario + docentes | Todo junto, no de a cachos |
| 4 | **Pregunta por la intención apenas resuelve UNA duda** | «¿Está interesado en adquirirlo?» |
| 5 | **Responde corto** | «exactamente mi estimado» — tres palabras |
| 6 | **Da el precio en la moneda del lead** | Ver §3 |
| 7 | **Asume la venta**: manda el formulario de registro | Antes del sí, no después |
| 8 | **Cierra con una pregunta de acción** | «¿Le habilito el link de pago?», no «¿le interesa?» |
| 9 | **Pone una fecha** | «las clases inician el 10 de agosto» |

### Las tres cosas que separan a un vendedor de un informador

**a) Pregunta por la intención temprano.** El bot informa hasta que el lead se cansa; el vendedor
pregunta «¿está interesado en adquirirlo?» cuando resolvió *una* duda. No espera a resolverlas todas.

**b) Cierra con una pregunta de ACCIÓN, no de interés.** «¿Le habilito el link de pago para cancelar
la primera cuota?» presupone el sí y solo pide permiso para ejecutar. «¿Te interesa?» invita a
pensarlo.

**c) Manda el siguiente paso antes del sí.** El formulario de registro sale cuando el lead todavía
está preguntando por la mecánica de pago. No es presión: es quitar un paso del camino.

---

## 2. Los datos del producto — la única fuente

**Todo esto vive en la tabla `hechos` y se edita sin deploy** (`POST`/`PUT` a `/api/hechos`). Si un
dato no está acá, el bot no lo puede decir.

| Dato | Valor |
|---|---|
| Producto | Diploma Internacional de Inteligencia y Contrainteligencia · familia **DIPICOT** |
| Inicio | lunes **10 de agosto** |
| Duración | **8 sesiones**, del 10 al 31 de agosto |
| Días y horario | lunes, miércoles y viernes · **19:00–21:00 GMT-5** |
| Modalidad | 100 % virtual, en vivo por Zoom, quedan grabadas, campus 24/7 |
| Acceso | **un año** al campus |
| Certificación | **120 horas académicas**, emitida desde EE.UU., con código de verificación |
| Título | **Asesor Estratégico Internacional en Inteligencia y Contrainteligencia** |
| Quién certifica | Escuela de Inteligencia & Estrategia, respaldo de GOBERNA Analytics, Empresa Asociada **CCL** |
| Requisito de ingreso | **Ninguno**. Público general, no hace falta ser policía ni militar |
| Requisito de certificación | Examen final con **13 puntos** mínimo. Proyecto final opcional |
| Contenido | 8 módulos, del fundamento al cierre con operaciones psicológicas |
| Bono | curso grabado de Ciberinteligencia |

### El plantel (5 ponentes)

Roberth J. Bazan (CEO de Goberna, Magíster en Inteligencia Estratégica CAEN) · **Ron Aledo** (oficial
retirado del Ejército de EE.UU., ex analista senior de la CIA y la DIA) · Eduardo de La Torre
(Magíster en Ciberseguridad y Ciberdefensa) · Andrés Peñaranda (Escuela Superior de Guerra) ·
**Gral. (R) Mauricio Quiroga** (ex director de unidades de inteligencia de la PNP, ex asesor del
Mininter y la PCM).

> Los dos en negrita son los que responden la objeción de credibilidad. Ver §5, caso «el plantel».

---

## 3. El precio: oficial por país, NUNCA una conversión

| País | Precio |
|---|---|
| 🇵🇪 Perú | **S/ 500** |
| 🇲🇽 México | **$2,800 MXN** |
| 🇧🇴 Bolivia | **1,350 Bs** |
| Resto | **USD 150** (regular USD 199) |

**No son conversiones al tipo de cambio: son precios oficiales.** USD 150 al cambio son ~560 soles y
el precio peruano es 500. Si el bot calcula en vez de leer la tabla, da un número que no cobramos.

Ese error ya pasó: el hecho viejo `moneda-local` decía «te lo paso en tu moneda» **sin decir cuánto**,
y el modelo terminaba calculando. Está apagado por eso.

### El anclaje se dice siempre

> «El precio regular es de **$199 USD**. El día de hoy estamos cerrando con el precio promoción de
> **$150 USD**.»

Sin el ancla, «$150» es un número suelto. Con el ancla, es un descuento del 25 % que vence.

### Las cuotas: **opcionales, y no se ofrecen de frente**

Lo principal es **un solo pago**. Si el lead pide facilidad —y solo entonces— van **2 cuotas**, la
segunda el **20 de agosto**. En Perú son S/ 250 y S/ 250; en México $1,400 y $1,400; en dólares $75 y $75.

> Regla del dueño, 1-ago-2026: *«esto no lo tienes que enviar siempre, solo si ya pidió alguna
> facilidad de pago; lo principal es 1 cuota»*.
>
> Ofrecer financiación a quien no la pidió regala margen y siembra una cobranza. El bot lo estaba
> haciendo con todos porque el hecho `cuotas` estaba disponible sin condición.

---

## 4. Dónde paga cada uno

Estos hechos están atados a los momentos de venta posteriores al primer saludo: el bot **no** le tira
datos bancarios a quien recién dice hola, pero **sí** los da a quien pregunta.

| País | Medio |
|---|---|
| 🇵🇪 Perú | BCP · Interbank · **Yape** · tarjeta (ESCUELA ACADEMICA GOBERNA EIRL) |
| 🇲🇽 México | BBVA con CLABE · **OXXO** · tarjeta (GOBERNA LATAM) |
| 🇧🇴 Bolivia | BCP Bolivia · tarjeta · QR (ISENANBOL SRL) |
| 🇪🇨 Ecuador | Banco Pichincha (CORPORACIÓN GOBERNA SAS) |
| 🇺🇸 EE.UU. | Chase · **Zelle** (GOBERNA ANALYTICS LLC) |
| 🇵🇦 🇬🇹 🇩🇴 | Link de tarjeta |
| Resto | Link de tarjeta |

**El disparador es la pregunta**: «¿y dónde se hace el depósito?», «¿cómo pago?», «cuál es el proceso».

### El proceso de inscripción, en tres pasos

1. Realiza el pago
2. Envía el comprobante **con sus datos**: nombres, apellidos, correo, provincia, ciudad, ocupación y
   número de documento
3. Recibe el acceso al campus y al Zoom

---

## 5. Los casos — objeciones reales y qué se contesta

Cada uno pasó de verdad ese día, con su hora.

### 🔍 «¿Es en serio?» · «No tiene placa o algo que distingue»
`51966628980` 12:57 · `51932557675` 16:05

**Objeción de confianza**, la más cara: si no se contesta, el lead no vuelve. Aries preguntó «Es en
serio?» y **nadie le contestó en dos horas**, porque el hecho `canal-oficial` decía «puedes
verificarnos en nuestras redes» **sin un solo link**.

**Se contesta con prueba, no con palabras**: grupogoberna.com · facebook.com/gobernacorp · la página
del diploma · y el brochure.

### 🎓 «Debería incluir un ex Director de la DINI. Deberían exhibir sus CV»
`51989012727` 19:21

**Objeción de credibilidad técnica**, de alguien que sabe del tema y está midiendo si nosotros
también. **No se discute: se le da la razón y se le muestra.** El Gral. (R) Quiroga fue director de
unidades de inteligencia de la PNP y Ron Aledo fue analista senior de la CIA y la DIA. **Y se manda
el brochure**, que trae los CV.

### 💰 «Precio en soles» · «Pesos mexicanos?» · «En soles cuánto equivale»
Cuatro leads distintos

**Nunca calcular.** Leer la tabla del §3. Un lead que pide su moneda y recibe dólares se queda
esperando, y eso es lo que pasó con siete de los catorce calientes.

### 🕐 «Todavía tengo plazo» · «Próximo lunes»
`51932557675` 16:10 y 16:28

**Objeción de urgencia**, no de precio ni de confianza — esas ya se resolvieron. Lo único que
destraba es una **fecha de cierre concreta** y el cupo.

⚠️ **Y acá hay una trampa técnica**: la ventana de servicio de WhatsApp son **24 h desde el último
mensaje del lead**. Si dice «decido el lunes» y hoy es sábado, **el lunes ya no le podemos escribir**
sin una plantilla aprobada por Meta. Nunca prometas «te escribo el lunes»: **pedile que él escriba**.

### 🐶 Un sticker de cachorrito triste
`51924073609` 16:36, después de «¿estás interesada en adquirirlo?»

**Un sticker es una respuesta.** Ese, después de una pregunta de compra, es una objeción de precio o
de momento dicha sin palabras. Se contesta ofreciendo las dos salidas: cuotas, o anotarla para la
próxima edición.

> Y ojo: el bot trata todo entrante sin texto como ilegible (`entrante_sin_texto`) y se calla.
> **Cuatro leads quedaron colgados así en ocho horas.** Un sticker no es un audio inaudible.

### 🏫 «¿Dónde es el curso?»
`5213318820245` 14:21 — **nunca se le respondió**

Un mexicano de Guadalajara preguntando dónde es el curso puede estar creyendo que viaja a Perú. La
respuesta es **«100 % en línea, lo llevas desde donde estés»**, y no estaba en ninguna pieza.

### 🛡 «Soy víctima del crimen organizado, ¿me servirá el curso?»
`5217223507491` 13:11

**Acá no se vende.** El diplomado es formación académica en análisis de inteligencia; no es seguridad
personal y no protege de un cártel. Decirle que sí —o dejar la pregunta abierta— es cobrarle sobre
una expectativa falsa a alguien en peligro.

Se responde con honestidad y **se reencuadra hacia lo profesional**, sin presionar. Si después de eso
quiere formarse, la venta es legítima.

### 🔀 «Ciberseguridad» (otro producto)
`5217297068584` 16:57

La línea recibe leads de productos que no vende. La distinción que sirve:

> **Inteligencia y Contrainteligencia es virtual EN VIVO. Ciberinteligencia es GRABADO — y viene
> incluido como bono.**

Eso convierte una consulta por otro producto en un argumento a favor de este.

### 🔁 Leads que vienen de otro negocio
`51997847034` — venía de una conversación de **Consultoría** y preguntó por el Diploma

La línea recibe **Escuela y Consultoría**. No son el mismo embudo ni el mismo vendedor.

---

## 5 bis. El reenganche — la palanca de mayor volumen que hoy no existe

**38 de los 66 leads del día recibieron el paquete completo y no volvieron a escribir nunca.** No
dijeron que no: se distrajeron. Es la mayoría de la cartera y hoy nadie los vuelve a tocar.

La regla, en una línea: **si pasaron N horas desde que recibió el material y no contestó, se le manda
UN mensaje corto pidiendo su lectura.**

> «¿Qué tal, te pareció interesante el diploma? ¿Te resuelvo alguna duda?»

No es un recordatorio ni una promoción: es **pedirle su opinión**, que es una pregunta que se
contesta sola. «¿Estás interesado?» invita a un sí o un no; «¿qué te pareció?» invita a hablar.

### Las condiciones, y por qué cada una

| Condición | Por qué |
|---|---|
| **Recibió el material** | Reenganchar a quien nunca vio nada es empezar de cero, no reenganchar |
| **Pasaron entre 2 y 20 horas** desde nuestro último mensaje | Antes de 2 h todavía lo está leyendo. Ver el techo abajo |
| **La pelota es nuestra o está empatada** | Si él escribió último, no es reenganche: es una respuesta que debemos |
| **Una sola vez** | Dos reenganches son acoso, y el segundo confirma que nadie lee |
| **Nunca a quien dijo que no**, se despidió o fue descartado | `bot_pausas` ya lo sabe |
| **Nunca a quien puso una fecha** | «decido el lunes» es un compromiso, no un silencio |
| **Solo dentro del horario de atención** | Un mensaje de venta a las 3 AM es peor que ninguno |

### ⚠️ El techo de 20 horas no es arbitrario: es la ventana de WhatsApp

La ventana de servicio de WhatsApp son **24 horas desde el último mensaje del lead**. Pasado eso,
solo se puede escribir con una plantilla aprobada por Meta —que no tenemos—, así que **el reenganche
que sale a las 25 horas no sale**.

Por eso el techo va en **20 h**: deja margen para que el despachador lo tome, lo espacie y lo mande
antes de que la puerta se cierre.

Ese caso ya apareció: `51932557675` dijo «próximo lunes» un sábado a las 16:28. **El lunes su ventana
ya estaba cerrada.** Por eso, cuando alguien pone una fecha lejana, lo correcto no es prometerle
escribirle: es **pedirle que él escriba**.

### Lo que este mecanismo NO es

No es la auto-respuesta nocturna (ADR 0015/0018), que acusa recibo a quien escribió fuera de horario.
Esto es lo contrario: **le habla a quien ya fue atendido y se quedó callado**. Comparten la
infraestructura —ritmo, topes, freno ante `vendedora_activa`, kill-switch— y no el disparador.

Y como todo lo que sale solo: **un envío sigue siendo una acción con una persona detrás** hasta que
haya evidencia de que esto convierte. Arranca en modo supervisado.

---

## 6. Lo que el bot NO puede hacer

Estas no son preferencias de estilo: cada una revierte una decisión del dueño o tapa un daño medido.

| Prohibido | Por qué |
|---|---|
| **«Un asesor te contactará»** y toda variante | Salió 4 veces en una mañana y **ninguna se cumplió sola**. El lead deja de escribir mientras espera. **Kathy/Sofía ES la asesora.** Si no sabe algo, pide un momento y lo trae ella. El escalamiento interno sigue existiendo — no se cuenta. |
| **Decir que ya mandó algo que no mandó** | «Ya tienes en tu chat el temario completo» (12:09) → el lead contestó a los 15 segundos: *«No tengo nada todavía apenas estoy pidiendo la información»*. |
| **Inventar precios o calcularlos al cambio** | Los precios son oficiales por país |
| **Ofrecer cuotas sin que las pidan** | Ver §3 |
| **Prometer plazos que no controlamos** | «te llamamos en 5 minutos» |
| **Decir o insinuar que es un bot**, o afirmar ser humano | Regla del dueño del 27-jul |
| **Voseo** | El registro es «tú» peruano neutro |
| **Nombrar docentes o afirmar validez universitaria fuera de lo del §2** | |
| **Inventar urgencia** | Una fecha de cierre se dice solo si es firme |

---

## 7. Qué le falta al bot para poder hacer todo esto

Medido el 1-ago-2026, con el bot vivo en la línea.

### 🔴 Una de cada cuatro respuestas no salió

| Estado | Cantidad | |
|---|---|---|
| `enviada` | 102 | 68 % |
| **`bloqueada`** | **40** | **27 %** |
| `cancelada` | 7 | 5 % |

**14 leads distintos se quedaron en silencio.** Y no cae al azar: el bot llama herramientas
justo cuando el lead muestra interés real, así que **el 27 % cae sobre los leads más calientes**.

### Los defectos, por orden de daño

1. **El tool loop descarta el texto.** `bot/agente.ts` tira el bloque de texto de toda respuesta que
   use una herramienta. El modelo redacta, llama a `registrar_interes`, y el lead recibe **nada**.
2. **`mandar_pieza` no manda** (`bot/ejecutar.ts`). Y peor: la herramienta le respondía al modelo
   «pieza agendada para enviar», así que el modelo **redactaba creyendo que salió**.
   > **Una tool que acepta y no ejecuta no produce «no pasa nada»: produce que el modelo mienta con
   > confianza.**
3. **`registrar_interes` no registra.** Ninguna conversación del bot deja interés en el CRM.
4. **La escalada no le avisa a nadie.** `bot_calificaciones` no tiene un solo lector: tres leads
   quedaron marcados «listo para cerrar» en una tabla que nadie mira.
5. **Cada deploy con restart cuelga al lead en vuelo.** El claim de `bot_pendientes` no vence.
6. **El bot no lee audio ni stickers** y se calla.

---

## 8. Cómo se configura esto, en orden

1. **El catálogo primero** (`hechos`) — se edita sin deploy y es lo que el bot puede afirmar. Todo
   el §2, §3 y §4 vive ahí.
2. **La plantilla** (`plantilla_pasos`) — con **negritas** (`*texto*`) y emojis de estructura. Las
   negritas no son adorno: en WhatsApp son lo único que da jerarquía a un bloque de 15 líneas.
3. **Las prohibiciones, en el guardrail** (`bot/guardrails.ts`) — no en el prompt. Una regla del
   prompt es una sugerencia que el modelo ignora; el guardrail es la compuerta. Ya está así para
   precio, automatismo, humanidad, voseo y derivación.
4. **La secuencia de venta, en el prompt** (`bot/prompt.ts`) — el §1 es lo que va ahí.
5. **Los casos del §5, como hechos** — cada objeción con su respuesta, para que el bot la tenga
   disponible y no improvise.

### Dos reglas de higiene que costaron caro

- **La personalización no puede romper el mensaje.** `{nombre}` sin nombre escribe `[nombre]`
  literal. Si no se puede garantizar el dato, la personalización va en la capa que sí lo sabe.
- **Verificar el texto que SALIÓ, no el que se quiso mandar.** Un cierre que se agregó a un script y
  nunca se subió al servidor deja al lead sin la mitad del mensaje, y desde afuera se ve idéntico a
  un envío correcto.

---

## 9. Lo que sigue sin resolverse

- **La fecha de cierre de inscripciones.** El dueño mencionó el viernes 7 de agosto; no está
  confirmado, así que no se cargó. Es lo único que le falta escuchar a los leads que dijeron
  «todavía tengo plazo».
- **DIPCINTE** (Ciberinteligencia y Ciberdefensa): la línea recibe leads que lo piden y no hay
  precio, fechas ni material cargados.
- **La ceremonia de graduación**: preguntada, sin respuesta en ninguna fuente.
- **Restringir una vendedora a una línea**: `numero_vendedora` existe y poblada, pero la cola no la
  lee (`cola/consultarCola.ts`). Hoy todas ven todo.
