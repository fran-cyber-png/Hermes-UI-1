# ADR 0021 — El lazo de resultados: la procedencia se escribe, el resultado se deriva

- **Fecha**: 2026-07-27
- **Estado**: aceptado
- **Épica**: #169, frente 1 (fundacional — sin esto los frentes 2 y 3 no se pueden medir)
- **Reemplaza**: nada. Extiende `envios_wa` y agrega `server/src/procedencia/` +
  `server/src/resultados/`.

## El problema, en una frase

`envios_wa` guardaba **qué se mandó** y nunca **de qué pieza salió**; y nada guardaba **qué pasó
después**. Una plantilla con 500 usos y 0 ventas se ve idéntica a una con 500 usos y 50: contábamos
disparos y jamás blancos.

Ya pagamos el precio. Sabemos que «se puede pagar en 2 cuotas» se dijo **2 veces en 1.876
conversaciones** y que decirlo destraba ventas — pero salió de un análisis puntual. Sin lazo, ese
hallazgo envejece y nadie se entera.

## Decisión

### 1 · La procedencia es un HECHO y se escribe, en la misma fila y en el mismo momento

Seis columnas nuevas en `envios_wa`, armadas **una sola vez** por `procedencia/pieza.ts` (nadie las
escribe a mano):

| columna | qué es |
|---|---|
| `pieza_clase` | `paso` · `dato` · `acuse` |
| `pieza_ref` | la identidad dentro del catálogo de su clase (`12#3`, `cuotas`, `fuera-de-horario-…`) |
| `pieza_version` | **sha256 del contenido autoral** |
| `pieza_via` | por qué pantalla entró (`panel-sugerencia`, `panel-secuencias`, `panel-datos`, `automatica`) |
| `pieza_editada` | ¿salió reescrito por la vendedora? |
| `momento_venta` | el `MomentoDeVenta` en que salió |

Viaja en la **orden de envío**, no en un `update` posterior: misma puerta (`EnvioControlado`), misma
fila de auditoría. Así un envío **bloqueado** también deja escrito de qué pieza iba a salir — si se
anotara al confirmar, cada freno ensuciaría la línea de base con mensajes que ni siquiera salieron.

### 2 · `null` no es un hueco: es la LÍNEA DE BASE

Lo que la vendedora escribe a mano es **contra lo que se compara todo lo demás**. Si una pieza no le
gana al texto que ella habría escrito igual, la pieza no sirve. Por eso el tipo no es `Pieza | null`
sino una unión con **dos ramas nombradas**, `A_MANO` tiene rótulo propio en los reportes, y la fila
de la línea de base sale **primera** en la tabla.

Y tiene un segundo uso que no es la métrica: **es el semillero de piezas nuevas**. «Se puede pagar en
2 cuotas» no salió de ninguna plantilla — la improvisó una persona. Por eso `HechosDeUnEnvio` lleva
el `texto` que salió: el corpus hacia Ivi (frente 3) puede recuperarlo sin cambiar el schema. Acá
solo se deja la puerta abierta; ni el export ni la anonimización se construyen en este frente.

### 3 · El resultado se DERIVA, nunca se guarda

Misma decisión que la etapa efectiva (ADR 0013), las señales (0015) y `no_leido` (0014): no hay fila
y no hay job. Un job que escriba el resultado es una **segunda escritura de la misma verdad**, y dos
escrituras divergen — la lección de #37. Acá divergir sería peor que en la cola: un veredicto viejo
**no se ve viejo**. «Esta pieza cerró 40 ventas» calculado con la regla del mes pasado se lee igual
que uno correcto.

Se derivan cuatro cosas: **¿contestó?** · **en cuánto** · **¿avanzó de etapa?** · **¿hubo venta
después?**

### 4 · El vocabulario no promete causa

Que un envío sea seguido de una venta **no dice que la haya causado**: la gente que ya iba a comprar
también recibe mensajes, y la pieza que más se manda a conversaciones calientes «gana» siempre. Los
nombres dicen lo que se vio y nada más — `huboRespuesta`, `huboAvanceDeEtapa`, `huboVentaDespues`; la
`base` de cada medición es `respondio_despues_de`, **nunca «efectividad»**. `medicion.test.ts` falla
si alguien mete una palabra causal en la lista, igual que `plantillas.test.ts` prohíbe que un acuse
se anuncie como máquina.

## Las cuatro decisiones que no son obvias

### A · `(clase, ref)` es textual y `via` es una columna aparte — para sobrevivir al frente 2

El frente 2 unifica los cuatro catálogos en uno solo, y va a llegar **cuando esta tabla ya tenga
meses de datos**.

- **`(clase, ref)` = QUÉ se mandó**, la identidad dentro de su catálogo, **textual y no una FK**. El
  día de la unificación esto se remapea con una tabla de equivalencias —`(paso, "12#3")` → pieza
  481— y lo acumulado sigue valiendo. Con una FK a `plantilla_pasos.id`, unificar obligaría a migrar
  o a tirar todo.
- **`via` = DE DÓNDE LA SACÓ la mano**, que es una propiedad de la **pantalla**, no del catálogo. El
  frente 2 no la toca, porque unificar catálogos no cambia por dónde entró la mano.

Mezclarlas dejaría sin respuesta una de las dos preguntas: «¿la secuencia 12 funciona?» (por pieza,
sumando vías) o «¿las dos respuestas del panel sirven de algo, o la vendedora elige mejor sola?» (por
vía, sumando piezas).

### B · La versión es un **sha256 del contenido**, no un contador

Sin versión, **el lazo mide un blanco móvil y no lo dice**: el día que alguien mejore la frase, los
dos textos se suman y una pieza que pasó de 12 % a 30 % se reporta **21 % para siempre** — justo el
número que existía para ver que el cambio funcionó. Y no tiene arreglo tardío: los envíos ya escritos
no se pueden re-atribuir a la versión que salió.

Es un hash y no un `version integer` por tres razones:

1. **No se puede olvidar de incrementarlo.** Un contador obliga a *cada* camino de edición (la UI de
   hechos, la de plantillas, un `UPDATE` a mano, un script de siembra) a acordarse de subirlo, y el
   bump que falta no rompe nada: **mezcla dos textos en silencio**, que es el modo de fallo exacto
   que estamos evitando.
2. **Sobrevive al frente 2**: el mismo texto conserva el mismo hash aunque la pieza cambie de id.
3. **Es comparable fuera de Hermes**, sin arrastrar la numeración interna.

Lo que un contador da y el hash no es el **orden**. No hace falta: `primerUso` de cada versión lo da,
y el reporte ordena por ahí.

**Qué es «el texto de la pieza», exactamente**: la plantilla **sin resolver**. `{nombre}`, `{curso}`
y `{precio}` se resuelven contra Cerberus en el instante del envío; hashear el mensaje final haría de
**cada destinatario una versión distinta** y el versionado no mediría nada. Cambiar la **imagen** de
un paso **sí** es versión nueva (el flyer es contenido). Cambiar solo espacios o saltos de línea,
**no** (se normalizan antes). Sin contenido conocido, la versión es `null` y se lee «no sabemos qué
texto era», nunca como una versión más.

El hash lo hace **el server**, no el navegador: desde el composer viaja el *texto* de la pieza. Dos
clientes con distinta normalización partirían en dos la historia de una pieza sin que nadie lo note.

### C · Una métrica no se puede serializar sin su `n` ni sin su `base`

Una pieza con **2 de 3** y otra con **180 de 400** se imprimen «67 %» y «45 %». Puestas una al lado
de la otra, cualquiera —humano o modelo— lee que la primera es mejor, y es al revés: con 3 usos no se
sabe nada.

`Medicion` tiene `base` y `n` **obligatorios**, y `medir()` es el único constructor: no hay forma de
armarla sin ellos, así que tampoco de serializarla sin ellos. **Es el tipo, no una convención** —una
convención se respeta hasta que alguien tiene apuro. Cada medición lleva además su **intervalo de
Wilson al 95 %** y un `muestraSuficiente` (umbral `MUESTRA_MINIMA = 30`) para que el consumidor
—incluido Ivi— pueda frenar en vez de recomendar la pieza de 3 usos.

Wilson y no la fórmula normal: esa se rompe justo donde más hace falta —con `n` chico da límites
fuera de `[0,1]` y para 0 de 20 da un intervalo de **ancho cero**, o sea «estamos seguros de que es
0 %», que es lo contrario de la verdad.

### D · La regla del ÚLTIMO MENSAJE, y cómo apareció

Una respuesta se le acredita **al último saliente antes de ella**, no a todos los anteriores. Si
después de un envío le escribimos otra cosa **antes** de que contestara, esa respuesta no es de ese
envío.

Apareció midiendo: se sembró un corpus sintético con la forma de los datos reales (2.000
conversaciones, hasta cuatro salientes espaciados dos horas, tasa de respuesta **22 %**) y el reporte
imprimía **54 %**. La misma respuesta se contaba cuatro veces. Y el inflado **no es parejo**: crece
con cuántos mensajes tuvo la conversación, que es justo lo que correlaciona con la gente que ya iba a
contestar — o sea que **premia a las piezas usadas en conversaciones largas**, que es exactamente el
sesgo que este trabajo existe para no cometer. Con la regla puesta, el reporte volvió a **21 %
[19 %–22 %]**.

En una secuencia de cuatro pasos, el paso 4 se lleva la respuesta. No se puede saber cuál de los
cuatro la ganó, y atribuírsela al último es la única regla que **no cuenta de más**.

## Dónde vive la regla (y por qué no hay test de paridad SQL≡TS)

El SQL (`resultados/consultarResultados.ts`) **solo trae hechos crudos**: cuándo salió, cuándo llegó
el primer entrante, cuándo salió el siguiente saliente, qué gestiones se asentaron y cuándo, cuándo
hubo venta. **Ni un `CASE`, ni una ventana, ni un umbral.** El veredicto (`loQuePaso.ts`) y el
agregado (`agregar.ts`) son puros.

Es el patrón de `senales/` y no el de `urgenciaSql.ts`: cuando la regla se puede decir en un solo
idioma, **se dice en uno solo y no hay con qué divergir**. El volumen lo permite de sobra — un envío
es una acción humana, así que `envios_wa` crece al ritmo de una persona escribiendo.

Lo que sí hay es un candado: `consultarResultados.test.db.ts` verifica que **el agregado es
exactamente la suma de los veredictos puros**, fila por fila. Si alguien «optimiza» el conteo
metiéndolo en un `GROUP BY`, ese test falla — es la lección de #37 aplicada a la única forma en que
podría volver a pasar acá.

## Las dos ventanas, y por qué son dos

Una respuesta y una compra no viven en la misma escala de tiempo. Con una sola ventana hay que elegir
entre dos errores: 48 h para la venta descarta casi todas las compras reales, y 14 días para la
respuesta le acredita a este mensaje un «hola» de la semana que viene.

- **«contestó»**: 48 h (`VENTANA_HORAS_POR_DEFECTO`)
- **«hubo venta después»**: 14 días (`VENTANA_VENTA_DIAS_POR_DEFECTO`)

Las dos se imprimen en el reporte: un porcentaje sin su ventana no se puede leer.

## «¿Compró?» — el seam y su degradación honesta

Depende del **PR #165** (`atribucion/`), que no está mergeado. `resultados/ventas.ts` es un seam con
dos implementaciones posibles y una regla dura:

- Hoy lee `conversiones_wa` cruzando por teléfono, que es lo único que esa tabla tiene. Si **no hay
  ni una fila**, declara que la atribución **no está conectada** y todo el lazo reporta
  `huboVentaDespues: null` — **«no lo sabemos», nunca «no compró»**. Cerberus tiene ~6.800 ventas:
  escribir «esta pieza cerró 0» sería cierto sobre nuestra tabla y una mentira sobre el negocio.
- El día que #165 esté, cambia **el `WHERE` de una consulta, en ese archivo**. `loQuePaso`,
  `agregar`, el endpoint y el script no se enteran.

`false` y `null` no se dibujan igual. Es el mismo criterio de `canales/verdad.ts` («no se midió» ≠
«es cero») y de `sinPadron` en la cola.

## Cómo se ve: un endpoint y un script, sin pantalla

`GET /api/resultados/piezas` (detrás de `requiereVendedora`) + `npm run piezas:resultados [días]`
(read-only), los dos sobre el **mismo seam**.

**Por qué no una pantalla todavía**: la procedencia se empieza a acumular *recién con este deploy*,
así que durante semanas una vista mostraría una tabla vacía; y el frente 2 va a reorganizar el
catálogo entero, o sea que la dibujaríamos dos veces. Pero un dato que nadie mira tampoco sirve, así
que el dato nace con un consumidor: el script, que es lo que quien escribe la próxima pieza va a
correr. Cuando haya qué mirar, la pantalla son cien líneas encima de algo que ya funciona.

**La regla de la tabla**: la muestra va pegada a **cada** número (`67% (2/3) [21%–94%] ⚠muestra
chica`), el orden es **por muestra y no por tasa** —ordenar por porcentaje pondría arriba a la pieza
de 2/3 justo donde la vista se posa—, y la primera fila es siempre la línea de base.

## Lo que deliberadamente NO se hizo

- **No se unificaron los catálogos.** Es el frente 2, y llega después a propósito: para que la
  migración se pueda medir contra esto.
- **No se construyó el corpus hacia Ivi ni su anonimización.** Es el frente 3. Solo se dejó la puerta
  abierta (`HechosDeUnEnvio.texto`).
- **No se guardó nada del resultado.** Ni caché, ni tabla materializada, ni job.
- **No se tocó ninguna regla de envío.** `EnvioControlado` sigue siendo la única puerta, la firma
  sigue siendo de a uno, y ninguna de las guardas cambió.
- **El acuse va sin `momento`.** La auto-respuesta decide con medio contexto
  (`estadoDesdeContexto`: a las 3 a. m. no consulta las señales), así que su momento no es el mismo
  objeto que el de las demás piezas. Anotarlo junto a ellos los volvería incomparables sin que se
  note.

## Consecuencias que conviene saber

1. **Las primeras semanas el corpus va a ser casi 100 % línea de base.** En producción hoy no hay ni
   una plantilla cargada y el bloque de datos recién se despliega. Eso no es un bug del lazo: es el
   punto de partida, y el script lo dice.
2. **Las cuatro frases del informe #153 no van a llegar solas a muestra decidible.** A la tasa
   histórica de uso (2 de 1.876 conversaciones ≈ 0,1 %), llegar a `n = 30` pide ~28.000
   conversaciones. **La primera pregunta que este lazo puede responder no es «¿cuál funciona?» sino
   «¿alguien las está usando?»** — y esa sí se contesta desde el día uno.
3. **Cambiar `MUESTRA_MINIMA` o las ventanas cambia veredictos, no datos.** Todo se deriva: se
   re-corre y listo.
4. **El `db:push` es manual.** Sin él, la consulta no encuentra las columnas y el script lo dice con
   ese motivo en vez de imprimir una tabla vacía que se lea como «nadie mandó nada».
