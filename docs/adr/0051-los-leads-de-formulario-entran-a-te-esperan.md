# ADR 0051 — Los leads de formulario entran a «Te esperan»

**Fecha**: 10-ago-2026
**Estado**: aceptado — toca el server, va por **N5**
**Continúa**: **ADR 0050** (el tablero muestra lo que se trabaja) y **ADR 0049** (los rótulos).
**Cierra** el #4 pendiente de `docs/plan-pipeline-por-canal.md` §4.

---

## La decisión del dueño

*«"te esperan" debe estar dentro los de los formularios de icarus»*.

O sea: **la columna no es «te escribieron por WhatsApp», es «la pelota es nuestra»** — sin importar
por dónde llegó la persona. Quien llenó un formulario y no recibió un mensaje está esperando
exactamente igual que quien escribió y no fue respondido.

## Lo que se corrigió al medirlo

🔴 **No son 25.386 tarjetas, son 141.** El plan anterior dimensionó el frente sobre el histórico
completo y concluyó que arrastraba virtualización («25.386 paginadas de a 30 son 846 clics»). Pero
**la cola mira 30 días** (`ventanaCola`), y adentro de esa ventana los leads sin contactar son
**141** — 34 en la última semana.

Y la ventana no es una limitación: **es la definición**. «Te espera» un lead de esta semana; uno de
hace ocho meses al que nadie escribió no está esperando, está perdido — y meterlo en la mesa de
trabajo la volvería la misma pila muerta que «Nunca contestaron», que se sacó por eso mismo
(ADR 0050).

## Cómo entra

Un tercer brazo en el `UNION ALL` de la cola (`cola/leadsCte.ts`), al lado de los comentarios y las
conversaciones. **No hizo falta una etapa nueva**: un lead sin mensajes tiene `hablo = false` y
`ya_le_hablamos = false`, y con eso `etapaDerivada` cae **sola** en `interesado` — que es «Te
esperan». No entra a `sin_respuesta`, que exige que le hayamos escrito.

Verificado contra la base de producción, read-only, antes de escribir el front:

| | |
|---|---|
| filas | **141** |
| con nombre | 141 (100 %) |
| con curso | 141 (100 %) — todos dicen qué quieren |
| etapa derivada | **`interesado`** |

### Las tres guardas

- **Deduplicación**: un lead que ya tiene conversación no aparece dos veces. Se compara con
  `sufijoTelefonoSql`, **la llave canónica** (#37). ⚠️ El sufijo de 9 es un match débil (#119), pero
  acá **falla hacia el lado seguro**: un choque esconde un lead (una fila de menos), nunca duplica
  una conversación viva. Es lo contrario de `clienteSql.ts`, donde un falso positivo pinta una venta
  que no existe — por eso allá hay guarda de país y acá no hace falta.
- **Recorte por línea**: se caen, como los comentarios. Nadie les escribió, así que no entraron por
  ningún número nuestro.
- ⚠️ **Recorte por canal**: se deciden **antes** de armar el SQL. Su brazo lee `leads`, que **no
  tiene columna `canal`**, así que el `AND canal = …` de los otros dos ni siquiera compilaría contra
  esa tabla.

## La marca en la tarjeta, y por qué no es cosmética

🔴 **Dos trabajos OPUESTOS comparten columna.** A quien te escribió le contestás y es gratis; a un
lead de formulario hay que **abrirle** el chat en frío, que en las líneas whatsmeow es el camino
corto al ban (regla dura #7). Sin marca, las dos tarjetas se ven iguales.

Lleva una píldora **«Formulario»**, y va en el **segundo renglón**: al lado del nombre se lo comía
(«A…», «L…») en una columna de 225 px. **Lo mostró la captura, no un test.**

## Lo que este ADR NO resuelve

**Qué hace el botón.** La columna ahora muestra a quién hay que abrirle conversación, pero *abrirla*
sigue teniendo un problema de canal antes que de código. Ver `docs/plan-reparto-de-leads.md` y la
nota de ADR 0035: *«Repartir NO manda nada»*.

Mostrarlos ya vale por sí solo —hasta hoy el Pipeline ordenaba el 2,5 % del negocio y estas 141
personas no existían en ninguna pantalla— pero la acción es un frente propio.

---

## Enmienda (11-ago-2026) — estaban en la columna y no se podían ver

**Reporte del dueño**: *«"te esperan" debería salir tmb los formularios enviados a icarus»* — sobre
una captura donde la columna **ya decía 531** (377 conversaciones + los 154 formularios de hoy).

O sea: el frente estaba entero y el número era correcto. Lo que fallaba era **el orden**.

### El defecto, en tres hechos

1. `leadsCte` emite `tipo = 'lead'`.
2. `cola/urgencia.ts` ramificaba por `tipo === 'mensaje'` en los niveles 0, 3 y 4, así que un lead
   **no matcheaba ninguno de los cinco primeros y caía al 5** — el nivel que ese mismo archivo
   describe como *«EL RESTO: ventanas cerradas y comentarios respondidos. Nada de esto corre
   peligro»*. Justo al revés de lo que es un lead recién llegado.
3. Todas las conversaciones de «Te esperan» son **nivel 3**: `interesado` se deriva de
   `NOT respondida`, que ES la condición del nivel 3.

Con `ORDER BY nivel ASC` y 40 filas por página, **los 154 formularios quedaban después de las 377
conversaciones: página 10**. La columna los contaba y no había forma de llegar a ellos.

### 🔴 Y era una divergencia MUDA entre las dos escrituras de la urgencia

`urgencia.paridad.test.db.ts` existe justo para atrapar esto (#37), y no lo vio por dos razones que
se tapaban entre sí: **no sembraba ningún lead**, y su `comoItem` colapsaba a `'mensaje'` todo lo que
no fuera comentario — así que la función pura decía nivel 0/3 y el SQL decía 5 sobre la misma fila.
Ahora el tipo viaja tal cual y hay un caso sembrado por nivel.

### El arreglo

`ESPERAN_RESPUESTA = ['mensaje', 'lead']` en `cola/urgencia.ts`, y `urgenciaSql.ts` **genera su `IN`
desde esa constante** en vez de tipearlo — era la cuarta escritura de la misma lista.

⚠️ **La lista es explícita y no `tipo !== 'comentario'`**: con la negación, un `tipo` nuevo entraría
de callado arriba de todo en la cola de la vendedora. Que caiga al nivel 5 es un default aburrido;
que se cuele en la deuda, no.

**Un formulario se ordena igual que un mensaje entrante**, que es lo que es: `< 24 h` → nivel 0
(VIVO, el más reciente primero — *velocidad = venta*, el argumento que el nivel 0 ya tenía escrito);
más viejo → nivel 3 (ESPERA, el más viejo primero). **No se ordenan aparte: se intercalan** con las
conversaciones por fecha, que es la consecuencia de que la columna signifique «la pelota es nuestra».

### Qué se ve, medido en producción el 11-ago-2026

| | |
|---|---|
| formularios en la columna | **154** (eran 141 el 10-ago) |
| **suben al nivel 0 (arriba de todo, incluidas las conversaciones)** | **20** |
| llegados en la última semana | 45 |
| el resto | se intercala por fecha entre las 377, en vez de ir después de todas |

### Alcance: esto también cambia el orden de **Mensajes**

Los leads ya entraban a esa cola (el mismo `todo`), también en el nivel 5. Con la enmienda, un
formulario de hoy aparece **arriba** en la mesa de trabajo. Es la consecuencia buscada y no un efecto
colateral: si «la pelota es nuestra» ordena el Pipeline, tiene que ordenar igual la pantalla donde
ese trabajo se hace — dos órdenes distintos para el mismo hecho es el defecto de #37.

---

## Evidencia

`docs/evidencia/te-esperan-con-formularios.png` — las dos formas conviviendo en la columna.
⚠️ Los tests con base (`consultarCola.leads.test.db.ts`) **no se corrieron localmente** (sin Docker
en la máquina): los corre **N2b** en CI. El SQL sí se validó contra la base de producción.
