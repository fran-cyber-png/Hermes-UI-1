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
el reintento se decide en un solo lugar (`esReintentable`), y la ruta manda `reintentable` en el 502
para que la app no reimplemente esa tabla.

**El `codigo` decide, y el estado HTTP desempata un caso.** `timeout` y `red` son transitorios
siempre; config y contrato roto dan exactamente el mismo error un minuto después, y reintentarlos es
esconder el bug detrás de un spinner más largo. Pero `http_inesperado` es un **cajón de sastre** y la
primera versión de esta regla —que miraba solo el `codigo`— le afirmaba `false` a las tres cosas que
caen adentro:

| Lo que cae en `http_inesperado` | Vida | Qué decía antes |
|---|---|---|
| `404` — el endpoint todavía no está desplegado (I1) | permanente | `false` ✅ |
| `500` — el `except Exception` de Ivi (pgvector caído, Bedrock sin credenciales) | **transitorio** | `false` ❌ |
| `502`/`504` — nginx o la tailnet delante de geografo | **transitorio** | `false` ❌ |

El campo se llama `reintentable` y con `false` un pgvector reiniciándose le **habría** quitado a la
vendedora la única acción que la desbloqueaba. El `estado` ya viajaba en el `ErrorIvi`; solo faltaba
mirarlo. Un `5xx`, un `408` o un `429` en ese cajón son transitorios; el resto no. El orden importa:
**el código decide primero** — un `503` es el `ivi_sin_token_configurado` de Ivi, config y no caída,
y ser 5xx no lo vuelve transitorio.

#### Habría, no le quitaba: quién lee `reintentable` hoy

Nadie. Y decirlo importa, porque este ADR trata justamente de no afirmar más de lo que se midió.

| Medición | Contra qué foto | Resultado |
|---|---|---|
| `grep -rn "api/ivi" src/` · `grep -rn "Ivi" src/` | esta rama (`feat/costura-ivi-traza`) | **cero líneas**: no hay consumidor del proxy en el front |
| dónde vive el consumidor | `docs/plan-panel-contexto.md:162` (hito S9) y el PR **#174** `feat/superficie-de-ivi`, sin mergear | pendiente |
| qué hace ese consumidor con el flag | `feat/superficie-de-ivi@d2045f3` | **tampoco lo lee** |

La tercera fila es la que sorprende y por eso se escribe: en #174 la pantalla sí dibuja un botón
«Reintentar», pero no a partir de este campo. `api()` (`src/lib/datos/cliente.ts:103-109`) construye
el `ErrorApi` con `message`, `status`, `type`, `errores` y `codigo` — `reintentable` se descarta en
ese borde —, y `src/features/ivi/errores.ts` vuelve a derivar el reintento de una tabla propia
indexada solo por `codigo`, donde `http_inesperado` está fijo en `false`. O sea: el 500 que este
arreglo acaba de marcar transitorio seguiría sin ofrecer el botón allá.

Lo que este arreglo cierra es el **contrato**: la ruta ya no afirma «permanente» sobre algo que no
lo es. Cablear la UI a ese contrato —o borrar la tabla duplicada del front— es trabajo aparte, está
trackeado en **#175**, y mientras no se haga, la frase «la app dibuja el botón con este flag» es una
promesa, no una descripción.

### 4 · El `traza_id` nace en Hermes y va desde el día uno

Cada pregunta lleva un `traza_id` (`hermes-<uuid>`) que Hermes devuelve a la app **tanto en el éxito
como en el 502**.

**Del otro lado todavía no cierra el lazo, y conviene decirlo con la foto en la mano.** Verificado
contra `ivi-cerebro` **@`1e5d2f3`** (HEAD commiteado, 27-jul): `responder()` es
`responder(pregunta, usuario=None, historial=None)` — sin `traza_id` ni `superficie` — y `rag/traza.py`
no existe. En el **árbol de trabajo sin commitear** de ese repo las dos cosas sí están
(`responder(..., superficie="chat", sesion_id=None, traza_id=None, sensor=True)` y `rag/traza.py`),
y el handler de `/api/preguntar` ya se lo pasa. O sea: **hoy el uuid nace, viaja y se descarta en los
dos extremos**, y va a empezar a guardarse cuando Ivi commitee y despliegue ese trabajo.

Se manda igual, y eso no cambia: **es el único hilo que unirá «qué recomendó Ivi» (en la base de Ivi)
con «qué se mandó y qué resultó» (en la de Hermes)**, y es un dato que no se puede reconstruir
después — la request ya pasó. Empezar a mandarlo cuando el otro lado esté listo significaría no tener
traza de nada de lo anterior. Es el mismo argumento que Ivi hace por la versión de cada pieza (H5) y
el que Hermes hace por `campana_fuente` (ADR 0018) — sin el «por qué», una recomendación no se puede
supervisar, solo obedecer.

> **Lección de método, que es la parte que vale más que el campo.** La versión anterior de este ADR
> decía, en presente, que «Ivi lo guarda en su traza y lo propaga al SDK». No era cierto de ninguna
> de las dos fotos: mezclaba el árbol sucio (de donde salía el tope de tokens) con el HEAD (de donde
> salía el handler), sin decir de cuál venía cada cosa. **Una afirmación sobre otro repo tiene que
> decir contra qué snapshot se verificó**, o envejece sin que nadie note cuándo dejó de ser verdad —
> y el que construye encima la lee como garantía.

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
