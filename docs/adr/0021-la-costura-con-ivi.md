# ADR 0021 — La costura con Ivi: el dialecto se traduce en el borde, la traza nace en Hermes, y «no sé» no es un error

**Fecha**: 2026-07-27 · **Estado**: aceptada · **Issue**: #169 · **Contexto de los dos lados**:
`ivi-cerebro/docs/plan-ejecucion-hermes.md` y `.../respuesta-hermes-ensamblado.md` (27-jul) ·
**Continúa**: el puente del ADR del issue #61 (`server/src/ivi/`, PR #149).

## El contexto

Hermes le pregunta a **Ivi** —el cerebro RAG que vive en geografo— a través de un proxy propio
(`POST /api/ivi/preguntar`). Ese puente ya existía y ya fallaba cerrado y ruidoso: ocho códigos de
error tipados, 502 con motivo, jamás una respuesta inventada.

Lo que faltaba no era manejo de errores. Era lo contrario: **que una respuesta buena no se leyera
como un fallo**, y que quedara un hilo para poder cruzar después lo que Ivi recomendó con lo que
efectivamente pasó del lado de Hermes.

## Las decisiones

### 1 · El dialecto de Ivi se traduce UNA vez, en el borde

Ivi habla `snake_case` (`grounding_ok`, `edad_del_dato`, `numeros_no_verificados`); Hermes habla
camelCase hacia adentro, y `{rol, texto}` hacia la app —que es la forma correcta para un chat—.
Las dos traducciones (`aCamelCase`, `aParesQA`) viven en `ivi/cliente.ts` y en ningún otro lado.

Se suma `numerosNoVerificados`: con `groundingOk: false`, es lo único que dice **cuáles** cifras
marcar. Sin esa lista, la app solo puede desconfiar del párrafo entero o de nada.

### 2 · El schema NO lleva `.strict()`, y es una decisión, no un olvido

Ivi tiene anunciados campos nuevos (`truncada`, `degradado`, `modelo`, `costo_usd`, `ms_total`).
Con `.strict()`, **cada campo nuevo de Ivi sería un 502 en la cara de la vendedora** y los dos
repos tendrían que coordinar releases para siempre. Lo que se ignora es barato; **lo único que
rompe es renombrar**, y de eso se defiende el fixture de contrato (`CUERPO_REAL_DE_IVI`, copiado
literal de `contrato_hermes()`).

Lo mismo vale para `tipo`: el vocabulario está publicado (`TIPO_IVI`) para que la UI ramifique sin
literales sueltos, pero el schema **no lo cierra**. Un `tipo` nuevo tiene que caer en la rama
conservadora (`CONTEXTO`), nunca en un `throw` y nunca en `HECHO`.

### 3 · `200` + `SIN_EVIDENCIA` es una respuesta, no un error — y no se reintenta

Es la regla que este repo ya tenía escrita («un 404 **no** es "no hay respuesta clara"»), aplicada
del otro lado: un fallo nunca se disfraza de «no hay datos», **y un «no sé» honesto nunca se
disfraza de fallo**. Ivi funcionó y decidió que no sabe: eso es un producto, y la app lo muestra.

Reintentarlo sería pedirle la misma respuesta otra vez y cobrarle el tiempo a la vendedora. Por eso
el reintento se decide por `codigo` y en un solo lugar (`esReintentable`): **solo `timeout` y `red`**
—los dos transitorios de verdad— son reintentables. Config y contrato roto dan exactamente el mismo
error un minuto después; reintentarlos es esconder el bug detrás de un spinner más largo. La ruta
manda `reintentable` en el 502 para que la app no reimplemente esa tabla.

### 4 · El `traza_id` nace en Hermes y va desde el día uno

Cada pregunta lleva un `traza_id` (`hermes-<uuid>`) que Ivi guarda en su traza y propaga al SDK, y
que Hermes devuelve a la app **tanto en el éxito como en el 502**.

Hoy no se ve. Va igual porque **es el único hilo que une «qué recomendó Ivi» (en la base de Ivi) con
«qué se mandó y qué resultó» (en la de Hermes)**, y porque es un dato que no se puede reconstruir
después: la request ya pasó. Es el mismo argumento que Ivi hace por la versión de cada pieza (H5) y
el que Hermes hace por `campana_fuente` (ADR 0018) — sin el «por qué», una recomendación no se puede
supervisar, solo obedecer.

La traza se pega al `ErrorIvi` en **un solo lugar** (la salida de `preguntarleAIvi`), para que
ningún `throw` futuro se olvide de ponerla. Un 502 sin traza no se puede cruzar con nada, y es
justo el momento en que uno querría cruzarlo.

## Lo que deliberadamente no se hizo

- **Reintentos automáticos.** `esReintentable` **dice** qué se podría reintentar; no reintenta nada.
  Quién y cuándo lo hace es de la capa que muestra, con su propio presupuesto de tiempo.
- **Ramificar por `tipo` del lado del server.** Un `SIN_EVIDENCIA` sale por el mismo camino que un
  `HECHO`; distinguirlos es trabajo de la UI (H3). Que acá no haya un `if` sobre `tipo` es el punto.
- **`modo` y `redactor`.** Ivi los emite y hoy se descartan en la traducción. Entran cuando haya una
  pantalla que los use, no antes.
