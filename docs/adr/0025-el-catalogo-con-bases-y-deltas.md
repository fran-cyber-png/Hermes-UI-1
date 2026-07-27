# ADR 0025 — Un catálogo con bases y deltas: copiar deja de ser duplicar

**Fecha**: 2026-07-27 · **Estado**: propuesto · **Frente 2 de la épica #169**
**Reemplaza**: nada. **Extiende**: [0023](0023-catalogo-de-piezas-para-ivi.md) (el catálogo que Ivi
lee) y [0022](0022-el-lazo-de-resultados.md) (lo que se estampa en `envios_wa`).

> Este ADR **no trae schema**. Es el diseño para que se revise antes de que exista una migración,
> porque toca el módulo más custodiado del repo (`server/src/piezas/`) y un contrato con otro
> equipo. Los PRs de implementación vienen después, encadenados.

---

## Contexto

### 1 · Lo que se rompe hoy: copiar una secuencia a otro curso es duplicarla

La venta real de la Escuela son cuatro mensajes —saludo → flyer → temario → duración— y el **42 %
lleva imagen**. Eso ya está modelado: `plantillas` + `plantilla_pasos` (ADR 0019).

Lo que no está modelado es que **esos cuatro mensajes son casi los mismos para todos los diplomas.**
Lo que cambia entre OSINT y Legislativo suele ser el flyer y una línea del temario; el saludo y el
cierre son idénticos. Hoy no hay forma de decir eso: una secuencia para otro curso es **una fila
nueva con sus cuatro pasos copiados**.

La consecuencia no es el trabajo de copiar —eso se hace una vez— sino que **desde ese momento son
dos textos que nadie vuelve a sincronizar**. Se arregla una frase en uno y el otro queda viejo, sin
que nada falle ni avise. Es la misma clase de defecto que #37 (la urgencia implementada dos veces) y
que las dos recetas de hash que la revisión adversaria encontró en esta misma épica, con la
diferencia de que acá la duplicación **no la escribe un programador: la escribe la vendedora, con un
botón que la invita**.

### 2 · Y lo que lo vuelve urgente ahora: hoy hay UNA vendedora

**Hoy Hermes lo usa Luz, desde un solo teléfono.** Todo lo que hay en `plantillas`, todo lo que se
acumuló en `envios_wa` y toda la procedencia del lazo son de ella. **Se van a ir agregando más
teléfonos** (la fecha de corte para que todas trabajen solo en Hermes es el **3-ago-2026**).

Eso convierte una decisión de modelado en una decisión con fecha, por algo que ya está escrito en el
schema y que nadie puso ahí por accidente:

```ts
/** Personal, como `categorias`/`recordatorios`. La 2ª vendedora arranca vacía. */
vendedoraId: text("vendedora_id").notNull(),
```

Y `visiblePara()` (`plantillas/repositorio.ts:118`) lo confirma: una plantilla se ve si **es tuya** o
si es una **propuesta minada**. Una plantilla **aprobada** de otra vendedora es invisible.

> **La segunda vendedora no hereda nada de lo que Luz aprobó.** Ve las propuestas crudas del minado
> y su propia biblioteca vacía. El trabajo de curaduría —qué secuencia funciona, con qué flyer, en
> qué orden— no se transmite.

Esto es **barato ahora y caro después**, por la misma razón que H5 (la versión de pieza) lo era: con
una sola vendedora, promover sus plantillas a bases del negocio es una decisión sin conflicto —no hay
dos versiones de nada que reconciliar—. Con cuatro vendedoras que llevan un mes cada una con su copia
divergente, alguien tiene que sentarse a elegir cuál gana, texto por texto.

### 3 · Los cuatro catálogos, medidos

| Pieza | Dónde vive | Su id | ¿Estable? |
|---|---|---|---|
| **plantilla** | tabla `plantillas` | `id` bigserial | sí, pero **personal** (`vendedora_id`) |
| **paso** | tabla `plantilla_pasos` | `(plantilla_id, orden)` | 🔴 `plantilla_pasos.id` **no** lo es: `escribirPasos()` borra e reinserta en cada edición |
| **hecho** | tabla `hechos` | `clave` text UNIQUE | sí — el único id textual estable del sistema |
| **acuse** | **código** (`autorespuesta/plantillas.ts`) | `id` string | sí; cambiarlo cuesta un deploy |
| **gancho** | **código** (`autorespuesta/campana.ts`) | `FAMILIAS[].id` | sí; cinco valores |
| ~~sugerencia~~ | **no es un catálogo** | — | derivador por regex sobre el texto de las plantillas |

Ya comparten **cabeza** —`momentoDeVenta()` y `ContextoPlantilla` en `sugerencias/estado.ts` deciden
igual de día (sugerencia) y de noche (acuse)— y ya comparten **fachada de lectura**: `Pieza`
(ADR 0023) los publica a los cuatro con la misma forma. Lo que no comparten es **catálogo**.

---

## Decisión

### 1 · Se unifica el MODELO, no la tabla: los acuses y los ganchos siguen en código

`catalogo/codigo.ts` ya dice por qué, y sigue siendo cierto:

> Dos de los cuatro catálogos no tienen tabla: cambiarlos cuesta un deploy. Eso no es un accidente
> […] son los textos que salen **SOLOS** de madrugada, y que estén bajo revisión de código es
> deliberado.

Los acuses son la **única superficie que manda sin que una persona apruebe ese mensaje en ese
momento** (ADR 0018: Hermes no manda solo, salvo acá). Su guarda es que el texto pasa por un PR, con
`plantillas.test.ts` prohibiendo que se delate como automatismo (regla del dueño del 27-jul) y
prohibiendo emojis. Moverlos a una tabla editable sin deploy le saca esa red **justo a lo único que
la necesita**.

Así que «un catálogo único» significa: **una sola forma de pensar una pieza** (`Pieza`, ya existe) y
**bases y deltas donde hay tabla** (`plantillas`, `hechos`). Los cuatro orígenes se siguen publicando
por la misma fachada, e Ivi no se entera de ninguna de las dos cosas.

### 2 · Una base es del NEGOCIO; una variante por curso se deriva de ella

`Pieza` ya tiene el campo y ya está publicado: `alcance: "negocio" | "vendedora"`.

- Una **base** es del negocio: la ve y la usa cualquier vendedora.
- Una **variante** declara `base_id` + su `familia_curso`, y **solo guarda lo que cambia**.
- Lo que una vendedora escribe para sí sigue siendo suyo (`alcance: "vendedora"`). No desaparece
  nada.

Con esto, agregar la vendedora #2 deja de ser «arranca vacía»: arranca con las bases del negocio.

**Quién puede editar una base**: quien la aprobó, como hoy con las propuestas minadas (ADR 0019:
«aprobarla es hacerse cargo»). Editar una base es un acto con consecuencias sobre el trabajo de otras
personas y el §4 dice cuáles.

### 3 · Una variante es una PIEZA PROPIA, con su `{clase, id}` y su versión

La alternativa era que la variante fuera «la misma pieza con un modificador». Se descarta por el
lazo: si DIPICOT y DIPOSINT comparten identidad, **sus resultados se suman**, y el lazo existe
justamente para poder decir que una pieza pasó de 12 % a 30 %. Dos flyers distintos con el mismo id
es el blanco móvil que ADR 0022 §versión vino a eliminar.

Y tiene una segunda virtud, que es la que lo hace barato: **no toca `piezas/direccion.ts`.** Una
variante es una fila de `plantillas` con su propio bigserial, así que se direcciona
`{clase:"plantilla", id:"57"}` como cualquier otra. Los vectores literales de `piezas/vectores.ts`,
`receta-unica.test.ts` y las dos pruebas de paridad siguen valiendo sin cambios — y ese módulo es el
que ya costó el defecto más caro de la épica.

`direccion.ts` lo había anticipado: *«el día que los cuatro catálogos se unifiquen, la clase y el id
no cambian»*. Esta decisión es lo que hace que eso siga siendo verdad.

### 4 · La versión de una variante hashea el contenido RESUELTO — y eso tiene un costo que hay que decir

La receta no cambia (`piezas/version.ts`, la única). Lo que entra es el **contenido autoral que
sale**: el texto sin resolver `{nombre}`/`{precio}`, más el nombre del archivo.

Para una variante, ese contenido es **base + delta ya resueltos**. Tiene que ser así: si el paso 1 lo
aporta la base y la base cambia, **lo que le llega al lead cambió**, y una versión que no se moviera
mezclaría dos textos —exactamente el defecto que ADR 0022 previene.

> ⚠️ **La consecuencia nueva, que no existía antes de este ADR:** editar una base **cambia la versión
> de todas sus variantes a la vez**. Antes una edición partía el historial de **una** pieza; ahora
> puede partir el de N.
>
> No es un error —el texto que salió efectivamente cambió en las N— pero sí cambia qué se siente al
> arreglar una tilde. Dos consecuencias de diseño que salen de acá:
>
> 1. **La UI tiene que decirlo antes de guardar**: «esto cambia 4 variantes». Una edición cuyo
>    alcance no se ve es una edición que alguien va a hacer sin querer.
> 2. **Conviene que las bases sean chicas y estables.** Cuanto más texto vive en la base, más
>    historial se parte junto.

### 5 · El delta se ancla a una CLAVE de paso, nunca al `orden`

Este es el punto donde el diseño se puede romper en silencio, así que va explícito.

El instinto es anclar el delta al `orden`: «en la variante DIPICOT, el paso 2 lleva otro flyer». **Es
incorrecto, y falla callado.** El día que alguien inserte un paso en el medio de la base, todos los
`orden` se corren y **cada delta pasa a pisar el paso equivocado** — el flyer de OSINT aterriza sobre
el temario, y nada falla: la secuencia se manda igual, con el mensaje cambiado.

Tampoco sirve `plantilla_pasos.id`, porque **no es estable**: `escribirPasos()`
(`plantillas/repositorio.ts:189-203`) borra todos los pasos y los reinserta en cada edición. Y no solo
eso — **reasigna el `orden` desde la posición en el arreglo**:

```ts
await base.delete(plantillaPasos).where(eq(plantillaPasos.plantillaId, plantillaId));
await base.insert(plantillaPasos).values(
  pasos.map((p, i) => ({ plantillaId, orden: i + 1, … })),
);
```

O sea que el `orden` no es un atributo del paso: es **su posición actual, recalculada en cada
guardado**. Anclar un delta ahí es anclarlo a algo que se mueve por diseño.

Entonces: **los pasos de una base ganan una `clave` estable** (`saludo`, `flyer`, `temario`,
`cierre`), y el delta referencia esa clave. `escribirPasos()` tiene que **preservarla** al reescribir.
Insertar un paso en la base deja de mover nada.

Es el mismo criterio que ya hizo de `hechos.clave` «el único id textual estable del sistema», aplicado
un nivel más abajo.

### 6 · El catálogo resuelve ANTES de publicar: Ivi nunca ve una base ni un delta

`catalogo/repositorio.ts` resuelve base+delta y recién entonces llama a `armar.ts`. Hacia afuera, una
variante es una pieza completa, con sus pasos completos y su versión.

Es la propiedad que hace que este frente **no sea un cambio de contrato**: `GET /api/catalogo/piezas`
devuelve exactamente la misma forma que hoy, e Ivi puede seguir armando sin enterarse de que adentro
hay herencia. Es también lo que ADR 0023 §1 había prometido al no publicar `origen: "tabla:hechos"`.

La resolución vive **una vez, pura y con tests** (`catalogo/resolver.ts`), como el criterio de las
señales o el de la urgencia. No hay una segunda resolución en SQL que pueda divergir.

---

## Lo que deliberadamente NO se hace

- **No se migran los acuses ni los ganchos a la base.** §1.
- **No se renumera ningún id.** Las plantillas de hoy siguen siendo las mismas piezas, con los mismos
  ids y las mismas versiones, y el lazo ya acumulado sigue casando.
- **El delta no es un diff de texto.** La unidad es el **paso**: se reemplaza un paso entero, no media
  frase. Un diff intra-texto haría que el contenido resuelto no se pueda leer ni revisar antes de
  mandarlo, y hay una regla dura que dice que lo que sale hacia un lead no puede ser algo que nadie
  miró.
- **v1 solo permite REEMPLAZAR un paso.** «Omitir» y «agregar» quedan para después, y no por falta de
  tiempo: cada uno es una forma de que la variante se aleje estructuralmente de la base, y el valor de
  tener una base es justamente que la estructura sea compartida. Si al usarlo resulta que hacen falta,
  entran con su propio fundamento.
- **No se deduplican variantes entre vendedoras.** Que dos personas deriven la misma variante es
  visible y barato; adivinar que son «la misma» y unirlas no lo es.
- **`sugerencias` no se convierte en catálogo.** No lo es: es un derivador por regex sobre el texto de
  las plantillas (`sugerencias/clasificar.ts`). No tiene ids que Ivi pueda devolver, y este ADR no le
  inventa uno.

---

## Consecuencias

**Buenas**

- Mejorar el saludo es **una** edición, no N.
- La vendedora #2 arranca con las bases del negocio en vez de una biblioteca vacía.
- El lazo puede comparar variantes del mismo tronco: «el flyer de OSINT rinde distinto que el de
  Legislativo» pasa a ser una pregunta con respuesta, porque son piezas distintas con versiones
  distintas.
- El contrato con Ivi no se toca, y `piezas/` tampoco.

**Costos, dichos de frente**

- Editar una base parte el historial de N variantes a la vez (§4).
- `escribirPasos()` gana la obligación de preservar la `clave` de cada paso. Si esa obligación se
  incumple, los deltas quedan huérfanos — así que va con test, no con comentario.
- El modelo de permisos crece: hoy «es mía o no es mía»; ahora hay algo que es de todas y que no
  cualquiera edita.
- Promover las plantillas de Luz a bases del negocio es una decisión **de producto**, no una
  migración mecánica: alguien tiene que mirar cuáles merecen ser el punto de partida del equipo. La
  migración puede dejarlas todas como están (personales) y que la promoción sea un acto explícito
  desde la app — es lo que se propone, para que ningún texto cambie de dueño sin que una persona lo
  decida.

**Un hallazgo adyacente, que no es de este ADR pero salió al escribirlo**

Que `escribirPasos()` reasigne el `orden` desde la posición del arreglo **también afecta al lazo que
ya está en `main`**. `envios_wa.pieza_ref` guarda `12#3` = «paso 3 de la plantilla 12»
(`piezas/direccion.ts`), y si alguien inserta un paso en el medio de esa plantilla, lo que hoy es el
paso 3 no es el que era cuando se estampó la fila. El `ref` histórico **queda apuntando a otro paso**.

Lo que salva la medición es la **versión**: `pieza_version` hashea el contenido que efectivamente
salió, así que dos filas con el mismo `12#3` y distinta versión son distinguibles, y ninguna se
atribuye a un texto que no mandó. Lo que se degrada es el **agrupamiento por `ref`**: mezclaría dos
pasos bajo la misma etiqueta.

No se arregla acá porque no es lo que este ADR cambia, y arreglarlo bien es darle al paso una `clave`
estable — que es **exactamente lo que el §5 introduce para las bases**. O sea que la solución de este
frente sirve para el otro problema, y conviene extenderla a todos los pasos, no solo a los de las
bases. **Queda anotado para un issue propio**, con su medición: hoy, con una sola vendedora y el lazo
recién desplegado, el corpus afectado es chico — que es el mejor momento para tocarlo.

**Lo que este ADR no resuelve y conviene no olvidar**

- La primera pregunta del lazo sigue siendo **«¿alguien las está usando?»**, no «¿cuál funciona
  mejor?». Con una sola vendedora y las cifras de #153 (una frase dicha 2 veces en 1.876
  conversaciones), ninguna variante va a llegar sola a `n = 30`. Este frente hace que la pregunta se
  pueda formular; no hace que ya tenga respuesta.
- El ruteo multi-número real (N transportes vivos) sigue siendo el **Frente A, issue #50**. Que
  entren más teléfonos toca eso, no esto.

---

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **Una sola tabla `piezas` para los cuatro** | Les saca la revisión de código a los acuses, que son lo único que se manda sin aprobación humana en el momento. La coherencia se gana en la fachada `Pieza`, que ya existe. |
| **La variante es la misma pieza con un modificador** | Suma los resultados de dos textos distintos bajo un id — el blanco móvil que ADR 0022 vino a eliminar. Y obligaría a tocar `piezas/direccion.ts`. |
| **Delta anclado al `orden` del paso** | Insertar un paso en la base repunta todos los deltas **en silencio** (§5). |
| **Herencia de más de un nivel** (una variante que es base de otra) | Resolver deja de ser una función de dos argumentos y aparece el orden de aplicación. Nadie pidió el caso. |
| **Copiar la base al derivar, y sincronizar después** | Es exactamente lo que se hace hoy. La sincronización que ocurre «después» no ocurre. |

---

## Plan de implementación

| PR | Qué | Riesgo |
|---|---|---|
| **1** | Este ADR | — |
| **2** | Migración expand-only (`plantillas.base_id`, `plantilla_pasos.clave`) + `catalogo/resolver.ts` puro con tests. Nada lo usa todavía. | bajo: sin `base_id`, todo resuelve a sí mismo |
| **3** | `catalogo/repositorio.ts` resuelve antes de publicar + paridad: una pieza sin base sale byte a byte igual que hoy | medio: toca el contrato con Ivi, y por eso el test es de paridad contra lo actual |
| **4** | La UI para derivar una variante y para promover una plantilla a base, con el aviso de «esto cambia N variantes» | medio: es donde se ve |

El PR 2 y el 3 son seguros por construcción: mientras ninguna fila tenga `base_id`, la resolución es
la identidad y el catálogo publica exactamente lo que publica hoy. Eso se fija con un test de paridad,
no con confianza.
