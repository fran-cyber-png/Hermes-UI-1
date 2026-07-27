# ADR 0021 — El catálogo de piezas, publicado para que Ivi pueda elegir sin inventar

**Fecha**: 2026-07-27 · **Estado**: aceptado · **Issue**: #169 (H8 · H9) ·
**Contraparte**: `ivi-cerebro/docs/plan-ejecucion-hermes.md`, `docs/respuesta-hermes-ensamblado.md`

## Contexto

El dueño decidió que **Ivi ARMA, no inventa**: elige y ordena piezas registradas y **nunca escribe una
frase nueva hacia un lead**. Para poder elegir, Ivi necesita ver el catálogo; y para que su elección
case con la de Hermes, los dos tienen que hablar el mismo vocabulario.

Del otro lado, Ivi se comprometió a devolver **ids, nunca texto** — Hermes compone con su texto
ACTUAL. De ahí sale la propiedad que hace segura toda la integración, y que conviene tener presente
para entender por qué este endpoint es *read-only* y por qué su desactualización no es grave:

> Un índice viejo del lado de Ivi degrada la **calidad de la selección**, nunca la **corrección de lo
> que se manda**.

Hoy lo-que-se-puede-decir vive en **cuatro catálogos** con tres formas de id incompatibles:

| Pieza | Dónde vive | Su id | Nota |
|---|---|---|---|
| plantilla-secuencia | tabla `plantillas` + `plantilla_pasos` | `id` bigserial | **PERSONAL** (`vendedora_id`) |
| paso de plantilla | `plantilla_pasos` | `(plantilla_id, orden)` | `plantilla_pasos.id` **no es estable** |
| hecho | tabla `hechos` | `clave` text UNIQUE | el único id textual estable |
| acuse fuera de horario | arreglo en código (`autorespuesta/plantillas.ts`) | `id` string | cambiarlo es un deploy |
| gancho por familia | arreglo en código (`autorespuesta/campana.ts`) | `FAMILIAS[].id` | media frase, no un mensaje |

**Unificar los cuatro es otro frente y no es este ADR.** Lo que este ADR decide es la forma del
contrato, de manera que la unificación futura **no rompa** al consumidor externo.

## Decisión

`GET /api/catalogo/piezas` y `GET /api/catalogo/vocabulario` (`server/src/routes/catalogo.ts`), solo
lectura, detrás de una **credencial de servicio propia**.

### 1. La pieza se direcciona con `{clase, id}`, y la clase es semántica

`clase` es *qué tipo de cosa es* (`plantilla` · `hecho` · `acuse` · `gancho`), **no dónde vive**. El
contrato no publica ni tabla, ni archivo, ni «origen». Cuando los cuatro catálogos se unifiquen en
uno, las piezas conservan su clase y su id y **el contrato no se entera**. Si en cambio hubiéramos
publicado `origen: "tabla:hechos"`, unificar sería un cambio de contrato con un consumidor externo.

Un id pelado no alcanzaba: un `412` puede ser una plantilla o cualquier otra cosa, mientras que
`{clase:"hecho", id:"cuotas"}` es inequívoco.

**Un paso suelto no es direccionable**: `escribirPasos()` borra y reinserta todos los pasos en cada
edición, así que `plantilla_pasos.id` cambia sin que cambie el paso. Los pasos viajan **dentro** de su
plantilla con su `orden`. Publicar un id que mañana apunta a otra cosa es peor que no publicarlo.

### 2. La versión es un hash del contenido, no un contador

`catalogo/version.ts`: `sha256:` + 16 hex de lo que **sale hacia la persona**. Ivi pidió «un `version`
entero o un `contenido_sha256`, lo que sea estable y comparable». Elegimos el hash por tres razones de
este repo:

1. **Dos de los cuatro catálogos viven en código** y no tienen fila donde incrementar un contador.
2. **No se puede olvidar.** Un contador hay que acordarse de subirlo; si alguien edita el texto y no
   lo sube, el lazo vuelve a mezclar dos textos bajo la misma versión — el bug exacto que esto evita,
   ahora silencioso.
3. **No hace falta migración**: cero `db:push`, cero coordinación con las ramas que tocan el schema.

**Qué entra en el hash**: el texto y las referencias de media. **Qué no**: el nombre de la plantilla y
el rótulo del hecho. Renombrar una etiqueta interna no es un texto nuevo; si contara, el lazo partiría
el historial de una pieza porque alguien le arregló una tilde al nombre.

El precio, dicho: A → B → A colapsa a dos versiones, no tres. Para medir rendimiento *por texto* eso
es lo correcto — es el mismo texto.

**Contrato con el lazo de resultados**: quien estampe la versión en `envios_wa` debe usar
`versionDeContenido()`, no una copia. Es una cadena opaca y lo único que importa es que los dos lados
la calculen igual; con dos recetas distintas el join no cierra y nadie se entera hasta que el reporte
esté mal.

### 3. Error, nunca una lista vacía

La condición innegociable, que sale de una cicatriz de Ivi (su ADR 0002: el `{"ok": true}` con ceros
les costó semanas). Un 200 con contenido vacío es indistinguible de «no hay nada» y se cachea como
catálogo válido. Acá son tres reglas:

| Situación | Respuesta |
|---|---|
| el lector explota (base caída, tabla ausente) | **503 `catalogo_indisponible`**, y el cuerpo **no trae `piezas`** |
| el lector devuelve cero piezas | **500 `catalogo_vacio`** — las piezas de código existen siempre; cero es un bug de Hermes |
| un filtro de quien preguntó no deja nada | **200** con `filtrado: true`, para que no se confunda con el catálogo |

Y una consecuencia que se decidió a propósito: **`catalogo/repositorio.ts` no degrada**, a diferencia
de `hechos/repositorio.ts`, que ante la falta de tabla sirve el catálogo por defecto con
`editable: false`. Para la vendedora esa degradación es correcta: ve las frases y la UI le avisa. Para
una máquina que indexa y cachea, no hay nadie que lea el aviso. Lo mismo vale para lo parcial: **si
`plantillas` falla y `hechos` responde, no se devuelve medio catálogo** — un catálogo al que le falta
una mitad es indistinguible de uno donde esa mitad no existe.

### 4. Credencial de servicio propia, porque Ivi es una máquina

No `requiereVendedora`: Ivi indexa de noche, sin nadie sentado adelante, y exigir el HMAC de sesión
obligaría a fabricarle una sesión eterna a un servicio — una credencial de persona en manos de un
proceso, que después nadie sabe a quién echar.

Tampoco el token de `/api/admin`: darle a Ivi la credencial de administración **para leer una lista**
le daría de yapa re-apuntar números de WhatsApp y borrar sesiones. Así que la generalización mínima de
`auth/servicio.ts` (issue #95): misma puerta, **otro secreto y otra identidad**
(`HERMES_CATALOGO_SERVICE_TOKEN`, `req.servicio = "catalogo"`).

**Sin el secreto configurado la respuesta es 503 `falta_config`, no 401.** Es la lección que Ivi ya
aprendió del otro lado con `401` vs `503`: «el server no tiene token» y «el cliente mandó mal el
token» no pueden verse iguales, o una falla de configuración se disfraza de credencial equivocada y
se vive semanas sin enterarse. (Cerberus no necesita esa distinción porque su server **no arranca**
sin su token; acá no se puede hacer lo mismo sin voltear producción en el próximo deploy.)

### 5. El vocabulario se publica derivado, no copiado

`GET /api/catalogo/vocabulario` **y** el campo `vocabulario` dentro de `/piezas`, los dos derivados de
`MOMENTOS_DE_VENTA` (`sugerencias/estado.ts`) en cada request. **Ivi es Python y no puede importar el
`.ts`.**

Se descartó la opción del JSON versionado en el repo —una de las tres que Ivi ofreció— porque un
archivo que alguien tiene que acordarse de actualizar **es** la desincronización silenciosa que esto
viene a evitar. Tres guardas, ninguna de ellas «acordate»:

1. lo publicado se deriva de la fuente única;
2. `DESCRIPCION_MOMENTO` es un `Record` sobre `MomentoDeVenta`: **agregar un momento sin describirlo
   no compila** (el mismo gate que ya tenía `intencionesSugeridas`);
3. `catalogo/vocabulario.test.ts` compara contra **la copia a mano del front**
   (`src/features/hechos/hechos.ts`), que era la desincronización que ya existía en el repo.

### 6. Los momentos desconocidos viajan tal cual — y por qué eso ES lo conservador

Ivi pidió simetría: si el enum crece, el otro lado tolera el valor nuevo con un default conservador,
nunca un throw. Del lado de Hermes eso vale, con una vuelta de tuerca que no es obvia:

> En `hechos`, **`momentos: []` significa «vale para todos»**. Así que *filtrar* un momento
> desconocido no sería conservador: convertiría una pieza acotada a un momento nuevo en una que se
> ofrece **siempre**.

Por eso `Pieza.momentos` es `string[]` y no `MomentoDeVenta[]`, y por eso el repositorio no filtra por
el enum de este build. `elegirHechos()` ya se comportaba bien (un momento que no matchea, no se
ofrece) y ahora tiene test.

## Consecuencias

- **Ivi puede arrancar la Fase 2** (el ensamblado) sin esperar la unificación de catálogos ni el lazo
  de resultados.
- **Se responde la pregunta abierta de Ivi** («¿el ensamblado es para una vendedora o para el
  negocio?»): cada pieza declara `alcance` (`negocio` | `vendedora`) y `propietario`, y
  `?vendedora=<id>` acota lo personal sin esconder lo del negocio. Las plantillas son personales por
  construcción, así que **«el catálogo» no es global** y esconderlo haría que Ivi recomiende la
  plantilla de otra. **Con una corrección al inventario de Ivi**: «las plantillas son personales» es
  cierto a medias — una **propuesta minada es del EQUIPO**, no de la vendedora bajo cuyo id corrió el
  script (la tabla exige un `vendedora_id`, así que el minado pone uno cualquiera; `visiblePara` en
  `plantillas/repositorio.ts` se las muestra a todas desde ADR 0019). Sale con `alcance: "negocio"`, o
  `?vendedora=` la escondería de todas menos una — el bug que ese ADR ya había arreglado en la app.
- **Se publica que hay DOS vocabularios de familia** que no mapean 1:1 —`sku-cerberus` (`DIPICOT`,
  el de `plantillas.familia_curso` y `alias_curso`) y `campana-goberna` (`osint`, el de los ganchos)—
  y el vocabulario viaja **con** el valor. Publicarlos como un `familia: string` pelado invitaba a
  cruzarlos, y ese join daría piezas del curso equivocado sin que nada falle.
- **Se publica lo no-vigente** (borradores y retiradas), marcado. Esconder un borrador haría parecer
  que falta una pieza cuando lo que falta es una firma humana; esconder una retirada dejaría a los
  resultados históricos sin a qué apuntar.
- **Ivi ve el texto de los acuses y los ganchos.** Son los textos que salen solos de madrugada. Que
  los vea es necesario para que pueda elegirlos y es inofensivo mientras devuelva ids: el texto que
  sale lo compone Hermes.
- **Deuda que queda**: `plantilla_pasos` sigue sin id estable (Ivi no puede referenciar un paso
  suelto), la unificación de los cuatro catálogos sigue pendiente, y `requiereServicio` sigue teniendo
  su identidad clavada para Cerberus — se generalizó agregando una identidad, no reescribiendo la
  familia (issue #95).

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Colgar el catálogo de `/api/admin` | Reusaba la exención del perímetro y el middleware, pero le daba a Ivi la potestad de administrar números para leer una lista |
| `version integer` en una columna nueva | No sirve para los dos catálogos que viven en código, exige `db:push` y **se puede olvidar de subir** |
| Degradar como `hechos/repositorio.ts` | Un consumidor máquina cachea lo que recibe: la degradación honesta para una persona es una mentira para un índice |
| Publicar un `momentos` filtrado por el enum | En `hechos`, vacío significa «todos»: filtrar **ensancha** la pieza en vez de acotarla |
| Un JSON de vocabulario versionado en el repo | Alguien tiene que acordarse de actualizarlo — que es exactamente el fallo silencioso que se quería evitar |
