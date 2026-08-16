# ADR 0041 — «Se le puede hablar»: la ventana de conversación, y por qué NO es una etapa del embudo

**Fecha**: 7-ago-2026
**Estado**: aceptado
**Enmienda a**: nada. **Convive con**: ADR 0009 (la urgencia vive una vez), ADR 0016 (las señales se derivan, no se guardan)

## El problema

El dueño lo pidió así: *«quiero agregar una nueva categoría al embudo, para el estado cuando está
abierto a poder hablar — en WhatsApp las 24 horas antes de que se cierre, y en IG/Facebook cuando
comentan, para tenerlos mapeados»*.

La cola de Hermes ordena la **deuda**: quién espera hace más tiempo (`cola/urgencia.ts`, seis
niveles). La pregunta de al lado —**¿a quién todavía se le puede hablar?**— no la respondía nadie,
y Meta cierra esa puerta sola.

De los dos plazos, Hermes modelaba **uno solo**:

| | plazo | ¿estaba? |
|---|---|---|
| Comentario de FB/IG | 7 días desde el comentario | sí — `ventanaDiasSql`, alimenta el nivel 2 (`EXPIRA`) |
| Chat de WhatsApp / Messenger | 24 h desde el último **entrante** | **no existía en ningún lado** |

`ventanaDiasSql` (`cola/urgenciaSql.ts:109`) devuelve `NULL` para todo lo que no sea
`facebook`/`instagram`. O sea que en **WhatsApp —que es donde Goberna vende— la ventana no se
calculaba**. Lo más parecido era el nivel 0 (`VIVO`), que exige *sin responder*: el caso más valioso
—ya le contestaste, la ventana sigue abierta, podés escribirle texto libre sin plantilla— era
invisible.

**Y había un filtro que decía hacerlo.** La intención `puedo-escribirle` de `consultarCola.ts` era:

```sql
(ventana_abierta OR tipo = 'mensaje')
```

`tipo = 'mensaje'` no mira ningún plazo, así que **para un chat de WhatsApp era siempre verdadera**:
el filtro devolvía la cola entera. Era compat de la cola vieja, donde ese valor había sido el tab por
defecto; se lo retiró en #49 por abrir la cola vacía, y nadie notó que además mentía.

## La decisión

### 1. No es una etapa del embudo — es una señal derivada, ortogonal

El embudo es `interesado → contactado → cotizado → cierre` + `perdido`
(`gestiones/registrarGestion.ts:22`). Son etapas de **la venta**. La ventana es el estado del
**canal**, y las dos dimensiones son independientes: se puede estar `cotizado` con la ventana
cerrada, o `interesado` con la ventana abierta.

Como etapa habría sido destructivo, y de una forma que no se ve hasta que pasa: una conversación
tiene UNA etapa, así que marcar «abierto» **borra `cotizado`** y el embudo pierde la cuenta de la
venta. Y cuando la ventana se cierra sola tres horas después, no hay a dónde volver.

Se resuelve como las señales de ADR 0016 («Cotizado», «Se enfrió»): **se deriva en cada consulta,
no se guarda**, no hay fila ni job, y aparece como **chip de filtro con su número** más una marca en
la fila. El embudo no se toca.

### 2. Desde el último ENTRANTE, nunca desde lo último que pasó

Es el detalle que hace que la cuenta sea la de Meta y no una parecida: **la ventana la abre quien
escribe, y nuestra respuesta no la extiende ni la cierra**.

Por eso la regla no usa `referencia` (`urgenciaSql.ts`), que salta al máximo global en cuanto
contestamos. Con ella, responder a las 23 h se habría leído como «te quedan 24 h más», y la
vendedora se enteraba de la puerta cerrada al recibir el rechazo de Meta.

### 3. LA SEÑAL SE DICE EN POSITIVO, Y NO PUEDE DEJAR DE ESTARLO

Medido el 7-ago-2026 en VPS1 (`numeros_wa` + el `.env` de producción):

```
whatsmeow (3 líneas):  51986394450 · 51941654039 · 51944531711
Cloud API (1 línea):   51984429504  ← «Ventas Meta», la del bot
```

**El plazo de 24 h es duro solo en la línea de la Cloud API.** Pasadas las 24 h Meta rechaza
cualquier texto libre y solo entra una plantilla aprobada. En las tres líneas whatsmeow de las
vendedoras **Meta no rechaza nada**: ahí el riesgo de escribir en frío es el ban, no el error.

De ahí la regla que no se negocia: **se dice a quién SÍ se le puede hablar, jamás a quién no.** Una
ventana cerrada **no dibuja nada**. Un «ya no le podés escribir» sería falso en tres de cuatro
líneas, y el costo de esa mentira es una venta que nadie intenta.

Es la misma forma que `whatsapp/limitesMedia.ts`: **lo que impone el plazo es el transporte de esa
línea**, así que Hermes solo afirma lo que vale para todas.

### 4. El oro vuelve a significar lo que dice `index.css`

En Hermes el dorado significa **tiempo que se acaba**, y nada más. La marca vieja pintaba de oro
*toda* ventana abierta — incluida una de 6 días, que no es tiempo que se acabe. El oro terminaba
queriendo decir «comentario».

Ahora el oro aparece solo abajo de `UMBRAL_ORO_MS` (3 h); arriba va en tinta neutra sobre fondo
tenue, como las demás señales automáticas.

## Cómo está hecho

- **`server/src/cola/ventana.ts`** — la regla, pura y con tests. `ventanaCierraEn` devuelve el
  INSTANTE del cierre; `null` es **no aplica**, distinto de una fecha pasada («se cerró»).
- **`ventanaCierraSql` / `puedoEscribirleSql`** en `cola/urgenciaSql.ts` — el gemelo SQL, porque la
  cola pagina en la base. **`ventana.paridad.test.db.ts`** corre los dos contra los mismos datos y
  verifica el instante, no solo el sí/no: un booleano igual puede salir de dos plazos distintos.
- **`ventanaDiasSql` NO se toca.** Es el contrato del nivel 2 (`EXPIRA`), vale solo para comentarios
  y tiene su propio test de paridad. Se comparte la **constante** (`VENTANA_META_DIAS`), no la
  expresión: son dos preguntas distintas que coinciden en un número.
- **`src/dominio/ventana.ts`** — la lectura, pura: `null` cuando la ventana está cerrada,
  cuando no aplica, y cuando el server todavía no manda el campo. Redondea para **abajo**: con 6 h
  50 min dice «6 h», porque el error que importa acá es el que llega tarde.
- El front lee `ventana_cierra` como **opcional** y conserva la marca vieja como respaldo: N4
  despliega el front solo y N5 el server a botón, así que existe una franja con el front nuevo
  hablando con el server viejo. Sin el respaldo, ahí los comentarios perderían la cuenta regresiva.

## Lo que cuesta

- **La marca aparece en casi todas las filas frescas de WhatsApp.** Toda conversación viva de menos
  de 24 h la tiene. Es información, no alarma, y por eso va neutra salvo en las últimas 3 h — pero es
  una marca más en un renglón que ya acumula (nombre, ex-cliente, dueño, etapa).
- **El umbral de 3 h es absoluto, no proporcional.** Para un comentario de 7 días el oro llega muy
  sobre la hora. Se eligió una sola regla explicable antes que dos umbrales por canal; si se demuestra
  que el aviso de los comentarios llega tarde, el cambio es una línea en `UMBRAL_ORO_MS`.
- **En las líneas whatsmeow la señal es un consejo, no un límite.** Ahí «se cerró» no significa que
  Meta vaya a rechazar el mensaje, sino que abrir en frío es riesgo de ban. La UI no distingue las dos
  cosas a propósito: las dos piden lo mismo (hablar ahora), y distinguirlas obligaría a explicar el
  transporte de cada línea en una píldora de 40 px.

## La barra pasa a tener dos pistas, y no es un extra

Un chip más en una barra que ya se desbordaba es una regresión, no una función. Medido en el PR
#304 (6-ago) con la captura del dueño: con las **cuatro líneas vivas**, el segmentado se comía los
336 px enteros — «Piden info» cortado contra el borde y **«Sin responder» sin verse**. Había que
descubrir a mano que la barra scrolleaba.

Y eso dejó de ser tolerable cuando la cola empezó a bajar lo leído (7-ago): desde ahí **«Sin
responder» es la red de seguridad** que devuelve la deuda entera, y *una red detrás de un scroll
invisible no es una red*. Agregar «Puedo escribirle» sin tocar la barra habría empujado esa red un
lugar más lejos.

Se **rescata la solución de #304** —dos pistas: arriba se elige *qué cola*, abajo se recorta
*dentro*— y **nada más de ese PR**. Su idea central («lo visto se va abajo») ya había entrado por
#310 con otra implementación, y su cursor-al-salir contradice el cursor-al-abrir que #310 dejó en
`main`; mergear las dos habría dejado dos mecanismos de orden superpuestos. #304 se cierra con esa
explicación.

Lo que viene con la barra rescatada, y vale la pena conservar: cada pista tiene **su propio** estado
de sombra y su propia navegación por teclado (con un `ref` compartido, el degradado de una fila
mentiría sobre la otra), y **lo encendido se trae a la vista** tocando solo `scrollLeft` — con
`scrollIntoView({block:'nearest'})` los chips activos arrastraban **la página entera** y la cola
aparecía empezada por la mitad.

Cuesta ~26 px de alto.

## Y en el Pipeline (7-ago-2026, pedido del dueño al ver la vista)

*«Falta que el pipeline también: los que están en la ventana de poder hablarles sin costo, los de
IG, Facebook y WhatsApp.»* El «sin costo» es lo que hace valioso al recorte: en la línea de la Cloud
API, fuera de la ventana solo entra una **plantilla aprobada**, y esa se cobra.

Entra por dos lados, y hacen falta los dos:

- **Un tercer chip de recorte en Contactados**: `Todas · Con precio N · En ventana N`. Un solo eje con
  tres posiciones, no dos toggles cruzados — de las cuatro combinaciones, «sin precio y fuera de
  ventana» no es una lista que nadie pida. El número sale de una **dimensión nueva del desglose**
  (`FilaDesglose.ventana`), y `ventana.paridad.test.db.ts` fija que el número del chip sea
  exactamente lo que devuelve `?ventana=1`: son dos caminos hacia el mismo predicado y, si
  divergieran, el tablero ofrecería una cifra y devolvería otra lista sin un solo error.
- **La píldora en la tarjeta, en TODAS las columnas.** El chip solo existe en Contactados, y el caso
  más valioso del tablero es un **Cotizado con la ventana abierta**: sabe el precio *y* se le puede
  escribir gratis ahora. Esa columna no tiene recorte, así que sin la píldora ese caso seguía
  invisible. Misma lectura que la fila de la cola (`dominio/ventana.ts`), así que «6 h» significa lo
  mismo en las dos pantallas.

⚠️ **`precio` y `ventana` no se derivan una de la otra**, y el test lo fija: de las 611 con precio,
solo 12 están en ventana. Derivar una de la otra haría que el chip prometiera una lista que no es.

## Evidencia

`docs/evidencia/ventana-en-el-pipeline.png` — el tablero con los tres chips de recorte y la píldora
en las cuatro columnas. Se regenera con `/galeria-embudo.html`.

`docs/evidencia/ventana-de-conversacion.png` — los cuatro casos: WhatsApp con el oro solo abajo de
3 h, la ventana cerrada sin dibujar nada, los comentarios de FB/IG en la misma marca, y el respaldo
del server viejo. Se regenera con `npx vite --port 5199` → `/galeria-ventana.html`.
