# ADR 0052 — Los envíos de una plantilla se ven en la plantilla

**Fecha**: 10-ago-2026
**Estado**: aceptado — toca el server, va por **N5**
**Continúa**: **ADR 0022** (el lazo de resultados: de qué pieza salió y qué pasó después).
**No toca**: `corridas_campana` ni la solapa «Quién mandó qué» — ver §«Lo que NO se hizo».

---

## El problema

Pedido, textual: *«Luz debería poder ver los envíos que se mandaron de esta
plantilla `foro_estado_5_ago`»*.

La campaña del foro salió el 5-ago. Medido en producción el 10-ago, el hecho
estaba guardado y **completo**:

```sql
SELECT pieza_clase, pieza_ref, pieza_via, estado, count(*) FROM envios_wa …
 hsm | foro_estado_5_ago | campana | enviado | 1000
 hsm | foro_estado_5_ago | campana | fallido |    4
 hsm | promo_3x1_cursos  | campana | enviado |   88
 hsm | promo_3x1_cursos  | campana | fallido |    1
```

Mil cuatro filas con su procedencia estampada, su versión y su texto. Y **ninguna
pantalla las mostraba.** La única que podría —«Quién mandó qué»— lee
`corridas_campana`, que tiene **0 filas**, porque esa campaña salió por script y
no dejó firma de autorización. La pantalla no miente; dice exactamente eso:

> Todavía nadie autorizó una campaña desde la app. Las que salieron por script
> antes de esto no dejaron firma — por eso existe esta tabla.

El único lector que agrupa `envios_wa` por pieza es un script de terminal
(`npm run piezas:resultados`, sin pantalla a propósito, ADR 0022). O sea: **la
vendedora que mandó mil mensajes no tenía forma de saber cuántos salieron**, y el
dato para contestarle estaba a un `GROUP BY` de distancia.

---

## La decisión

**El conteo vive en la tarjeta de la plantilla** (Contactos → Campañas →
Plantillas), debajo del cuerpo. Server en `campana/enviosDePlantilla.ts`, ruta
`GET /api/campana/plantillas/envios`, front en `campana/envios.ts` (puro) +
`PantallaPlantillas.tsx`.

Ahí y no en otro lado porque **es donde está parada la vendedora cuando se hace
la pregunta**: mira `foro_estado_5_ago` y quiere saber cuánto se mandó. Una
pantalla nueva sería un lugar más al que llegar, y el dato es de la plantilla.

### 1. 🔴 «Cuántos salieron» y «de cuántos se puede medir» son DOS números

Y confundirlos hizo que la primera versión de este frente mintiera. Las dos
campañas que existen guardan la referencia distinto:

| plantilla | `referencia` | ¿la ve el lazo de resultados? |
|---|---|---|
| `foro_estado_5_ago` | `conv:whatsapp:<tel>:<linea>` | sí, las 1.004 |
| `promo_3x1_cursos` | **`campana:promo_3x1_cursos:<tel>`** | **no, ninguna de las 89** |

`consultarEnvios` filtra `referencia LIKE 'conv:%'`, y **tiene razón**: para
saber si alguien contestó hay que saber en qué conversación mirar. Pero contar
desde ahí hacía que la tarjeta de `promo_3x1_cursos` dijera «todavía no se mandó
ninguna vez» sobre **88 envíos que salieron de verdad** — el mismo cero engañoso
que este frente vino a arreglar.

Por eso **contar y medir tienen universos distintos**: `contarIntentos` mira
`envios_wa` entero (sin el filtro de `conv:`) y `medibles` viaja al lado de
`salieron`. Con eso la pantalla puede decir *«88 envíos · no se puede saber si
contestaron · estos envíos no quedaron atados a una conversación»* en vez de
«contestaron 0 de 0», que se lee como que no contestó nadie.

⚠️ Los que **no salieron** (`fallido`, o un `pendiente` colgado) se dicen aparte
y **nunca se suman**: meterlos adentro del total convertiría un fracaso de
entrega en alcance.

### 2. Se agrupa por plantilla, y por eso `versiones` viaja

`resultados/agregar.ts` agrupa por `(pieza, versión)` a propósito: sin eso,
mejorar una frase suma los dos textos y una pieza que pasó de 12 % a 30 % se
reporta 21 % para siempre. Acá la pregunta es otra —«¿cuánto se mandó ESTA
plantilla?»— y su respuesta es el rollup, que ese módulo declara posible **como
decisión explícita del que consulta**.

Como el rollup puede tapar que hubo dos textos, `versiones` viaja en la respuesta
y la tarjeta lo dice («con 2 textos distintos»). Un `version: null` **no cuenta
como un texto**: es «no se pudo determinar qué era», y contarlo diría «1 texto»
sobre algo que nadie sabe qué fue.

**Nada de esto reimplementa una regla.** `loQuePaso` sigue siendo quien dice qué
pasó después de cada envío y `medir` el único constructor de una `Medicion`. Lo
propio de este módulo es la clave de agrupación y el universo, y el candado es
`enviosDePlantilla.test.ts`: sobre los mismos hechos, la suma tiene que dar
igual que la de `agregar()`.

### 3. La línea de base va en la misma respuesta

Un 3 % solo no significa nada. La única referencia honesta es lo que la misma
gente logra escribiendo a mano en el mismo período — que es literalmente la
definición de `A_MANO` en ADR 0022: *`null` no es un hueco, es contra lo que se
compara todo*.

Medido:

```
foro_estado_5_ago   contestaron después: 26 de 1.000 (3%)   mediana 8 min
escrito a mano      contestaron después: 76 de   471 (16%)  mediana 4 min
```

⚠️ **La pantalla NO dice cuál gana.** Esa afirmación necesita que los intervalos
de Wilson no se toquen (`leGanaClaramente`, en el server) y el navegador no tiene
con qué verificarla. Se ponen los dos números al lado y la persona lee. Hay test
que falla si aparece «mejor», «peor», «gana» o «supera» en esa línea — el mismo
candado que `medicion.test.ts` tiene contra las palabras causales.

### 4. Los tres estados se dibujan distinto, y ese es el punto

| Qué pasó | Qué se dibuja |
|---|---|
| **no se pudo contar** (cargando, 502, 403) | **nada** |
| **no está en la respuesta** | «Todavía no se mandó ninguna vez» |
| **está** | cuántos · cuándo · qué no salió · cuántos contestaron |

La primera fila es la que importa: un «0 envíos» cuando el server no contestó
invita a **mandar de nuevo una campaña que ya salió a mil personas**. Por eso la
ruta responde 502 con su motivo (nunca una lista vacía, cicatriz de ADR 0023) y
el front no dibuja nada. La decisión vive en `queDibujar()`, pura y con test:
el defecto no se vería en una captura, porque una captura se saca cuando el
server anda.

### 5. La consulta va aparte de `/plantillas`, a propósito

El catálogo sale de **Meta** y esto de **nuestra base**, así que se caen por
motivos distintos. Metido adentro, una consulta lenta dejaría a la vendedora sin
poder ver qué plantillas tiene aprobadas — lo único que esa pantalla no puede
dejar de hacer.

La ventana por defecto es de **90 días** y no de 30 como el reporte de piezas:
una campaña se manda una vez y se la mira durante semanas, así que a 30 días la
tarjeta de una plantilla de hace dos meses diría «0 envíos».

---

## Lo que NO se hizo

🔴 **No se backfillea `corridas_campana`.** Esa tabla responde «quién
AUTORIZÓ», y escribirle una fila por una campaña que nadie autorizó desde la app
sería **falsificar justo la firma que existe para auditar**. «Quién mandó qué»
sigue vacía y sigue diciendo la verdad; el día que alguien arme una campaña desde
la app, se llena sola.

**No se toca el reporte por pieza** (`piezas:resultados`): sigue siendo el lugar
donde las versiones se ven separadas, que es la pregunta «¿qué texto funcionó
mejor?». Esto contesta la otra.

---

## Lo que este frente dejó medido y no arregla

- 🔴 **De los 1.004 envíos del foro no se sabe cuántos LLEGARON**:
  `estado_entrega` está en `null` en las **1.778 filas** de `envios_wa`. No es un
  bug: el frente de los ✓✓ entró el **7-ago** (`6199fda`) y la campaña es del
  5–6. **No hay backfill posible.** Y desde el 7-ago hubo **un solo envío** en
  toda la base, así que tampoco se puede afirmar que los recibos anden hoy: n=1.
- ⚠️ **290 de 1.778 envíos (16 %) son invisibles para el lazo de resultados** por
  no tener clave `conv:` — 89 de `campana:` y 201 de `bot-auto-conv:`. Este ADR
  los hace **contables**; medirlos es otro frente, y empieza por decidir si esas
  referencias tienen que existir.
- **El resultado de la campaña, dicho sin adornos**: 3 % contra 16 % de la línea
  de base, sin una etapa avanzada ni una venta posterior. Es un dato para decidir
  la próxima campaña, no una conclusión sobre las campañas en general — la
  muestra es una.

---

## Evidencia

`docs/evidencia/campana-envios-de-la-plantilla.png` — las tres plantillas reales
de producción, con los tres estados en una sola pantalla: el foro con sus
números, `promo_3x1_cursos` que salió y no se puede medir, y `hello_world` que
nunca se mandó.

Sin server: `node scratchpad/stub-campanas.mjs` +
`VITE_API_URL=http://localhost:4199 npx vite --port 5199` →
`/galeria-campanas.html?seccion=plantillas`. ⚠️ El stub sirve **los valores
medidos en producción**, no unos lindos: es la lección de la galería del radar,
donde un stub ideal tapó tres defectos que producción tenía a la vista.
