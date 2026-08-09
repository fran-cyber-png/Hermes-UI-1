# ADR 0044 — El embudo se deriva de lo que hizo el COMPRADOR, no de lo que mandamos

**Fecha**: 8/9-ago-2026
**Estado**: aceptado — **vivo en producción** (`043544f`, N5 del 9-ago 14:57 Lima)
**Enmienda a**: **ADR 0013** (la etapa efectiva). **Convive con**: ADR 0009 (la regla vive una vez,
pura + SQL + paridad), ADR 0016 (las señales se derivan, no se guardan), ADR 0041 (la ventana)

---

## El problema

El dueño lo pidió así: *«el pipeline lo podríamos mejorar mucho, replantear para poder hacer que
Hermes haga fácil monitorear y planificar estos datos»*, y después: *«¿está bien el embudo que
estamos proponiendo? ¿es útil? ¿es profesional?»*.

La pantalla que lo disparó mostraba `544 Contactados · 3.051 Cotizados · 0 Cierre · 0 Perdidos`.

Dos cosas estaban mal, y ninguna era de dibujo.

### 1. Una columna de 3.051 no es una lista de trabajo

Es la misma pila con otro rótulo. Y la etapa **iguala a dos personas que no son lo mismo**: una
recibió el precio hace 40 minutos, la otra hace tres semanas y no contestó nunca. Lo que las
separa no existía en ninguna forma — ni columna, ni derivación, ni gestión.

### 2. El embudo medía lo que MANDAMOS, no lo que le pasó al lead

El estándar de pipeline de CRM es explícito: *las condiciones de salida de una etapa se definen por
**acciones del comprador**, no por actividades del vendedor — mandar una propuesta es algo que
hacemos nosotros y ocurre exista o no interés*. `cotizado` se derivaba de `precio_enviado`, que es
exactamente eso.

**Medido en producción el 8-ago-2026**, y el número duele:

| las 3.973 conversaciones de la ventana de 30 días | n | % |
|---|---|---|
| **A · le escribimos y NUNCA contestó** | **2.580** | **64,9 %** |
| C · conversación de ida y vuelta | 1.155 | 29,1 % |
| B · escribió y nadie le contestó | 238 | 6,0 % |

Sin ningún entrante, `respondidaSql` da **`true`** (el último saliente le gana a un `'-infinity'`),
así que las 2.580 caían en `contactado` — y si el envío llevaba precio, en `cotizado`. El 5-ago
salieron **1.139 mensajes contra 49 entrantes** —un envío masivo— y ese blast promovió **2.252 de
los 3.050 Cotizados** de una sola vez.

🔴 **Y esas 2.580 no son leads: son clientes.** De las 948 que figuran con venta, **947 ya eran
clientes ANTES del primer mensaje**. Es difusión a la base de compradores, no venta en curso.

---

## La decisión

### El embudo pasa a CINCO columnas, y la nueva es la más grande

```
Sin respuesta → Interesados → Contactados → Cotizados → Cierre
   (2.576)        (bandeja)      (217)        (790)      (13)
                                                          ↘ Perdidos
```

| peldaño | qué lo dispara | acción del comprador |
|---|---|---|
| `sin_respuesta` | salió un mensaje nuestro y **no hay ningún entrante** | — (es su ausencia) |
| `interesado` | escribió y nadie le contestó | **escribió** |
| `contactado` | conversación con la pelota de nuestro lado | **escribió** |
| `cotizado` | recibió precio **y habló alguna vez** | **escribió** |
| `cierre` | hay una **venta posterior** a la conversación | **compró** |

Con `hablo` en la derivación, cada peldaño arriba de `sin_respuesta` exige que la persona haya hecho
algo. Es la corrección que el estándar pedía.

### `sin_respuesta` se DERIVA y NO se declara

No entra a `ETAPAS` —ni en el server ni en el front— porque esa lista la enumeran el embudo del
Dashboard y el recibo de venta, y ahí sería un segmento clavado en cero. Entra sólo a
`ESCALA_ETAPAS`, **en el fondo**, que es lo que `max(manual, derivada)` necesita para comparar.

**No se puede arrastrar ahí** (`compuertas.ts`): la etapa afirma «esta persona nunca nos escribió»,
que es un hecho verificable y no una opinión. Declararla sería afirmar algo falso sobre alguien que
sí habló — y duraría un segundo, porque la derivación la corrige en el próximo refetch. Y **deja de
ser cierta sola** en cuanto la persona escribe: no hay nada que limpiar.

### «Cierre» deja de ser cero permanente, con un filtro que no se negocia

Un embudo sin salida no es un embudo: si nada sale, todo se apila — y por eso Cotizados llegó a
3.051. `cierre` ahora también se deriva de `conversiones_wa`.

🔴 **La venta tiene que ser POSTERIOR al primer mensaje, y la condición va en el `ON` del join, no
en un `WHERE` suelto.** Puesta ahí es imposible que un consumidor se la olvide. Sin ese `>=`, la
columna se llenaría con los 947 clientes que compraron en 2024 y a los que este mes les mandamos un
flyer. Con él son **13**, y 13 es la verdad.

⚠️ Eso también dice algo incómodo sobre `conversiones_wa`: **1.448 de sus 1.464 filas son match por
`telefono_e164`**, con ventas desde marzo-2024 contra un `interactions` que cubre 18 días. Dice
«esta persona compró alguna vez», no «esta conversación vendió». No autoriza a concluir que
conversar no vende — autoriza a decir que **Hermes todavía no puede medirlo**.

### El tiempo en etapa: `LEAST` de dos ingresos, no una precedencia

`etapa_desde` (`cola/tiempoEnEtapa.ts`) es **el más viejo** de los dos instantes que ya la ponían
en esa etapa: la gestión declarada y el hecho que la derivó. Con precedencia, el caso «el precio
salió el día 12 y alguien tocó Cotizado el día 3» reportaría 3 días menos de antigüedad — justo en
la columna donde la antigüedad ES el criterio de trabajo.

Cada peldaño se fecha con su hecho:

| etapa | instante |
|---|---|
| `sin_respuesta` | el **primer** saliente — el silencio corre desde que le escribimos, e insistir no lo reinicia |
| `cotizado` | el **primer** saliente con precio |
| `contactado` | el primer saliente **posterior al último entrante** (el ÚLTIMO ingreso, no el primero) |
| `interesado` | el último entrante |

`null` significa **no se pudo determinar**, nunca «recién»: un comentario de FB/IG respondido no
guarda cuándo se respondió, y ahí la pantalla no dibuja nada. La misma decisión de los ✓✓ de
entrega — un hueco se nota, un invento se cree.

### El recorte es POR COLUMNA, y separa la venta viva de la que se frenó

Cada columna lleva su propio estado y sus chips, con su número. Medido, de los tres ejes posibles
**sólo uno recorta de verdad**:

| sobre 3.051 Cotizados | deja |
|---|---|
| «En ventana» | **1** |
| «Sin respuesta» | 2.928 (el 96 %) |
| **«Para seguir»** (silencio + 3 a 14 días en la etapa) | **82** |
| **«Se callaron con el precio»** | **540** |

**«Se callaron»** es la objeción #1 del negocio y nunca se declaró: de los 798 Cotizados, **258
respondieron después del precio** y **540 venían conversando y dejaron de hacerlo en el momento
exacto en que vieron el número**. Son el público de «se puede pagar en 2 cuotas», dicha **2 veces en
1.876 conversaciones**.

⚠️ **Va como recorte y no como sexta columna**: la etapa describe dónde está la venta (le pusimos
precio, la cotización existe) y esto describe qué hacer hoy, que es el eje del recorte. Y el nombre
**no promete causa** — dice que se callaron *después* de recibirlo, que es un hecho (la misma regla
que `resultados/medicion.ts`).

**La regla del cero gana su otra mitad**: un recorte que daría cero no se ofrece **y uno que daría
el total, tampoco**. «Con precio 3.051» sobre una columna de 3.051 es un botón que no cambia lo que
se ve. La excepción, para los dos: el chip **activo** se ofrece siempre, o la vendedora se queda sin
el botón que lo apaga. **Lo encontró la captura de evidencia, no un test.**

---

## Lo que esto NO resuelve, y hay que decirlo

**El Pipeline ordena el 2,6 % del embudo.** `interactions` es 100 % WhatsApp; el canal más grande
—25.510 leads de formulario, con datos de hoy— no llega a ninguna columna, y de sus 25.226 con
teléfono sólo **650 (2,6 %)** llegaron alguna vez a hablar. El detalle y el plan:
`docs/plan-pipeline-por-canal.md`.

---

## Alternativas descartadas

- **Redefinir `cotizado` como «respondió tras el precio» (258).** Es lo que el estándar pediría al
  pie de la letra, pero dejaría «Cotizados» significando algo distinto de lo que significa en
  cualquier otro CRM, y escondería 540 cotizaciones que existieron. Se resuelve con el recorte.
- **Una sexta columna para «Se callaron».** El `GRID` a 1280 ya está ajustado con cinco (mínimos
  1.020 px sobre ~1.256 de contenido). Y no es una etapa: es un modo de trabajo.
- **Reescribir `platform='web'` a `'landing'` en las 25.511 filas** para arreglar la lectura del
  radar. Es cambiar el hecho para no cambiar la consulta; la traducción vive en
  `dashboard/fuenteLead.ts`, donde se puede leer.
- **Derivar `cierre` también en el Dashboard.** Su embudo mide a los que LLEGARON en un período y
  cuenta el cierre por otro camino (`subregistro`); hacerlo de callado le cambiaría los números a un
  panel que alguien mira todas las mañanas. Usa `ventaJoinVacioSql`.

---

## Los candados

| qué protege | dónde |
|---|---|
| la regla pura ≡ su espejo SQL, comparando **el instante** | `cola/tiempoEnEtapa.paridad.test.db.ts` |
| el blast con precio no cotiza a nadie | `tiempoEnEtapa.paridad.test.db.ts` («sin respuesta contra una base de verdad») |
| la venta ANTERIOR no cierra nada | ídem |
| el chip promete un número y el recorte devuelve esa lista | ídem, por cada recorte |
| **toda etapa que el embudo puede DEVOLVER se puede pedir** | `routes/conversaciones.etapa.test.ts` |
| qué chips se ofrecen (incluido el activo en cero) | `src/features/vistas/tablero.recorte.test.ts` |
| la fuente y el rótulo de un lead de formulario | `dashboard/fuenteLead.test.ts` |

🔴 **El bug que enseñó dónde no miraba nadie**: `?etapa=sin_respuesta` respondía **400**, porque la
ruta validaba contra `ETAPAS` (lo declarable). La columna se dibujaba y al pedir sus tarjetas,
error. **No lo vio ningún test con base** — todos llaman al seam `consultarCola` directo,
salteándose la validación de la ruta. El defecto vivía justo en la costura. De ahí salió
`ETAPAS_CONSULTABLES` y el test que fija la invariante.

---

## Evidencia

`docs/evidencia/pipeline-recorte-por-columna.png` · `pipeline-para-seguir.png` ·
`pipeline-sin-respuesta.png` (las cinco columnas a 1280×720, sin scroll horizontal).

Verificado en producción el 9-ago **midiendo, no por el status del workflow**:
`sin_respuesta 2.576 · cotizado 790 · interesado 377 · contactado 217 · cierre 13`.
