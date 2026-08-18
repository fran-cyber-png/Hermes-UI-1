# ADR 0058 — La barra de formato de la Libreta se vuelve una Ribbon

**Fecha**: 2026-08-18 · **Estado**: aceptado · **Reemplaza**: la barra fija descrita en
`docs/barra-de-formato-libreta.md` §3 (ese documento sigue vivo como la fuente de verdad de **fuente
y tamaño**, que es lo único que toca el esquema y no se toca acá)

---

## El problema

La barra fija se construyó el 17-ago-2026 y resolvió lo que decía resolver. El planteo era correcto
y sigue siéndolo: **los comandos existían desde el primer día** —con `/`, con `Mod+B`, con la barra
flotante al seleccionar texto— y nadie los encontraba. Es el argumento de **ADR 0034** un nivel más
adentro: una herramienta que no se ve no existe.

Lo que quedó, medido en la pantalla, fue **una fila de dieciocho íconos sin un solo rótulo**. Eso
mueve el problema, no lo cierra: para saber qué hace cada uno hay que apretarlo. Y tenía una segunda
carencia que no se ve mirando la barra: **no había dónde poner lo que todavía no existe**, así que
lo ausente y lo inexistente se veían igual — no se veían.

🔴 **Es la tercera apuesta sobre el mismo tablero, y hay que decirlo antes de construir nada.**
ADR 0034 midió **cero filas** en `notas`. ADR 0046 §8 midió, el 10-ago, **5 páginas y 65 caracteres
en total** — las cinco, pruebas. La barra fija fue la tercera. Esto es la cuarta.

**La métrica no es que la Ribbon se vea. Es que las páginas dejen de ser texto plano**, y la consulta
que lo contesta ya está escrita en ADR 0046 §8. Si a las dos semanas `con_algun_estilo` sigue en
cero, **lo que faltaba no era la barra ni la Ribbon**.

---

## La decisión

**Una Ribbon de cinco pestañas, donde lo que no existe se dibuja apagado y con su motivo.**

No agrega poder salvo donde se dice más abajo. Agrega dos cosas:

1. **Nombres y agrupación.** Los mismos comandos, adentro de grupos rotulados —Portapapeles, Fuente,
   Párrafo, Estilos— con el rótulo debajo. El rótulo del grupo es lo único que no se esconde nunca
   cuando falta espacio, porque es la mitad del argumento.
2. **Lugar declarado para lo que falta.** Insertar, Dibujar, Revisar y Vista tienen sus cajas. Las
   que no andan salen grises **con el porqué en el tooltip**.

🔴 **Y el porqué no puede faltar, porque lo impide el TIPO:**

```ts
export type EstadoComando = { tipo: 'real' } | { tipo: 'futuro'; motivo: string };
```

No hay forma de apagar una caja sin decir por qué: no compila. Un botón gris sin explicación se lee
como «está roto», y eso es **peor que la ausencia** — le retira crédito a la barra entera, incluidos
los botones que sí andan. `catalogo.test.ts` cubre lo que el tipo no puede (que nadie lo evada con
un `as`) y `Ribbon.test.tsx` falla si queda un comando `real` que nadie cableó.

---

## Los cuatro hallazgos que decidieron la forma

### 🔴 1. `FormattingToolbar` atrapa el foco, así que no puede ser la raíz

`Components.FormattingToolbar.Root` (de `@blocknote/mantine`) monta un **`useFocusTrap`**: apenas el
foco entra a la barra, `Tab` cicla adentro y **no vuelve al papel**. Con dieciocho botones ya
molestaba —era el estado que este frente heredó— y con cinco pestañas y ~40 cajas es una trampa de
la que hay que salir con el mouse.

**Se verificó leyendo el fuente de los seis botones del paquete que ninguno necesita ese contexto**:
sólo piden `useComponentsContext()` (lo provee `BlockNoteView`), `useBlockNoteEditor()` y
`useDictionary()`; `CreateLinkButton` usa además `useExtension(...)`, que lee del editor y no de un
contexto de React.

→ **La Ribbon no usa `FormattingToolbar`.** Los botones del paquete se montan sueltos adentro de los
grupos, con toda su lógica —estado activo, tooltip, locale `es`—, y el teclado pasa a ser nuestro:
una sola parada de `Tab`, ←/→ recorren, **Escape devuelve el foco al papel**.

⚠️ **Lo que eso obliga a mantener**: hay un test que fija que los botones del paquete siguen
montándose, y los busca por el `data-test` que ellos mismos ponen. Si una versión nueva del paquete
empezara a exigir el contexto, ese test se pone rojo en vez de dejar una Ribbon con los grupos bien
rotulados y **sin negrita**.

**Consecuencia limpiada**: la regla de `src/index.css` que neutralizaba `.bn-toolbar` quedó muerta y
se retiró. Medido sobre el DOM montado: **cero** `.bn-toolbar` adentro de `[data-libreta-barra]`.
También se midió que el orden de hijos de `.bn-container` **no cambió** (`.bn-editor` → barra →
`.bn-root`), así que el `order: -1` —sin el cual la barra queda 60 vh más abajo— sigue siendo
obligatorio.

### 🔴 2. Fuera de ese componente, el estado activo hay que pedirlo

Los selectores de fuente y tamaño leían `editor.getActiveStyles()` **en el render**, y **funcionaba
de casualidad**: `FormattingToolbar` los re-renderizaba en cada cambio de selección. Sacados de ahí
se habrían quedado clavados en lo que decían al montarse — un selector afirmando «Arial» sobre un
texto en Georgia, sin más síntoma que la mentira.

→ Pasaron a `useActiveStyles()`; lo que depende del bloque usa `useSelectedBlocks()`.

⚠️ **Y hay un caso donde el hook del paquete NO alcanza, que costó dos defectos** (ver «Lo que
apareció construyendo»): **cambiar un atributo del DOM no es una transacción de ProseMirror**. Zoom,
ancho de página y ortografía se siembran del papel al montar y viven en React de ahí en más.

### 🔴 3. Lo que no existe se DERIVA del esquema, nunca se escribe a mano

`editor.ts` sacó `image`/`video`/`audio`/`file` del esquema a propósito: sin `uploadFile`, una página
que sea sólo un adjunto aplana a cadena vacía y el server la rechaza por vacía. El catálogo **lee
`BLOQUES_RETIRADOS`** para decidir qué caja de «Insertar» sale apagada.

Escrita a mano, el día que los adjuntos existan de verdad el esquema los traería de vuelta y esas
cuatro cajas seguirían apagadas — **sin error, sin test rojo y sin nadie que se entere**. Es la forma
de #37 sobre una lista de cuatro elementos.

El candado no compara contra una lista: cruza cada comando contra `ESQUEMA_LIBRETA.blockSchema`.

### 🔴 4. Y el que este ADR paga: pedir una cadena traía el motor del editor

Este frente introdujo un defecto de bundle que **no se ve leyendo ninguno de los dos archivos
involucrados**. La decisión de §«El estado» fue poner la pestaña activa arriba del editor, en
`Libreta.tsx`, para que cambiar de página no la reseteara. Eso trajo un import, y el import trajo una
cadena de un solo salto:

```
Libreta.tsx    pide la constante con la pestaña por defecto  →  ribbon/catalogo.ts
catalogo.ts    importa ESQUEMA_LIBRETA                       →  notas/editor.ts
editor.ts      importa BlockNoteSchema                       →  @blocknote/core
```

O sea: **la cáscara de la vista pedía la cadena `'inicio'` y se llevaba el motor del editor entero.**
Medido con `vite build`: entrar a la Libreta costaba **377,8 KB gzip**; cortando ese borde de módulo
(más un `lazy()` para el editor y el diagrama), **19,7 KB**.

⚠️ **El import de `catalogo.ts` al esquema está bien y se queda** — es el hallazgo 3, y es lo que
impide que las cuatro cajas de adjuntos queden apagadas para siempre. **Lo que estaba mal es el borde
del módulo**: en el catálogo va lo que necesita preguntarle al esquema (qué comandos hay y cuáles
andan), y en un módulo aparte lo que se puede saber sin abrir el editor (cómo se llaman las pestañas
y en qué orden van).

🔴 **La regla que queda, y vale para cualquier feature perezosa**: *un módulo que importa una librería
grande no puede exportar además la constante trivial que la cáscara necesita*. No hay síntoma —el
tipo cierra, el test pasa, la app anda— hasta que alguien mide el chunk.

⚠️ **La corrección vive en el PR #413 (`perf/libreta-en-tres-chunks`), todavía sin mergear** al
escribirse esto. La regla se documenta acá porque es de este frente, no de aquél: **el defecto lo
introdujo esta decisión.**

---

## Qué es capacidad NUEVA, dicho

Casi todo es la barra anterior reordenada. Lo que sí es nuevo:

Copiar formato (el pincel) · **Justificar** · Agrandar/Achicar · Viñetas y Numeración como toggle ·
la galería de Estilos · los seis bloques de «Insertar» con botón propio · Cortar y Copiar ·
Ortografía · el contador de palabras · zoom · ancho de página · modo lectura · esconder la lista de
páginas · contraer la Ribbon.

**Justificar era gratis y no estaba**: `textAlignment: 'justify'` ya vivía en el esquema de
BlockNote, con su ícono y su traducción al español.

⚠️ **El contador de palabras NO dice cuánto falta para el tope de 20.000, y no es un olvido.** Ese
largo lo deriva el SERVER (`aTextoPlano`, en `server/src/notas/textoPlano.ts`, ~260 líneas: camina el
`doc` con sus separadores, sus celdas y sus listas anidadas). Copiar esa derivación al navegador para
poder dibujar una barra de progreso sería #37, y **un contador que dice «te quedan 150» cuando el
server ya cuenta de más es peor que ninguno, porque se le cree.** Contesta «¿cuánto escribí?» y nada
más.

---

## Lo que NO entra, y por qué

| | |
|---|---|
| **Pegar** | El navegador **no deja leer el portapapeles desde un clic** sin permiso, y en Firefox no lo deja de ninguna forma. El atajo sí anda siempre, así que el botón queda apagado diciendo `Mod+V`. Es descubribilidad igual: enseña el camino que existe |
| **Emoji** | 🔴 **Medido, no supuesto**: el selector de BlockNote es un `GridSuggestionMenuController` con `triggerCharacter=":"` y **`minQueryLength={2}`**, o sea que no abre hasta la tercera tecla. Un botón que inserte `:` dejaría dos puntos sueltos en el texto y la sensación de que está roto. Apagado, el tooltip enseña `:so` |
| **Toda la pestaña «Dibujar»** | BlockNote no dibuja y en el repo no hay lienzo. Se dibujan igual los siete grupos, con un renglón que lo dice — la forma queda lista para enchufar un canvas y **nada finge** |
| **Comentarios** | BlockNote los trae, pero piden un almacén de hilos del lado del server. Es un frente, no un botón |
| **Tema** | La Libreta monta el editor con `theme="light"` fijo. Un selector acá obligaría a decidir qué pasa con el resto de la app |
| **Una librería de UI** | No hay Radix ni shadcn instalados (`components.json` existe y es vestigial: `src/components/` son cinco archivos propios). Fluent UI traería el look de Office encima de la marca y un bundle grande en una app que corre en laptops de vendedoras. La casa ya tiene las dos primitivas que hacían falta: `usePopover` (#12) y `SelectorBuscable`. **Cero dependencias nuevas** |

---

## Responsive: la decisión vive pura porque jsdom no hace layout

Cuatro escalones, en orden: se achica el aire → se van los rótulos de los BOTONES (abajo de 1.180 px;
el `aria-label` y el tooltip se quedan, así que se pierde tinta y no información) → los grupos
**secundarios** caen a un «Más (N)» → **los primarios no se van nunca**. El scroll horizontal queda
sólo como último recurso.

🔴 **La regla vive en `acomodar.ts`, puro, con la medición afuera** — el molde de
`fuentesInstaladas(candidatas, medidor)`. Acá el motivo es más fuerte que la prolijidad: **jsdom ve
todos los anchos en cero**, así que para un test de DOM *cualquier* implementación de esto es
correcta. Es la lección de ADR 0024, y la misma por la que el `order: -1` lo encontró una captura y
no la suite.

🔴 **Y no puede oscilar, y no por una histéresis puesta a mano**: la decisión **no mira lo que hoy se
ve**. Mira el ancho del contenedor —que no cambia por esconder nada— y los anchos *naturales*
cacheados. Dos entradas estables ⇒ salida estable, y hay test que aplica la decisión sobre su propio
resultado.

⚠️ **El «Más» no es un popover, y no es una inconsistencia.** Se intentó con `usePopover`, que es la
puerta de la casa, y **se recorta**: la fila necesita `overflow-x` para el caso extremo, y
`overflow-x: auto` obliga al navegador a computar `overflow-y: auto` también, así que cualquier panel
absoluto queda cortado por abajo. Salió como segunda fila desplegable — es un `disclosure`, no una
capa que tape nada, y por eso lleva `aria-expanded` en vez de overlay.

---

## Lo que apareció construyendo, y quién lo encontró

| | Lo encontró |
|---|---|
| 🔴 **El bloqueo del modo lectura estaba escrito y no lo usaba nadie.** Los botones del paquete se esconden solos cuando el editor no es editable; los nuestros no se enteran, y `updateBlock` funciona igual sobre un editor en solo lectura. «Viñetas» editaba una página que la pantalla decía que no se edita. Ahora lo pregunta el contenedor de grupos, así que **ninguna pestaña se lo puede olvidar** | un test |
| 🔴 **Cambiar un atributo del DOM no es una transacción de ProseMirror**, así que `useEditorState` no re-renderiza. En Revisar dejaba el botón de ortografía en `aria-pressed="true"` sobre un papel apagado. **En Vista no era cosmético**: el escalón se calculaba desde el zoom viejo y **el segundo clic en «Acercar» no hacía nada**, sin error en ningún lado | un test |
| 🔴 **Un `setEstado` que devuelve lo mismo igual puede provocar un render extra**, y el efecto que mide corre después de *cada* render: un bucle que no se ve como bucle, se ve como la barra parpadeando | razonar el efecto antes de que mordiera |
| 🔴 **Sumar 22 archivos al front puso el CI en rojo sin romper una línea de lógica.** `App.test.tsx` esperaba el montaje de la Libreta hasta 50 turnos del event loop; con el caché de Vite frío hacían falta **79**. Pasaba en local y fallaba en el runner, que es exactamente como se ve un flake sin serlo | el CI, después del merge |

⚠️ **Y una mutación infiel casi da un falso verde.** Al verificar el defecto del zoom, la primera
mutación dejaba el `setZoom` puesto —que forzaba el render igual— y el test pasaba **sobre el bug**.
Hubo que repetirla sin él para verlo caer con el mensaje exacto (`expected '1.15' to be '1.3'`).
**Un test verificado contra una mutación infiel no está verificado.**

---

## Evidencia

**5 archivos de test, 40 tests** en `src/features/notas/ribbon/`, más los 4 de
`src/features/notas/BarraDeFormato.test.tsx`, **que siguen pasando sin tocarse** — el
`data-libreta-barra` no se renombró justamente por eso.

Verificado por mutación: zoom sin estado propio → 🔴 · sin bloqueo de modo lectura → 🔴 · Escape sin
devolver el foco → 🔴 · `real` forzado en un bloque retirado → 🔴 · un comando fuera del registro →
🔴.

Suite del front al 18-ago-2026, con el caché de Vite borrado (la condición del runner): **130
archivos, 1.357 tests, en verde.** `tsc --noEmit -p tsconfig.app.json` y `oxlint` limpios,
`npm run mapa:verificar` en verde.

### 🔴 Lo que NO está verificado, y es la regla dura #2

**Nadie lo miró todavía.** No hay captura: la extensión de Chrome no está conectada en la máquina
donde se construyó (verificado: cero navegadores). Es la misma limitación que
`docs/barra-de-formato-libreta.md` ya declaraba para la barra anterior.

La galería está lista y no necesita server ni base — `galeria-libreta.html`, con cuatro anchos
(1920 · 1366 · 1024 · 760) más el caso de la **página en blanco**, donde varios botones del paquete
devuelven `null` y la barra podría quedar existiendo sin un control adentro.

**Lo que jsdom no puede ver, y por lo tanto sigue sin verse**: que la Ribbon se dibuje arriba del
papel, el acomodo real en cada ancho, el ajuste de los botones de 30 px (el tamaño que usan los del
paquete) y el alto de la barra, que es ~3× el de la barra anterior.

⚠️ **`formattingToolbar={false}` sigue sostenido por un comentario**, igual que antes: apaga la barra
flotante, que se monta en otro portal y sólo con una selección de texto real. Sacarlo deja los tests
en verde.

---

## Bitácora

Contexto completo, las siete fases y la deuda abierta: **`docs/ribbon-de-la-libreta.md`**.
