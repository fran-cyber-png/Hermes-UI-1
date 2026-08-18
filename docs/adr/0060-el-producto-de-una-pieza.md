# ADR 0060 — El producto de una pieza: el SKU manda, y se puede corregir

**Fecha**: 18-ago-2026
**Estado**: aceptado — toca el server, va por **N5** (migración `0030`, expand-only)
**Cierra** la Fase 5 de `docs/plan-routing-el-flujo.md`, que la había dejado anotada como
*«el único punto del plan que edita un diccionario compartido… va con su propia confirmación y su
propio ADR»*.
**Se apoya en** ADR 0053 (el ruteo por campaña) y ADR 0019 (el alias por `adId`, de donde sale la
regla que ordena todo esto).

---

## El pedido

*«ahorita principal que funcione bien, el formulario a veces está mal enlazado por producto;
enlacemos bien los formularios y las campañas y que te deje editar, decidir este formulario va con
otro producto o esta campaña va con otro producto haciéndole click y que salga el detalle como
sidebar derecho»* (dueño, 18-ago-2026).

## Lo que se midió antes de escribir una línea

Contra el catálogo real de Meta y los `leads` de producción, con las funciones del repo importadas
(no un regex nuevo):

| | Sin producto | Enlazadas al producto EQUIVOCADO |
|---|---|---|
| Campañas de Meta (153) | **93** | **7** |
| Cursos de formulario (22) | 2 | **4** |

Los cuatro formularios mal enlazados, con su causa:

```
Programa Premium ChatGPT Pro para consultoría política 4×4  → DIPCPOL   por «consultoria politica»
Master Agente de Inteligencia Artificial…                   → DIPICOT   por «inteligencia»
Diploma Internacional en Inteligencia Operativa Policial…   → DIPICOT   por «inteligencia»
Diploma Internacional en Dirección de Consultoría Política  → DIPCPOL   por «consultoria politica»
```

🔴 **Y ninguno se arregla tocando el diccionario a la bruta**: sacar «consultoria politica» rompe las
**trece** campañas del Consultor Político que dependen de ese alias. La corrección tiene que ser
**de esa pieza**, no del alias.

## La decisión, en dos mitades

### 1. Lo que se puede AFIRMAR: el SKU entre corchetes

Quien arma la pauta viene escribiendo el SKU adentro del nombre de la campaña
—`[MAR] [DIPCIBE004] CIBERDEFENSA 30 ABR`— y **nadie lo estaba leyendo**: el producto se infería de
las palabras del título teniendo el código canónico escrito al lado.

Ahora el SKU le gana al alias de texto. Es la misma regla que ADR 0019 ya aplicó al mapeo por
`adId`: **lo afirmado le gana a lo inferido**.

Resultado medido: **93 → 70** campañas sin producto, y las **7 mal enlazadas → 0**.

```
[DIPCIBE004] CIBERDEFENSA            «ciberdefensa»        decía DIPCINTE  → DIPCIBE
[DIPIOPS004] INTELIGENCIA OPERATIVA  «inteligencia»        decía DIPICOT   → DIPIOPS
[EPCOPAP004] Asesor Presidencial     «asesor presidencial» decía DIPASEPRE → EPCOPAP
[DIPMP0001] Marketing Político ×4    «marketing politico»  decía DIPIAMP   → DIPMP
```

🔴 **Los corchetes no son cosmética: son lo que evita los falsos positivos.** El primer borrador
buscaba el patrón en cualquier parte del texto y se comía tres campañas reales —`CONSULTOR360`,
`GOBERNA360` (×2)—, que son nombres comerciales, inventándoles las familias `CONSULTOR` y `GOBERNA`.
Con el corchete exigido, el barrido sobre las 153 da **cero falsos positivos**. El corchete es lo que
convierte al SKU en una afirmación: nadie escribe `[DIPCPOL020]` sin querer decir de qué producto es.

⚠️ **Alfanumérico, no «letras y después dígitos».** El primer patrón dejaba afuera a los genéricos
(`GEN5C2G3` intercala las dos cosas), que son familias con volumen real. Se exige lo que distingue a
un SKU de un rótulo de pauta: arranca con tres letras y lleva algún dígito. Así `[DIC]`, `[SEPT]` y
`[BLACK FRIDAY]` no pasan.

🔴 **La familia la extrae `familiaDeSku` (`cursos/catalogo.ts`), no un regex nuevo.** Esa función ya
sabe que los `GEN*` son genéricos donde **cada uno es su propia familia**, y quedarse con el prefijo
alfabético los colapsaría en un «GEN» que junta cursos sin relación. Escribir el segundo extractor
era #37 en un módulo que ya tiene dos gemelos vivos.

🔴 **Identidad y nombre se separan, y eso es lo que hace que esto no pueda empeorar una pantalla.**
Nueve familias afirmadas por SKU no tienen ni un alias cargado (`EPCOGPT`, `PKGOSAN`, `DIPECOC`…):
tienen identidad y **no tienen nombre**. Con `nombreCurso: null`, quien muestra texto se queda con el
título crudo —exactamente lo que hace hoy— y quien necesita identidad la gana. Devolver el código
crudo haría que la vendedora leyera **«PKGOSAN»** en el chip del curso, que es peor que lo de hoy.

### 2. Lo que no se puede afirmar: la corrección a mano

Los formularios de icarus **no traen SKU** (0 de 22: usan el nombre comercial), así que sus cuatro
errores solo se arreglan a mano. `PUT /api/routing/pieza-producto`, desde una hoja a la derecha.

## Las decisiones que se tomaron al revés de lo obvio

- **La corrección se guarda en `alias_curso`, el diccionario COMPARTIDO — decisión del dueño.**
  Corrige a la vez en Routing, en el chip de curso de la cola, en el Dashboard y en el bot. La
  alternativa evaluada era una tabla de overrides propia de Routing: no podía romper nada, y dejaba
  a la cola mostrando el producto viejo — **dos pantallas afirmando cosas distintas del mismo lead**
  (#37). Por eso la hoja **dice el alcance antes de que elijas**, no en el acuse.

- 🔴 **Un override es un alias que es el TEXTO ENTERO de la pieza.** No matchea ninguna otra cosa,
  gana a los demás por la regla de especificidad que *ya existía* (más palabras = más específico), y
  le gana al SKU por precedencia explícita. Sin tabla nueva, sin migración de datos y sin un segundo
  lugar donde diga de qué producto es cada cosa.
  · **Contra el SKU hay que ganar a propósito**: sin eso, corregir a mano una campaña que lleva
    `[DIPMP0001]` adentro contestaba `ok`, la pantalla mostraba el producto nuevo, y a la lectura
    siguiente el SKU la volvía a pisar. **La corrección se veía aplicada sin estarlo.**

- 🔴 **El texto de la pieza lo resuelve el SERVER; del navegador viaja solo la clave.** El alias se
  compara por texto exacto normalizado, así que un `×` por una `x` escribe una fila que **no matchea
  la pieza**: el `PUT` contesta `ok` y la regla no se aplica nunca. Es la forma exacta del defecto que
  la auditoría del 12-ago encontró en este mismo frente (se cableaba con una expresión del curso y se
  matcheaba con otra), y el mismo motivo por el que la cita de ADR 0054 manda solo el id.

- **Deshacer es `activo = false`, nunca un DELETE.** Un borrado pierde el rastro de que alguien había
  decidido otra cosa, y encima `ALIAS_SEMILLA` podría reinsertar la fila en el próximo arranque. Es
  la política que la tabla ya documentaba.

- **`corregido_por` sobrevive a deshacer.** La pregunta «¿quién había decidido esto?» aparece justo
  cuando alguien lo revirtió. Mismo criterio que `campana_cable.asignada_por`.

- **La lista de productos sale de dos lados y degrada**: `alias_curso` (las 21 que Hermes ya sabe
  nombrar, siempre disponibles) ∪ el catálogo vivo de Cerberus (las demás — es lo que permite mandar
  una pieza a un producto que todavía no tiene alias, que es el caso de los cuatro formularios). Con
  Cerberus caído se ofrecen las conocidas y **la hoja lo dice**: una pantalla de configuración que no
  abre porque el ERP está lento es peor que una lista incompleta que avisa.
  · ⚠️ **«No existe» y «no se pudo preguntar» son dos respuestas distintas** (`familia_desconocida`
    409 vs `catalogo_caido` 503). Colapsarlas mandaría a buscar el problema donde no está.

## La superficie: la hoja de la derecha

`src/features/routing/HojaDeLaPieza.tsx`. Se abre con el botón de producto del renglón, se superpone
al lienzo (molde de `HojaContacto`), **sin scrim** —para poder tocar otra pieza y que la hoja cambie
sin cerrarse, que es como se revisa una lista de piezas mal enlazadas— y Escape la cierra.

🔴 **El «por qué» es la mitad que hace útil a esta hoja.** «Consultor Político» a secas no se puede
juzgar; los tres orígenes se ven idénticos en la lista y **solo uno puede estar mal**:

| Lo que dice | Qué es | ¿Revisar? |
|---|---|---|
| Lo decidió alguien del equipo | ya corregido a mano | no |
| Lo dice el código del nombre | el SKU `[DIPCIBE004]` | no |
| Coincidió con «ciberdefensa» | una coincidencia de palabras | **sí**, y va marcado |

⚠️ **El clic del renglón NO abre la hoja** — la abre un botón aparte. Si el clic hiciera las dos
cosas, cablear pasaría a costar un Escape cada vez, porque la hoja tapa justamente la columna de
vendedoras donde se sueltan los cables.

🔴 **Y el listener de Escape de `VistaRouting` se APAGA mientras la hoja está montada.** Escribiendo
el test se descubrió que `stopPropagation()` de `useEscape` frena al shell (que escucha en burbuja)
pero **no a un listener hermano registrado antes en la misma fase de captura sobre `window`** — haría
falta `stopImmediatePropagation()`. O sea que el apagado explícito no era redundante: era lo único
que impedía que un Escape cerrara la hoja **y** la campaña abierta de una.

## Lo que NO se hizo

- **Reescribir el `platform`/`campaign_name` en la base.** Cambiar el hecho para no cambiar la
  consulta es al revés (la lección de `fuenteLead.ts`, 8-ago).
- **Una familia «ninguna»** para sacar una pieza de todo producto sin darle otro. Hoy se deshace la
  corrección y vuelve al automático; sacarla del todo no se pidió y no es representable
  (`alias_curso.familia` es NOT NULL).
- **Corregir el producto desde el nodo del lienzo.** El nodo ya tiene arrastre, clic y apertura; un
  cuarto gesto ahí era el cable fantasma otra vez.

## Evidencia

Barrido con las funciones reales del repo sobre **las 153 campañas y los 22 cursos de producción**
(`campana_meta` + `leads`, 18-ago-2026): 7 correcciones, 23 campañas que ganan producto, **cero
falsos positivos**, y **cero cambios** en los formularios (no traen SKU) y en las dos campañas que
hoy rutean.

Tests: 12 con base (`routing/productoDePieza.test.db.ts` — cada caso vuelve a preguntar por el camino
REAL, `aliasesActivos` + `resolverFamilia`, en vez de mirar la fila que escribió), 11 puros nuevos en
`cursos/alias.test.ts`, 10 de DOM en `HojaDeLaPieza.test.tsx` y 5 de la regla del «por qué».

Capturas: `docs/evidencia/routing-producto-*.png`.

## Lo que queda abierto

- **Las 70 campañas que siguen sin producto** son nombres de pauta sin SKU ni palabra de curso
  («[FEB] SEGURIDAD - R»). Se pueden corregir a mano una por una; agregarles el SKU al nombre en Meta
  las arreglaría a todas de una y es operación, no código.
- **`GET /api/routing/productos-elegibles` no cachea el catálogo de Cerberus** más allá del
  `staleTime` del front. Con la hoja abriéndose seguido son varias llamadas al ERP; si molesta, el
  arreglo es un caché corto en el server, no en el navegador.
