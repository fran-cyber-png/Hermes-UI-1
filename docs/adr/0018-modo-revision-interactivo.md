# ADR 0018 — La revisión pasa dentro del chat, y «automática» se retira

**Fecha:** 2026-07-25 · **Estado:** aceptado · **Issues:** #125, #152, #153
**Reemplaza parcialmente:** ADR 0015 y ADR 0016 · **Archiva:** el componente `BandejaRevision`
—la hoja de revisión vieja, que vivía en `src/features/autorespuesta/`— y que este ADR borra. La
lista que hace hoy ese trabajo es `src/features/autorespuesta/ColaRevision.tsx`.

## Contexto

ADR 0016 construyó el modo supervisado: la cola prepara, una persona aprueba. Está en `main` y
apagado. El dueño lo vio funcionando y pidió dos cosas (2026-07-25, sobre la app ya desplegada):

> «podríamos poner unas etiquetas: **apagada y supervisada nada más disponible**, y en esa etiqueta
> todas las recomendaciones de la IA para responder a los leads, y **a la derecha el contexto**»
>
> «revisemos bien supervisada, analicémoslo a fondo comparándolo con herramientas avanzadas de este
> estilo, y que sea **interactivo con toda la UI del chat**»

Lo que había fallaba en un punto concreto y comprobable: **la hoja de revisión mostraba el texto que
se iba a mandar, pero no a quién ni por qué**. Nombre, teléfono, cuánto esperó, la plantilla. Con eso
no se supervisa: se obedece. La vendedora aprobaba a ciegas, o abría el chat aparte y perdía el
lugar en la lista.

Y hay un dato que cambia el encuadre. #153 midió, sobre las 1.876 conversaciones reales: **los hechos
que cierran ventas casi nunca se dicen** — «el acceso lo tiene por todo un año» se dijo **1** vez,
«se puede pagar en cuotas» **2**, «es para público general, no solo policías» **3** — y cada vez
desbloquearon la venta en el acto. Esas preguntas están escritas, en el hilo, sin contestar. Una
pantalla de revisión que no las muestra al lado de la plantilla que va a salir está tapando
justamente el trabajo.

## Qué hacen las herramientas del rubro (investigación, 2026-07-25)

Se revisaron ocho productos con el patrón «borrador de IA + aprobación humana», contra su
documentación oficial. El detalle y las citas viven en el PR; acá va lo que decidió.

| | Dónde vive el borrador | Aceptar / descartar | Autonomía |
|---|---|---|---|
| **Intercom Copilot** | panel derecho; *Smart Replies* como ghost text en el composer | «Add to composer» (paso de edición obligatorio); `Tab`/`Esc` | solo-sugerencia por diseño |
| **Front** | **en el composer** | «Send as…» (un clic manda), «Edit», tacho | Autopilot: Triage · Handoff · **Resolution** (auto-envía) |
| **Gorgias** | no hay borrador: auto-envía si pasa un QA, o entrega el ticket entero | «Show reasoning» post-envío | binario, con umbral de confianza |
| **Missive** | sidebar / modal | sin nombre documentado | **sin auto-envío, ninguno** |
| **Superhuman** | como borrador real | se abre, se edita, se manda | sin auto-envío |
| **Respond.io** (WhatsApp) | **«right in the message composer»** | pulgar arriba/abajo para regenerar | **«no tiene ajustes de respuesta autónoma»** |
| **Zendesk Auto Assist** | tarjeta en el ticket | «Review suggested reply»: Edit / Approve | AI Agents (autónomo) ≠ **Copilot** («una persona manda la respuesta») |
| **HubSpot** | en el hilo | Edit / **Dismiss** / **Sources** | toggle por cuenta |

**Lo que se copia:**

1. **El borrador va al composer** (Front, Respond.io, HubSpot, Superhuman). Es el consenso, y la
   razón es buena: el composer ya es la caja donde se escribe, así que editar no cuesta un modo
   aparte. Superhuman publicó el único número duro del rubro — **el 60% de sus auto-drafts enviados
   salieron sin editar**, o sea que **el 40% se editó**: esconder la edición detrás de un lápiz, como
   hacía nuestra hoja, es esconder cuatro de cada diez usos.
2. **El panel derecho es el porqué** (Intercom «Relevant sources used», Front «# sources», HubSpot
   «Sources», Gorgias «Show reasoning»). Cuatro de ocho llegaron al mismo lugar.
3. **El «Review next ticket» de Gorgias**: avanzar sin volver a una lista.
4. **Los atajos, por convención**: `⌘↵` enviar (Intercom, Missive, Gmail) y `⌘D` descartar borrador
   (Missive). No se inventó ninguno.

**Lo que se descarta, y por qué en este negocio:**

1. **El «Send as…» de Front, que manda con un clic.** Acá aprobar **no manda**: programa. La
   diferencia no es de estilo — es que el ritmo (uno a la vez, 60–240 s, techos por hora) es lo que
   protege el número de WhatsApp, y un botón que mandara al instante lo saltearía. El botón dice
   «Aprobar» y el pie dice que no sale ahora.
2. **El auto-envío por umbral de confianza de Gorgias.** Es soporte de e-commerce: una respuesta mala
   cuesta un reembolso. Acá cuesta el número —y con él las ~1.900 conversaciones— sobre un cliente no
   oficial.
3. **Regenerar con pulgar abajo (Respond.io).** Hermes **no genera texto libre**: el catálogo es
   cerrado (ADR 0015). No hay nada que regenerar, y ofrecerlo sería prometer otra cosa.
4. **La cita de artículos tipo RAG.** Nuestra sugerencia no sale de una base de conocimiento sino de
   una precedencia de tres eslabones. La «fuente» correcta no es un artículo: es **cuál eslabón ganó**.

**Lo que ninguna tiene, y nosotros sí:** una **cola de revisión con lote**. Front tiene un «AI replies
hub» que es auditoría posterior; Gorgias un «To Review» que es coaching post-envío. Todas revisan de a
un ticket. Tiene sentido para ellas —40 tickets distintos— y no para nosotros: **40 leads del mismo
diploma de S/250 con el mismo texto** es un problema distinto, y el lote por campaña de ADR 0016 sigue
siendo la respuesta correcta.

## Decisión

### 1. «Automática» se retira: Hermes no manda solo

La UI ofrece **dos** etiquetas, apagada y supervisada. Siempre hay una persona aprobando.

**Qué se hizo con el modo, concretamente**: se cerró la puerta, no se demolió la máquina.

- `MODOS_ELEGIBLES` (`autorespuesta/modo.ts`) es una lista blanca **separada** de `MODOS`. La
  distinción es la decisión entera: `automatica` tiene que seguir siendo **representable**, porque una
  fila guardada puede tenerla y `leerModo` debe devolverla tal cual — reinterpretarla en silencio
  diría «apagada» en la pantalla mientras el despachador manda. Lo que se cierra es la **entrada**.
- `PUT /api/autorespuesta/modo` con `automatica` responde **409 `modo_retirado`** con el motivo.
- `PUT /api/autorespuesta/interruptor` con `{encendida:true}` ahora deja **supervisada**. Era una
  puerta trasera real: un `curl` con el Bearer de cualquier vendedora dejaba producción mandando sola,
  sin que la UI lo ofreciera. Apagar —para lo único que esa ruta existe— no cambia un carácter.
- Un server que **ya** quedara en automática se muestra como **modo RETIRADO** en rojo, con los dos
  segmentos como salidas. Heredarlo no puede ser una trampa.

**Por qué borrar el modo entero habría sido peor**: el despachador y el repartidor (`programar.ts`,
`despachador.ts`) son **los mismos** que usa lo que la vendedora aprueba — ADR 0016 es explícito en que
reusarlos es lo que hace que un lote aprobado tenga la misma firma de tráfico que tendría el modo
automático. Borrar el modo sería borrar eso. Lo que tiene que morir es la elección, y una elección es
una puerta: cerrarla es una lista blanca con su test, la misma forma que el salto prohibido
`preparada → enviada`.

**Y hay un argumento de producto, no solo de pedido.** #152 cita un estudio aleatorizado
(n>6.200, *Marketing Science*): **revelar que es un bot bajó la compra 79,7%**. El modo automático es
la única configuración en la que el mensaje es genuinamente de una máquina. Con una persona aprobando,
la burbuja del hilo puede decir «Aprobado · ana» en vez de «Automático», y eso es la verdad. Las dos
herramientas más cercanas a nuestro caso —Missive (bandeja compartida chica) y Respond.io
(WhatsApp-first)— **no tienen modo autónomo, deliberadamente**. Hermes se para ahí.

### 2. La revisión pasa dentro del chat

No es una hoja encima de la app: es la vista **Mensajes** con la cola filtrada.

| Columna | En revisión |
|---|---|
| izquierda | la fila de sugerencias, agrupada por campaña, con el lote en cada cabecera ⚠️ (**el lote se retiró en ADR 0020 §6**: la cabecera ahora dice «Revisar 8 ›» y abre la primera del grupo) |
| centro | **la conversación real, sin tocar** |
| derecha | «Por qué esta respuesta», **arriba** de la ficha de siempre |
| composer | el borrador, editable, con banda y fondo propios; el botón dice **Aprobar** |

**Por qué no un modal**: un modal tapa exactamente lo que hay que mirar para decidir. La conversación
—qué escribió, cuándo, de qué anuncio vino— **es** el insumo de la decisión.

**Por qué una lista propia y no un filtro de `ColaUnificada`**: la fila necesita datos que la fila
normal no tiene (cuánto espera, cuándo caduca, de qué campaña) y no necesita casi ninguno de los que sí
tiene (urgencia, etapa, curso). Meterla como un filtro más habría cargado de casos un componente de 664
líneas que además está siendo rediseñado en otra rama. Para la vendedora el efecto es el pedido: la
columna de la izquierda ahora muestra solo esas conversaciones.

**El chip es la puerta.** El renglón que decía «12 esperando tu OK» y el botón «Revisar» al lado eran
dos blancos para una intención: el que lee el número es el que quiere hacer algo con él. Ahora el
renglón **es** el botón. No abre cuando no hay nada: un botón que no hace nada enseña que ahí no se
toca, y al día siguiente, cuando sí haya doce, ya nadie lo toca.

### 3. El panel derecho explica, y lo primero que explica es qué preguntó ella

Orden deliberado:

1. **Lo que escribió**, textual y con la hora. Textual porque parafrasear metería una segunda
   interpretación en la pantalla que existe para juzgar la primera.
2. **De qué anuncio vino.**
3. **De qué eslabón salió la campaña** — interés asentado > formulario > anuncio (`campana.ts`),
   dicho con su nivel de confianza. Para eso se agregó `auto_respuestas_pendientes.campana_fuente`.
4. **Con qué ritmo sale** lo que apruebe: la promesa de la casa, dicha donde se decide.

Y una lectura que la máquina se anima a dar porque la midió #153: **si lo único que llegó es el copy
pre-rellenado del anuncio, se dice** («un clic, no una pregunta») y la plantilla genérica está bien. Si
escribió algo suyo, se marca para que lo lea. Ante la duda, «lo escribió ella»: el error barato es que
mire una frase de más.

### 4. El teclado

`⌘↵` aprobar y seguir · `⌘D` descartar y seguir · `⌘↓`/`⌘↑` saltar · `Esc` salir.

**Todos acordes, y no por prudencia decorativa**: en revisión el foco vive en el composer, porque ahí
se edita. Las teclas sueltas de Superhuman e Intercom (`j`/`k`) escribirían. De yapa, ninguna decisión
se dispara con un dedo que resbala. Sin confirmación modal en ninguna: un «¿estás segura?» cada
cuarenta veces no enseña a mirar, enseña a apretar «sí».

Y una asimetría a propósito: **en el composer normal Enter manda; en revisión, no**. Acá el texto viene
escrito y el dedo está editando.

## Lo que NO cambia

Ni una garantía del server. Un envío a la vez · 60–240 s de espaciado · techos de 20/hora y 60/día por
número · nada fuera de 07:30–21:00 · freno total ante `temporary_ban`, error de envío o desconexión ·
cancelación si la vendedora contesta antes · caducidad a las 3 h de gracia · **el salto
`preparada → enviada` no existe**. Aprobar sigue siendo `POST /api/autorespuesta/aprobar`, que reparte
con el mismo `programar.ts`. La UI cambió; las reglas no.

Tampoco cambia lo prohibido: no inicia conversaciones, no genera texto libre, no insiste, nunca a quien
dijo que no, nada de warmup ni anti-ban.

## Esquema

Al final de la tabla existente (`npm run db:push` manual, como toda esta feature):

- `auto_respuestas_pendientes.campana_fuente` — `interes | lead | anuncio`, **nullable**.

**Sin el push, degrada**: el panel muestra la campaña sin la cadena de procedencia y dice que no quedó
registrada, en vez de inventar una.

## Consecuencias

- **Se puede supervisar de verdad.** Antes se aprobaba un texto; ahora se aprueba una respuesta a algo
  que alguien preguntó, con la pregunta a la vista.
- **La medición mejora sin trabajo extra.** `editada` ya existía, pero con el texto en una caja
  siempre abierta se va a usar más — y es la señal de qué plantillas conviene reescribir.
- **Riesgo nuevo, y hay que nombrarlo**: entrar a la revisión abre conversaciones, y abrir una
  conversación manda **ticks azules** (`POST /api/whatsapp/leido/:telefono`). Recorrer 40 sugerencias
  marca 40 chats como leídos. Es el mismo efecto que recorrer la cola a mano, es honesto —la vendedora
  los está leyendo— pero ahora pasa más rápido y en lote. Si algún día molesta, el arreglo es no
  marcar leído cuando el hilo se abre desde la revisión; hoy se deja porque mentir en el otro sentido
  (no marcar algo que sí se leyó) rompe el contador de la cola.
- **Queda una asimetría deliberada**: hay «Descartar todo» global y no «Aprobar todo» global. El lote
  de aprobación existe **dentro** de una campaña, que es donde acaba de leerse el texto.
  > ⚠️ **Corregido por ADR 0020 §6 (#166).** El lote por campaña tampoco existe: el grupo que lo
  > desarmó se llamaba «Sin campaña» y ofrecía «Aprobar 32». La asimetría sigue —«Descartar todo»
  > se queda— porque descartar no le llega a nadie.
- **Costo del teclado, dicho**: `⌘↓`/`⌘↑` le ganan a «ir al final / al principio del texto», que es lo
  que esas teclas hacen en un textarea de macOS. Se aceptó a sabiendas: adentro de la revisión navegar
  es la acción frecuente y el borrador son cuatro renglones, así que moverse dentro del texto se hace
  con las flechas normales. Fuera del modo revisión el atajo no existe y el textarea se porta como
  siempre.
