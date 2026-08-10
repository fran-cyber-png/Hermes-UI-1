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

## Evidencia

`docs/evidencia/te-esperan-con-formularios.png` — las dos formas conviviendo en la columna.
⚠️ Los tests con base (`consultarCola.leads.test.db.ts`) **no se corrieron localmente** (sin Docker
en la máquina): los corre **N2b** en CI. El SQL sí se validó contra la base de producción.
