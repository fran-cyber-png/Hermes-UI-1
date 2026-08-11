# ADR 0052 — Cada filtro de la cola se gana el lugar

**Fecha**: 11-ago-2026
**Estado**: aceptado — toca `server/`, así que las dos mitades salen por **N5**
**Reemplaza**: el predicado `pide_info` (#96) y los chips «Piden info», «Sin responder» y
«Ya compraron» de la barra de Mensajes.
**Enmienda**: **ADR 0014** (la semántica del último entrante se conserva), **#49** (los filtros
secundarios), **#133** («Ya compraron» deja de ser filtro y sigue siendo marca de fila).

---

## El problema

El dueño abrió Mensajes y el chip **«Piden info» marcaba 0**. El cero era del recorte que tenía
puesto; el problema real apareció al medir qué devolvía cuando no marcaba cero.

**«Piden info» mentía, y de tres formas.** Censo sobre producción (`meta_escuela` en VPS1,
11-ago-2026, ventana de 30 días, **3.995 conversaciones**):

El predicado buscaba 14 palabras sueltas en el último entrante. Enganchaba **685** conversaciones:

| Qué disparó el match | n | % |
|---|---:|---:|
| `informaci` | 604 | 88,2 % |
| `interes` | 17 | 2,5 % |
| `costo` | 15 | 2,2 % |
| `precio` | 12 | 1,8 % |
| `cuanto` | 12 | 1,8 % |
| `como` | 10 | 1,5 % |
| `inscri` | 8 | 1,2 % |
| `quiero` | 7 | 1,0 % |

Y al mirar esos textos:

| n | texto |
|---:|---|
| 424 | `Hola Quiero más información del Diploma de Inteligencia y Contrainteligencia` |
| 99 | `Hola. Quiero más información sobre el servicio de Consultoría.` |
| 15 | `¡Hola! Quiero más información` |
| 13 | `Hola. ¿Puedo obtener más información sobre esto?` |

**563 de 685 (82 %) es el texto que PRELLENA META** cuando alguien toca el botón de un anuncio
click-to-WhatsApp. Nadie preguntó nada: **hicieron clic en un botón**.

1. **El chip no decía «pidió algo», decía «vino de un anuncio»** — que es lo que ya dice el chip
   de curso (#72).
2. **Contaba como pedido lo contrario de un pedido.** «Muchas gracias por la información. Talvez
   en otra ocasión» entraba igual; `interes` matchea «no me interesa»; `cómo` matchea «cómo estás».
3. **Y el daño no terminaba en el chip: la FILA mostraba ese texto como preview.** La vendedora
   leía una pregunta donde hubo un clic y **contestaba**, cuando lo que tenía delante era una
   conversación que todavía no empezó y hay que ABRIR.

### Y no era el único chip con problemas

Se midió la barra entera con el mismo criterio:

| Chip | n | Veredicto |
|---|---:|---|
| Piden info | 37 | Miente (arriba) |
| **Sin responder** | **505** | **472 (93 %) de más de 7 días**, y solo **5** dentro de la ventana de 24 h de Meta |
| Puedo escribirle | 25 | Sirve |
| **Ya compraron** | **1.082** | **27 % de la mesa**; de esas solo 99 hablaron alguna vez |
| Pidió ayuda (bot) | 33 | Sirve |
| El bot los ve calientes | 30 | Sirve |

De seis chips, **dos mentían y uno era la mesa entera con otro nombre**.

### El contexto que explica el resto

- De 3.995 conversaciones, **solo 1.061 tienen un mensaje entrante**. Las otras 2.575 son difusión
  nuestra (es lo que ADR 0044 deriva como `sin_respuesta` y ADR 0050 sacó del tablero).
- De esas 1.061, **818 dijeron una sola cosa** — casi siempre el texto del anuncio.
- **396 escribieron y nunca recibieron respuesta.** En la línea grande (`51986394450`): 396 de
  1.083, el **36 %**.
- Al primer mensaje se contesta en menos de 5 minutos el **15 %** en las líneas humanas, contra el
  **65 %** en la línea del bot.

---

## La decisión

### 1. El criterio, primero — qué tiene que cumplir un chip para estar en la barra

Vive escrito en el docblock de `FILTROS_SEC` (`src/features/canales/cola.ts`):

1. **Es trabajo, no un estado.** Si la fila ya está atendida, no entra — salvo que «atendida» no
   signifique terminada, y entonces hay que poder decir por qué.
2. **Se puede hacer hoy.**
3. **Cabe en un turno**: entre ~5 y ~50 filas. Cero es un callejón sin salida; 500 es la mesa
   entera con otro nombre, y se aprende a ignorarla.
4. **No lo contesta otro chip.**

### 2. El predicado nuevo: `server/src/cola/pregunta.ts`, con TRES niveles

El primer intento fue **sacar `informaci` del regex**. Estaba mal y lo mostró el control: se
perdían pedidos escritos a mano y reales — «Necesito información», «Un poco más de información x
favor», «Información sobre el curso». *Lo que hay que vetar no es la palabra: es el texto de Meta.*

El segundo intento **vetaba la cortesía sobre todo el predicado**, y también estaba mal: descarta
frases que mezclan un agradecimiento con una señal de plata.

> ⚠️ **CORRECCIÓN (11-ago-2026, misma tarde).** El ejemplo con el que se escribió esta regla era
> falso. Se citó **«Pásame la cotización urgentemente quiero comprar ahora mismo»** como «el mejor
> lead de la mesa»; verificado después cruzando `persona_id` contra `numeros_wa`, es **Walter
> probando el bot** el 31-jul — el bot le contesta «Perfecto, Walter». Es una conversación entre dos
> líneas nuestras, no un lead.
>
> 🔴 **Antes de citar un texto de producción como caso, cruzá su `persona_id` contra `numeros_wa`.**
> Una línea de Goberna escribiéndole a otra se ve **exactamente igual** que una persona: mismo
> `persona_id` con forma de teléfono, mismo hilo, mismo todo. Lo encontró asignar conversaciones,
> no una revisión del ADR.

**La regla sobrevive porque el caso real existe y es más fuerte.** De las **63** conversaciones de
gente real cuyo último mensaje nombra plata, **6 llevan además una fórmula de cortesía**:

| texto real | qué es |
|---|---|
| `Cual es el precio. Gracias` | una pregunta de precio, con «gracias» al final |
| `Sí gracias por la información si hago un negocio en éstos días les envío el pago` | alguien que va a pagar |
| `Me inscribí en este curso, me lo dieron bastante barato…` | ya se inscribió |
| `Es un precio elevado. Gracias..para la próxima` | una objeción de precio |
| `Buenos días. Estoy evaluando mi inscripción. No puedo confirmar por ahora.` | vivo, evaluando |
| `Gracias pero andaré viajando estos meses…no me inscribiré` | un no de verdad |

Un veto de cortesía sobre todo el predicado descarta las seis, incluidas las tres primeras. De ahí
salen los niveles:

| Nivel | Qué reconoce | Vetos que lo tumban |
|---|---|---|
| **1 · PRECIO** | precio, costo, cuotas, yape, link de pago, cotización, inscribirme | **ninguno** |
| **2 · CONCRETO** | temario, certificado, requisitos, horario, factura, cuándo empieza | cierre, autorespuesta ajena |
| **3 · GENÉRICO** | información, `info`, más datos, me interesa, quiero saber | **+ el texto del anuncio** |

El nivel 2 le gana al veto del anuncio por una razón medible: **el texto que prellena Meta no
contiene ninguna de esas palabras**. Si alguien escribió «temario», lo escribió esa persona.

Vetos: **cierre** («no me interesa», «gracias por la información», «lo medito») y **autorespuesta
ajena** («Gracias por comunicarte con X ¿Cómo podemos ayudarte?» — vuelve al escribirle a un
número que es una cuenta de empresa; no es un lead pidiendo nada).

**Resultado medido sobre el mismo corpus**: 685 → **115** (65 con señal de precio, 50 que solo
piden datos), y **563** marcadas como texto del anuncio.

Los dos controles que lo validan están en el ADR de este frente y en los tests:

- Lo que el predicado viejo agarraba y éste descarta: rechazos, cortesías y autorespuestas de otros
  negocios. **Todo basura.**
- Lo que éste agarra y el viejo **no veía**: `Cuantas cuotas?` · `el nombre de yape es a nombre de
  una empresa?` · `Más tarde hago el pago` · `me podrías enviar el link de pago de nuevo`. **Todo
  bueno**, y todo señal de compra.

### 3. La barra nueva

| Chip | Hoy | Qué pregunta contesta |
|---|---:|---|
| **Preguntaron precio** | 65 | ¿Quién está en la plata? |
| **Te escribieron** | 33 | ¿Quién me espera y todavía llego? |
| Puedo escribirle | 25 | ¿A quién alcanzo antes de que cierre la ventana? |
| Pidió ayuda / El bot los ve calientes | 33 / 30 | ¿Qué me dejó el bot? |

### 4. La fila ya no finge una pregunta

`textoDePreview` (`src/lib/preview.ts`) gana un **paso 0**: si el texto lo escribió el anuncio, no
es preview. Cae al peldaño 3 de la misma cadena, que **ya tenía la frase exacta** desde antes de
este frente: **«📣 Vino del anuncio»**.

---

## Lo que se decidió y NO es obvio

- 🔴 **«Preguntaron precio» NO filtra por `respondida`, a propósito.** «Ya le contesté» no
  significa terminado: quien preguntó el precio, recibió el número y se calló es el seguimiento más
  rentable de la mesa — **ADR 0044 midió 540** conversaciones que se callaron justo con el precio.
  Filtrarlas escondería exactamente las que valen. El chip anterior necesitaba `AND NOT respondida`
  porque su predicado mentía; con el predicado arreglado el parche sobra.
- 🔴 **«Solo hizo clic» se arregla en el PREVIEW, no con una píldora al lado.** La primera idea fue
  una píldora; no sirve por dos razones. El renglón 2 ya reparte su lugar entre el chip del bot, el
  del curso y las categorías — y estas filas **casi siempre traen curso**, porque vienen de un
  anuncio de un programa, así que la píldora no se dibujaría justo donde importa. Y sobre todo:
  **una etiqueta al lado de la mentira no la corrige, la acompaña.** El programa no se pierde: lo
  sigue diciendo el chip de curso (ver la captura).
- 🔴 **El regex compartido no puede usar `\b` NI `\y`.** En Postgres `\b` es un backspace; `\y` es
  el borde de palabra de Postgres y JavaScript no lo entiende. `cola/precio.ts` ya lo documentaba —
  y **`canales/consultas.ts` lo pisó igual**: tenía una copia de `pide_info` con `info\b` que
  **nunca matcheó nada**, sin error y sin log. Verificado contra la base viva:
  `select 'necesito info hoy' ~* 'info\b'` → **f**. El borde de `info` se escribe a mano:
  `(^|[^a-záéíóúñ])info([^a-záéíóúñ]|$)`, que anda igual en los dos motores.
- ⚠️ **La deuda vieja no se esconde de la cola.** Las 472 conversaciones sin responder de más de 7
  días siguen en la lista y el orden las sigue poniendo donde corresponde. Lo que se retira es la
  **promesa** de que esas 505 eran el trabajo del día. `conteosFiltro.sinResponder` se sigue
  calculando (sin chip): es el número que dice si la deuda vieja crece.
- ⚠️ **«Ya compraron» sale de la barra pero no del producto.** Es el 27 % de la mesa: un atributo,
  no una lista de trabajo. La píldora verde de la fila y la banda de la ficha (#133) siguen igual, y
  el server sigue aceptando `intencion=ya-compraron`.
- ⚠️ **`info` a secas lo rescató un test, no el censo.** En 30 días **ninguna** conversación terminó
  con «info» sola, así que la medición no lo hubiera pedido nunca. El predicado viejo sí lo tenía
  —roto en una copia, sano en la otra— y sacarlo hubiera sido perder señal sin enterarse.
- ⚠️ **Compat de la API.** `intencion=pide-info`, `sin-responder` y `ya-compraron` se siguen
  aceptando aunque no tengan chip (mismo criterio que `por-vencer`, #49). `pide-info` se sirve con
  el **predicado nuevo**: la pregunta que quien lo pidió quería hacer hoy se responde bien. Y la
  migración de `localStorage` manda el valor viejo a «Preguntaron precio».
- ⚠️ **Los campos nuevos viajan opcionales.** `pregunto_precio` y `solo_clic` ausentes = server
  viejo, o respuesta rehidratada del caché de IndexedDB (ADR 0007). Degrada hacia lo de antes —se
  muestra el texto—, nunca hacia una fila muda.

---

## Los candados

| Test | Qué fija |
|---|---|
| `server/src/cola/pregunta.test.ts` | Los tres niveles y los vetos, **con textos reales de producción** (28 casos) |
| `server/src/cola/pregunta.paridad.test.db.ts` | **SQL ≡ TS** sobre un corpus de 50 textos, más un control de que el corpus discrimine |
| `server/src/cola/consultarCola.pregunta.test.db.ts` | Las dos decisiones de producto: el chip de precio no mira `respondida`, «Te escribieron» corta a 7 días. Y que el número del chip sea **exactamente** lo que su filtro devuelve (#37) |
| `src/lib/preview.test.ts` | El paso 0, y que **ausente** se comporte como antes del frente |
| `src/features/canales/cola.test.ts` | Los rótulos y la migración de `localStorage` |

---

## Evidencia

`docs/evidencia/filtros-cola-nuevos.png` — la barra con sus tres chips y las seis filas del censo.

Sin server: `npx vite --port 5199` → `/galeria-filtros.html`.
⚠️ **Todos los textos y números de esa galería salen de producción.** La galería del frente
anterior de la cola mostraba el caso ideal y por eso no reflejó ninguno de los tres defectos que
producción tenía a la vista. Una galería que no sirve los valores reales no es evidencia.

Cómo se midió:

```
ssh deploy@161.132.39.165 'docker exec -i hermes_db psql -U meta_escuela -d meta_escuela' < consulta.sql
```

⚠️ La base se llama **`meta_escuela`**; `hermes_db` es el nombre del CONTENEDOR.

---

## Lo que este ADR NO hace

- **No toca el orden de la cola.** La urgencia sigue viviendo en `cola/urgencia.ts` con su test de
  paridad; un pedido se encuentra por el chip, no empujando filas.
- **No decide qué hacer con las 472 de deuda vieja.** Es una decisión de una vez —¿se reengancha,
  se archiva?—, no el trabajo del día, y merece su propio frente.
- **No toca el tiempo de respuesta**, que es el hallazgo más grande del censo (36 % sin respuesta
  en la línea grande, 15 % contestado en menos de 5 minutos contra 65 % del bot). Eso es operación
  antes que código.
