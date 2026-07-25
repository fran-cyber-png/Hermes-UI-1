# ADR 0017 — El panel derecho se ordena por decisión, no por tema

**Fecha**: 2026-07-25 · **Estado**: aceptado · **Reemplaza**: la primera versión del panel
multifunción (misma rama, commit `782e9d7` «el panel derecho deja de ser solo la ficha»), que quedó
archivada por este documento. No reemplaza ninguna decisión ya mergeada a `main`.

> ⚠️ Tres ramas paralelas numeraron su ADR **0015** y dos su **0016** el mismo día. Este toma el
> **0017** para no sumar una colisión más. Las que ya están en `main` no se tocan: renumerar el ADR
> de otra rama es pisarle el trabajo a su autor.

## El problema

El panel derecho mide 360 px y la vendedora lo mira mientras habla. En ese ancho, lo que está arriba
se lee y lo que está abajo no existe. La primera versión lo ordenó por **tema** —identidad,
etiquetas, respuestas, y el resto en pestañas Ficha · Enviar · Notas · Curso— y el resultado,
auditado sobre datos reales, fue este:

| Lo que se veía | Lo que costaba |
|---|---|
| Un cliente con **MXN 4.760 en 2 compras** se veía igual que un desconocido: mismo marco blanco, misma cabecera. La diferencia estaba en un texto, tercero en el orden de lectura. | **124 de las conversaciones abiertas ya compraron** (11 por más de US$1.000). Leer para distinguirlas cuesta un segundo por conversación y ochenta veces por turno. |
| Lo primero del panel era una caja vacía: «No hay una respuesta clara para esta conversación todavía». | El hecho que cambia el trato llegaba después de un hueco. |
| El nombre estaba **tres veces** en pantalla (fila de la cola, cabecera del chat, cabecera del panel) y el nombre real —el del formulario— escondido en un bloque gris más abajo. | Los pushnames en producción son «🦋W», «.», «10 ❤️L». El nombre que sirve estaba oculto detrás del que no sirve. |
| «Le interesa» aparecía **tres veces** (ficha, pestaña Curso, barra del chat) y en las tres vacío, mientras el curso que la persona pidió estaba impreso dos centímetros más arriba. | **611 conversaciones con precio enviado y UN interés registrado.** La compuerta de «Cotizado» pide interés: el embudo miente todos los días. |
| **«Registrar venta» vivía dentro de la pestaña Ficha.** | Abrir «Notas» hacía desaparecer el botón que cierra la venta. |
| Un contacto sin datos dejaba ~250 px de blanco en el medio del panel. | Se lee como «algo no cargó», no como «no hay nada». |

## La decisión

**El panel se ordena por las preguntas que la vendedora se hace mientras escribe, en el orden en que
se las hace** — no por familia de dato:

1. **Quién es** (`panel/BandaEstado`) — siempre visible.
2. **Qué quiere** (`panel/BloqueInteres`) — siempre visible.
3. **Qué le mando** — dos calibres de la misma pregunta, siempre visibles:
   `sugerencias/DosRespuestas` (la secuencia entera, un clic) y
   `hechos/BloqueHechos` (la frase suelta que desatasca).
4. **El detalle** (pestañas Ficha · Enviar · Notas · Curso) — bajo pedido.
5. **Qué hago** (`panel/AccionesContacto`) — siempre visible, al pie.

De ahí salen tres reglas que no son de gusto:

### 1. Una pestaña guarda lo que se CONSULTA, nunca lo que se DECIDE

Por eso «Registrar venta», la próxima acción y «Le interesa» salieron de las pestañas. Si algo puede
desaparecer porque quedó abierta otra sección, no puede ser algo que decida una venta.

### 2. El estado se ve, no se lee — y sin oro

Un filete de 3 px y un fondo tenue codifican el estado, con `estadoContacto.ts` decidiendo cuál (y
sus tests fijando el arbitraje):

| Acento | Cuándo | Token |
|---|---|---|
| verde | ya compró | `success` |
| frío | cotizada y dejó de contestar, **y no es cliente** | `--temp-frio` |
| ámbar | Cerberus no respondió: **no se sabe** | `warning` |
| gris | lead nuevo | `border` |

**Nada de dorado.** En Hermes el oro significa una sola cosa —tiempo que se acaba— y ni «cliente» ni
«lead nuevo» son un reloj. El naranja del frío es `--temp-frio` (#C2410C), de la rampa de
temperatura, no de la familia del ámbar.

Dos ejes que **no se colapsan**: quién es la persona (sale de Cerberus) y cómo va la conversación
(sale de las señales, ADR 0016). Un cliente que se enfrió **sigue siendo cliente**: el verde no cede
y el frío se dice con su etiqueta al lado. Ante la duda manda el hecho más fuerte.

El filete está **siempre**, aunque sea gris: si apareciera solo cuando hay algo que decir, su
ausencia sería un dato y habría que aprenderlo.

### 3. El interés sube de lugar, y la propuesta se confirma con un clic — nunca se asienta sola

*«Los intereses mejor posicionados, también es progresivo y ayuda a dar contexto a todo»* (dueño,
2026-07-25). Progresivo quiere decir que la lista no es un campo con un valor: es una historia corta
—«el 1 de julio preguntó por Inteligencia, el 15 por OSINT»— y esa evolución es lo que le dice a la
vendedora si la persona está explorando o ya sabe qué quiere. Por eso el bloque va **segundo, fuera
de las pestañas**, y por eso lleva su lectura en una línea (`panel/resumenInteres.ts`, pura y con
tests): «2 cursos anotados · el último, 15 jul».

**Los chips no los pinta este panel**: los pinta `gestion/Intereses`, el mismo componente que usan la
cola, el Pipeline y el modal de la compuerta — incluida **la propuesta derivada del anuncio o del
formulario con su botón «Confirmar»** (#102, ya en `main`). Este bloque **compone, no duplica**: una
versión propia de esa lógica sería el segundo lugar que empieza igual y se separa en tres semanas (la
lección de #37). Lo que agrega es el escenario: el rótulo, el acceso al buscador, el resumen y —
cuando no hay nada— un vacío que dice **por qué importa** en vez de un `+` mudo.

**No se asienta automáticamente**, y eso es deliberado: el interés abre la compuerta de «Cotizado».
Un embudo que se mueve solo deja de ser evidencia de nada. La máquina propone, una persona firma.

### 3-bis. El nombre del formulario manda, y la ficha dice de dónde sale (#118)

Decisión del dueño, no preferencia: **(a) cliente verificado en Cerberus → (b) nombre del formulario
→ (c) alias de WhatsApp**. El alias («🦋W», «.», o un «Juan Pérez» que en realidad es otra persona)
deja de ser la identidad. `panel/identidad.ts` lo resuelve, con tests.

Dos cuidados que hacen que la regla no se vuelva un problema nuevo:

- **El alias no se pierde.** Es como se llama la persona en el chat y en la cola: si el panel dijera
  «Javier Zeballos» mientras el chat dice «javier», nadie sabría si son la misma. Va de segunda línea.
- **La procedencia está a la vista** («de Cerberus · en WhatsApp: …», «del formulario · …»). No es lo
  mismo un nombre que alguien firmó comprando que uno que tipeó en un anuncio, y el panel no puede
  afirmar los dos con la misma cara.

Y el nombre legal va en **dos líneas, no truncado**: «DR EN DERECHO IGNACIO ALEJAND…» no identifica a
nadie. Las iniciales del avatar, en cambio, salen del nombre de la COLA — «AV» de «Alejandro Vila»
es la cara que la vendedora ya vio en la fila; «DE» de «DR EN DERECHO» no le dice nada.

### 4. Los datos que cierran ventas se ofrecen, y el catálogo se edita sin deploy

De la minería de las 1.876 conversaciones (#153 §7): «el acceso lo tiene por **todo un año**» se dijo
**1 vez**; «se puede pagar en **cuotas**», **2**; «es para **público general**», **3**; «este es
nuestro **canal oficial**», **1**. En los transcripts **cada uno desbloqueó la venta en el acto** —
alguien pagó menos de un minuto después de que le concedieran las dos cuotas. No es que la vendedora
no los sepa: es que mientras escribe no los tiene a mano.

`hechos/BloqueHechos` los ofrece según el momento, y de eso salen tres decisiones:

- **No son plantillas.** Una plantilla son varios mensajes que salen espaciados por
  `EnvioControlado`; esto es una línea. Y **tocarla NO envía**: cae en el composer para que la
  vendedora la lea, la ajuste y la mande ella (la misma distinción de #45). Por eso el gesto es
  distinto y el botón no dice «Mandar». Verificado contando llamadas de envío: **cero**.
- **Cuál corresponde lo decide la MISMA cabeza.** `momentoDeVenta()` de `sugerencias/estado.ts` ya
  clasifica dónde está la conversación para las dos secuencias del panel y para el acuse de la
  auto-respuesta nocturna. Acá se filtra por ese momento y nada más: filtrar del lado del cliente
  sería la segunda cabeza que después diverge (la lección de #37). Para eso salió
  `estadoDeLaVenta()` de adentro de `consultarSugerencias()`: los hechos necesitan el momento **sin**
  el catálogo de plantillas, que hoy en producción está vacío.
- **El catálogo es una TABLA, no una constante.** Lo que hoy cierra ventas cambia —cambia el
  producto, cambia el país, cambia la objeción de la semana— y agregar una frase no puede costar un
  deploy. `hechos/catalogo.ts` es el punto de partida medido y se siembra con
  `npm run hechos:sembrar`; mientras la tabla esté vacía, o mientras falte el `db:push`, el endpoint
  sirve ese default y **dice que no se puede editar** en vez de mostrar un bloque vacío.

**Tope de tres.** Siete chips en 360 px son un menú, y un menú es exactamente lo que la vendedora no
mira mientras escribe.

## Consecuencias

- **El pie no se mueve nunca.** La banda queda clavada arriba, el pie abajo, y todo lo del medio vive
  en un solo scroll con la barra de pestañas pegajosa. Verificado a 1280×720 con las dos respuestas
  cargadas: antes de esto el reparto flex empujaba «Registrar venta» fuera del panel.
- **Una sola acción primaria por estado**: cliente → registrar la venta; lead nuevo → marcarlo
  interesado; sin ficha → ninguna, con el motivo escrito. Los cinco controles que competían al pie
  bajaron de rango.
- **Tres planos de lectura**: blanco arriba (lo que decide), bandeja hundida al medio (lo que se
  consulta), blanco abajo (lo que se hace). El hueco de un contacto sin datos deja de parecer un
  error de carga.
- **Los estados de error se disparan de verdad**: la ficha y las sugerencias tienen techo de 12 s. Sin
  eso —verificado contra producción el 25-jul— una consulta que Cerberus deja abierta congela el
  panel en «Buscando…» y la vendedora nunca ve ni la acción ni el aviso.
- `FichaContacto` y `PanelContexto` conservan su prop `embebida` (cambio aditivo para las ramas en
  paralelo), pero embebidas ya no renderizan lo que ahora pone el panel: cabecera, «Le interesa»,
  próxima acción y CTA de venta.

## Lo que deliberadamente NO se hizo

- **No se tocó la lógica de las dos sugerencias** (`server/src/sugerencias/`), ni `EnvioControlado`,
  ni su progreso cancelable, ni las compuertas del server. Esto es rediseño de superficie y
  jerarquía; las reglas son de otra decisión.
- **No se quitaron las pestañas.** Funcionan y ya están aprendidas; lo que cambió es qué merece estar
  adentro.
- **No se infiere el curso leyendo el texto del mensaje**: sigue fuera de alcance (#72).
- **No se construyó la lista de espera.** La objeción #1 del informe es el **aplazamiento** («avisame
  para la próxima edición», 13% — la más blanda de todas) y hoy **no existe ningún mecanismo para
  capturarla**. Lo único que entra en este PR es la frase (`proxima-edicion`) y el lugar donde se
  ofrece; la lista real —con edición, fecha y disparo automático cuando abra la siguiente— es un
  frente propio, no un chip. Queda como follow-up declarado.
- **No se construyó el timeline unificado (#148).** El bloque de interés lee la evolución en una
  línea y le da un escenario decente, pero la historia completa —intereses + compras + formulario +
  conversaciones + quién atendió, en un solo hilo— es un frente propio. El lugar está previsto: es la
  bandeja del detalle, donde hoy vive la pestaña Ficha.
- **No se construyó la UI de edición del catálogo.** Los endpoints están (`POST` / `PUT` / `DELETE`
  sobre `/api/hechos`), pero la pantalla para que el dueño agregue los suyos es otro frente. Hasta
  entonces se edita por API o sembrando.
