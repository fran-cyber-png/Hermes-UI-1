# ADR 0055 — La campaña a una lista de afuera: contacto en frío, autorizado y acotado

**Fecha**: 14-ago-2026
**Estado**: aceptado — script suelto, no toca el server ni el front (no necesita N4 ni N5)
**Enmienda** el ADR 0015 §37 («no inicia conversaciones»): abre **una excepción nombrada**, para una
campaña por plantilla aprobada y con autorización del dueño. No la deroga.
**Se apoya en** la campaña por fechas del 4-ago (`server/src/scripts/campana.ts`,
`campana/publico.ts`, `campana/vetoAlSalir.ts`): reusa el veto, la procedencia, la puerta de envío y
el freno.

---

## El pedido

Vender las entradas que faltan del **XII Foro de Estado** (29-ago-2026, Hotel Westin Lima, aforo
200) ofreciéndoselo al padrón de clientes de icarus, no sólo a quien escribió por WhatsApp.

`server/src/scripts/campana.ts` sólo sabía armar el público con un `SELECT` sobre `interactions`:
gente que le **escribió** a la línea entre dos fechas. Medido sobre los 1.000 prospectos filtrados
del padrón, **963 nunca le habían escrito a Goberna por WhatsApp** — ninguno habría entrado por esa
puerta.

## La decisión

`--lista <archivo.csv>` cambia **de dónde salen los candidatos, y nada más**. Todo lo que viene
después es el mismo camino: el rechazo, la despedida, el `ya_le_llego`, el veto del instante del
envío, la procedencia, `EnvioControlado` y el freno.

### Esto es contacto en frío, y se dice con todas las letras

El ADR 0015 §37 dice «no inicia conversaciones: jamás un primer contacto». Este modo lo hace. **Que
el modo exista no lo autoriza — lo autoriza una decisión del dueño**, y esa decisión es este ADR.
Lo que el código aporta es que sea **auditable** y que nadie reciba lo que no le corresponde:

- el encabezado del simulacro imprime **«🧊 CONTACTO EN FRÍO»**, en vez de dejar que se deduzca de
  los flags de la línea de comandos;
- el simulacro es el default y el envío pide `--enviar`;
- cada renglón dice si esa persona nos escribió alguna vez y si ya compró.

**Qué NO autoriza este ADR**: mandar sin plantilla aprobada, mandar a quien dijo que no, generar
texto libre, warmup, anti-ban, ni ninguna forma de que el tráfico no se detecte. La regla dura #7
sigue entera, y el dry-run con la lista a la vista sigue siendo obligatorio.

### El teléfono es el problema, no la lista

Cuando el destinatario ya te escribió, el número te lo dio WhatsApp y es correcto por construcción.
Cuando sale de un padrón cargado a mano durante años, no. En la lista real del Foro conviven
`995984814`, `+51 995984814`, `5151997604093` (el código de país dos veces) y `511234`.

🔴 **Un número malformado no cuesta un mensaje: cuesta la corrida.** El bucle frena ante cualquier
error de Meta que no sea el `131049`, así que uno solo en la posición 12 deja sin mandar a los 238
de atrás. Y un número mal leído no es un envío perdido — es **un mensaje que le llega a otra
persona**, que en frío no tiene con qué entender quién le escribe.

Por eso `campana/lista.ts` es estricto a propósito: entran las dos formas que se leen de UNA sola
manera (9 dígitos que empiezan con 9, o `51`+eso) y **todo lo demás se descarta con su motivo**
(`otro_pais`, `telefono_ilegible`, `sin_telefono`), nunca en silencio. No se adivina la partición de
`512221285857`. El sesgo es al falso negativo, el mismo de `rechazo.ts`.

Se verificó que no esté descartando de más: de los 115 ilegibles de la lista real, casi todos son de
otro país mal escritos (19 ecuatorianos sin el `5` de `593`, un español, un croata) o peruanos
irrecuperables. **No hay rescate que valga la pena.**

### Dos vetos se apagan, y hay que entender por qué

- **«Llegó por un anuncio»**: un contacto del padrón nunca escribió, así que no puede tener anuncio.
  Dejarlo prendido descarta la lista entera por `sin_anuncio`.
- **«Ya compró»**: mira `clientes_padron`, que responde «compró ALGO alguna vez» — y una lista de
  prospectos de un evento **son clientes por definición**. Lo que hay que garantizar es que no
  compraron **ESTE** producto, y ese dato vive en `icarus.sales`, no en Hermes: **se garantiza al
  generar la lista y se verifica ahí**. Haber comprado no descalifica; al revés que en la 3x1, que
  vendía los cursos que esa gente ya tenía, el Foro es otro producto y un ex-alumno es mejor
  candidato.

El simulacro **los nombra** en vez de esconderlos, porque un veto apagado en silencio se lee como un
veto que corrió.

### 🔴 Renombrar la plantilla apagaba el candado del doble envío

La guarda de `ya_le_llego` compara `pieza_ref` contra la plantilla de ESTA corrida, y **Meta obliga
a crear una plantilla nueva para cambiarle una letra al texto**. O sea que la segunda campaña de un
mismo evento —el caso normal— es justamente donde la guarda deja de reconocer a quien recibió la
primera.

Medido: `foro_estado_5_ago` salió a **1.000 personas** el 5 y 6 de agosto, y **360 están en la lista
del mismo Foro**. Con la plantilla v2 y sin arreglarlo salían **244 en vez de 104** sobre una tanda
de 245 — y el simulacro lo informaba como «1 porque YA recibieron esta campaña». Una guarda que da
verde porque mira el nombre equivocado es peor que no tenerla.

`--ya-recibieron <refs>` suma piezas a las **tres** preguntas que hacen de candado (el armado del
público, el cruce de la lista y el veto al salir), que comparten `PIEZAS_QUE_BLOQUEAN` para que no
se puedan desincronizar.

### 🔴 `reasignar()` no verifica el destino, y este script no pasa por la ruta

La guarda de `reparto/destino.ts` vive en `/api/reparto`. Un dedazo en `--asignar-a` escribía filas
perfectamente válidas con un `vendedora_id` que no existe, y esas conversaciones desaparecían de la
cola de todos sin un solo síntoma — el fallo exacto que ese módulo existe para impedir, entrando por
la puerta de atrás. Con mil conversaciones de por medio dejó de ser teórico. Ahora se verifica
**antes de leer nada**, reusando `destinosPosibles`/`esDestinoValido`.

### Se asigna lo que se manda, no lo que se filtró

`aAsignar` = los que reciben ahora **+ los que ya lo recibieron antes**. Nunca los que el `--tope`
dejó afuera: a esas personas no les escribió nadie, y ponerles dueña las mete en su «Míos» como
trabajo que no existe.

## Lo que esto cuesta, medido

La campaña anterior (`foro_estado_5_ago`, 1.000 personas) tuvo **31 respuestas y 1 compra**. De los
27 que compraron el Foro desde el 5-ago, uno solo había recibido el flyer.

**No es un argumento para no hacerla; es el orden de magnitud con el que hay que decidir.** Para los
70 cupos que faltaban, un contacto personal a los mejores prospectos rinde más que otra plantilla
masiva. Y el riesgo no es simétrico: `51984429504` es la **única línea que trae leads**, y una caída
de su calidad cuesta el canal de adquisición entero.

## Alternativas descartadas

- **Un script nuevo aparte**: duplicaba el veto, la procedencia y el freno. Dos caminos hacia
  `envios_wa` que acepten cosas distintas es #37, y se nota tarde.
- **Relajar `excluirClientes` adentro de `publico.ts`**: la regla es correcta para su caso; lo que
  cambia es el origen del público. Se decide en el llamador y se imprime.
- **Arreglar los teléfonos rotos**: adivinar es escribirle a un desconocido. Se descartan con motivo.
