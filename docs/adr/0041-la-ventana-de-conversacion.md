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
- **`src/features/canales/ventana.ts`** — la lectura, pura: `null` cuando la ventana está cerrada,
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

## Evidencia

`docs/evidencia/ventana-de-conversacion.png` — los cuatro casos: WhatsApp con el oro solo abajo de
3 h, la ventana cerrada sin dibujar nada, los comentarios de FB/IG en la misma marca, y el respaldo
del server viejo. Se regenera con `npx vite --port 5199` → `/galeria-ventana.html`.
