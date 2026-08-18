# La Ribbon de la Libreta

> Bitácora del **17-ago-2026**. Qué se construyó, qué encontró cada paso, y qué falta.
> Continúa —y reemplaza en la pantalla— a `docs/barra-de-formato-libreta.md`, que sigue
> siendo la fuente de verdad de **fuente y tamaño** (§4 de aquel documento: el único
> cambio de esquema, y sigue sin tocarse).
>
> ⚠️ **Todo lo de acá está verificado con tests, typecheck, lint y mutación — NO con una
> captura de pantalla.** La extensión de Chrome no está conectada en esta máquina, así
> que la regla dura #2 **sigue sin cumplirse**: falta que una persona lo mire. La galería
> está lista para eso (§7).

---

## 1. Por qué, si la barra ya existía

La barra fija se construyó ese mismo día y resolvió lo que decía resolver: los comandos
existían desde el primer día (con `/`, con `Mod+B`, con la barra flotante al seleccionar)
y **no se veían**. Es el argumento de ADR 0034 un nivel más adentro.

Lo que quedó fue **una fila de dieciocho íconos sin un solo rótulo**. Eso sigue pidiendo
lo mismo que antes: probarlos de a uno para saber qué hacen. Y no tenía dónde poner lo
que todavía no existe, así que lo ausente y lo inexistente se veían igual — no se veían.

La Ribbon **no agrega poder tampoco**, salvo en lo que §5 lista explícitamente. Agrega
**nombres y agrupación**, y abre lugar declarado para lo que falta: apagado, con su
motivo, en vez de ausente.

> 🔴 **Es la tercera apuesta sobre el mismo tablero y se mide igual.** ADR 0034 (cero
> filas) · ADR 0046 §8 (5 páginas, 65 caracteres, las cinco pruebas) · la barra fija. Si
> a las dos semanas `con_algun_estilo` sigue en cero, **lo que faltaba no era la barra ni
> la Ribbon**. La consulta está en ADR 0046 §8.

---

## 2. Los tres hallazgos que decidieron la arquitectura

### 🔴 A. `FormattingToolbar` **atrapa el foco**, así que no puede ser la raíz

`Components.FormattingToolbar.Root` (de `@blocknote/mantine`) monta un **`useFocusTrap`**:
apenas el foco entra a la barra, `Tab` cicla adentro y **no vuelve al papel**. Con
dieciocho botones ya molestaba; con cinco pestañas y ~40 cajas es una trampa de la que
hay que salir con el mouse.

Se verificó leyendo el fuente de los seis botones del paquete que **ninguno necesita ese
contexto**: sólo piden `useComponentsContext()` (lo da `BlockNoteView`),
`useBlockNoteEditor()` y `useDictionary()`; `CreateLinkButton` usa `useExtension(...)`,
que lee del editor y no de un contexto de React.

→ La Ribbon **no usa `FormattingToolbar`**. Los botones del paquete se montan derecho
adentro de los grupos, con toda su lógica. El teclado pasa a ser nuestro
(`src/features/notas/ribbon/useRovingRibbon.ts`), y hay test que fija que los botones del
paquete siguen montándose (se buscan por el `data-test` que ellos mismos ponen).

**Consecuencia limpiada**: la regla de `src/index.css` que neutralizaba `.bn-toolbar`
quedó muerta y se retiró. Medido sobre el DOM montado: **cero** `.bn-toolbar` adentro de
`[data-libreta-barra]`. También se midió que el orden de hijos de `.bn-container` **no
cambió** (`.bn-editor` → barra → `.bn-root`), así que `order: -1` sigue siendo
obligatorio.

### 🔴 B. Fuera del `FormattingToolbar`, el estado activo se pide con hooks

Los selectores de fuente y tamaño leían `editor.getActiveStyles()` **en el render**, y
funcionaba **de casualidad**: `FormattingToolbar` los re-renderizaba en cada cambio de
selección. Sacados de ahí se habrían quedado clavados en lo que decían al montarse — un
selector afirmando «Arial» sobre un texto en Georgia, sin más síntoma que la mentira.

→ Pasaron a `useActiveStyles()` (`src/features/notas/ribbon/SelectoresDeTexto.tsx`). Lo
que depende del bloque usa `useSelectedBlocks()`.

### 🔴 C. Lo que no existe se DERIVA del esquema, nunca se escribe a mano

`src/features/notas/editor.ts` sacó `image`/`video`/`audio`/`file` a propósito: sin
`uploadFile`, una página que sea sólo un adjunto aplana a cadena vacía y el server la
rechaza. El catálogo **lee `BLOQUES_RETIRADOS`** para decidir qué caja sale apagada.

Escrita a mano, el día que los adjuntos existan el esquema los traería de vuelta y esas
cuatro cajas seguirían apagadas — sin error y sin test rojo. Es #37 sobre una lista de
cuatro elementos. Candado: `src/features/notas/ribbon/catalogo.test.ts`.

---

## 3. La forma

Todo vive en `src/features/notas/ribbon/`. **No es un módulo nuevo**: `arquitectura.json`
deriva los módulos del front de las carpetas *directas* de `src/features`, así que una
subcarpeta de `notas` sigue siendo `front/notas`. No hubo que declarar nada.

```
Ribbon.tsx            la cáscara: acceso rápido + pestañas + contraer
├── RibbonTabs.tsx    role="tablist", roving tabindex, ←/→/Inicio/Fin
├── RibbonGrupos.tsx  🔵 el que MIDE y decide; el registro de controles
│   ├── RibbonGrupo.tsx   role="group" + rótulo debajo
│   ├── RibbonBoton.tsx   el botón, y el puente catálogo↔pantalla
│   └── RibbonOverflow.tsx  el «Más (N)»
├── catalogo.ts       🔵 PURO: qué hay en cada pestaña y qué es real
├── acomodar.ts       🔵 PURO: qué entra en el ancho disponible
├── comandos.ts       el adaptador sobre el editor
├── copiarFormato.ts  🔵 PURO: qué sacar y qué poner (el pincel)
├── tamanos.ts        🔵 PURO: la lista y el paso de tamaño
├── contarTexto.ts    🔵 PURO: palabras y caracteres
├── vistaDelPapel.ts  zoom, ancho, ortografía, texto del papel
├── iconos.ts         nombre → pieza de lucide
├── useRovingRibbon.ts   una sola parada de Tab, y Escape sale
├── usePincelDeFormato.ts  cuándo se suelta el pincel
├── SelectoresDeTexto.tsx  fuente y tamaño
└── tabs/Tab{Inicio,Insertar,Dibujar,Revisar,Vista}.tsx
```

**Reutilizado sin tocar**: `SelectorBuscable.tsx` (+1 atributo), `fuentesDisponibles.ts`,
`estilosDeTexto.tsx`, `editor.ts`, `usePopover.ts`, `escapeDePopover.ts` y los botones de
`@blocknote/react`.

**`BarraDeFormato.tsx` sigue existiendo** y es el punto de montaje. 🔴 **Su
`data-libreta-barra` no se renombra**: de ese atributo cuelgan el `order: -1` de
`index.css` —sin el cual la barra queda **60 vh más abajo**— y los cuatro tests que ya
había, **que siguen pasando sin tocarlos**.

### El catálogo es puro, y el TIPO es el candado

```ts
export type EstadoComando = { tipo: 'real' } | { tipo: 'futuro'; motivo: string };
```

🔴 **`futuro` no se puede construir sin motivo.** No hay forma de apagar una caja sin
decir por qué, y ese porqué termina en el `title` del botón. No es una convención que
alguien puede olvidar: no compila. Un botón gris sin explicación se lee como «está roto»,
que es peor que la ausencia.

Y si un comando `real` no tiene control cableado, `RibbonComando` lo apaga solo y lo marca
`data-sin-cablear`; `Ribbon.test.tsx` falla si queda alguno. O sea: **la pantalla no puede
inventar un comando que el catálogo no declaró, ni encender uno que nadie cableó**.

### El estado

`tab` vive en `Libreta.tsx`, no adentro de la Ribbon: el editor se **remonta con `key`**
al cambiar de página, así que adentro te devolvería a «Inicio» cada vez. **Sólo se monta
la pestaña activa.**

Zoom, ancho y ortografía **se siembran del papel al montar y viven en React de ahí en
más** — el porqué está en §6.

---

## 4. Qué tiene cada pestaña

Leyenda: ✅ ya existía · 🆕 capacidad nueva · ⛔ apagado con motivo

**Acceso rápido** (en la fila de las pestañas, no adentro de ninguna): ✅ Deshacer ·
Rehacer. Metidos en «Inicio» desaparecerían al pasar a «Insertar», que es cuando más se
buscan. Hay test de las dos mitades.

### Inicio
| Grupo | |
|---|---|
| **Portapapeles** | 🆕 Cortar · Copiar · **Copiar formato** (pincel) · ⛔ Pegar — *«Usá ⌘V: el navegador no deja pegar desde un botón»* |
| **Fuente** | ✅ Fuente · Tamaño · N K S̲ S̶ ⌨ · Colores · Limpiar · 🆕 Agrandar / Achicar |
| **Párrafo** | ✅ Sangría ± · Izquierda · Centrar · Derecha · 🆕 Viñetas · Numeración · **Justificar** |
| **Estilos** | 🆕 Normal · Título 1 · 2 · 3 · ✅ Más estilos (el `BlockTypeSelect` del paquete) |

### Insertar — derivado del esquema
| Grupo | |
|---|---|
| **Tablas** · **Bloques** | 🆕 Tabla · Cita · Código · Separador · Tareas · Desplegable |
| **Vínculos** | ✅ Enlace (`CreateLinkButton`, con su `⌘K`) |
| **Multimedia** | ⛔ Imagen · Video · Audio · Archivo — derivado de `BLOQUES_RETIRADOS` |
| **Símbolos** | ⛔ Emoji — 🔴 **medido**: el selector de BlockNote es un `GridSuggestionMenuController` con `minQueryLength={2}`, o sea que no abre hasta la tercera tecla. Un botón que inserte `:` dejaría dos puntos sueltos. Apagado, el tooltip enseña el camino que sí existe |

### Dibujar — la pestaña entera apagada
Los siete grupos preparados (Seleccionar · Lápiz · Marcador · Borrador · Grosor · Color ·
Formas) con un renglón honesto: **«Todavía no hay lienzo para dibujar. La Libreta escribe,
no dibuja.»** La forma queda lista para enchufar un canvas; nada finge.

### Revisar
| Grupo | |
|---|---|
| **Corrección** | 🆕 Ortografía (el corrector del navegador, que ya estaba y no se podía apagar) |
| **Medida** | 🆕 Palabras |
| **Colaboración** | ⛔ Comentarios (BlockNote los trae, pero piden un almacén de hilos en el server) · Historial · Comparar |

### Vista
| Grupo | |
|---|---|
| **Zoom** | 🆕 Alejar · 100 % · Acercar |
| **Página** | 🆕 Ancho completo · Modo lectura |
| **Mostrar** | 🆕 Lista de páginas · Contraer |
| **Apariencia** | ⛔ Tema — `Libreta.tsx` monta el editor con `theme="light"` fijo |

---

## 5. Lo que sí es capacidad nueva, dicho

Copiar formato · Justificar · Agrandar/Achicar · Viñetas y Numeración como toggle ·
la galería de Estilos · los seis bloques de Insertar con botón propio · Cortar y Copiar ·
Ortografía · el contador de palabras · zoom · ancho de página · modo lectura ·
esconder la lista de páginas · contraer la Ribbon.

**Justificar era gratis y no estaba**: `textAlignment: 'justify'` ya vivía en el esquema
de BlockNote, con su ícono y su traducción al español.

⚠️ **El contador NO dice cuánto falta para el tope de 20.000**, y no es un olvido: ese
largo lo deriva el SERVER (`aTextoPlano`, en `server/src/notas/textoPlano.ts`, ~260
líneas). Copiar esa derivación en el navegador para poder dibujar una barra de progreso
sería #37, y un contador que dice «te quedan 150» cuando el server ya cuenta de más es
peor que ninguno, **porque se le cree**. Contesta «¿cuánto escribí?» y nada más.

---

## 6. Los defectos que aparecieron construyendo, y quién los encontró

| | Lo encontró |
|---|---|
| 🔴 **El bloqueo del modo lectura estaba construido y no lo usaba nadie.** El mecanismo entró en la Fase 4 y ninguna pestaña lo pasaba: en modo lectura «Viñetas» seguía editando, porque `updateBlock` funciona igual sobre un editor no editable. Ahora lo pregunta `RibbonGrupos`, así que **ninguna pestaña se lo puede olvidar**; lo que las pestañas declaran es lo único que sólo ellas saben (`edita={false}`) | un test de la Fase 6 |
| 🔴 **Cambiar un atributo del DOM no es una transacción de ProseMirror**, así que `useEditorState` no re-renderiza. En Revisar dejaba el botón de ortografía en `aria-pressed="true"` sobre un papel apagado. **En Vista no era cosmético**: `siguienteZoom` calculaba siempre desde el zoom viejo y **el segundo clic en «Acercar» no hacía nada**, sin un error en ningún lado | un test de la Fase 6 |
| 🔴 **Un `setEstado` que devuelve lo mismo igual puede provocar un render extra**, y el efecto que mide corre después de *cada* render: un bucle que no se ve como bucle, se ve como la barra parpadeando. Se cerró con un espejo en ref — si no cambió nada, `setEstado` **no se llama** | razonando el efecto, antes de que mordiera |
| ⚠️ **El «Más» no puede ser un popover.** Se intentó con `usePopover` (la puerta de la casa) y **se recorta**: la fila necesita `overflow-x` para el caso extremo, y `overflow-x: auto` obliga al navegador a computar `overflow-y: auto` también. Salió como segunda fila desplegable — menos código, imposible de recortar, y es lo que Office hace en ventanas angostas | intentarlo |

⚠️ **Y una mutación infiel casi da un falso verde.** Al verificar el defecto del zoom, la
primera mutación dejaba el `setZoom` puesto —que forzaba el render igual— y el test pasaba
**sobre el bug**. Hubo que repetirla sin él para verlo caer con el mensaje exacto
(`expected '1.15' to be '1.3'`). **Un test verificado contra una mutación infiel no está
verificado.**

---

## 7. Responsive

`acomodar.ts` es **puro**, con la medición afuera — el molde de
`fuentesInstaladas(candidatas, medidor)`. Acá el motivo es más fuerte que la prolijidad:
**jsdom no hace layout**, así que un test de DOM ve todos los anchos en cero y le da lo
mismo cualquier implementación. Es la lección de ADR 0024 y de la captura que encontró el
`order: -1`.

Los cuatro escalones, en orden:

1. se achica el aire entre grupos;
2. se van los rótulos de los BOTONES (abajo de **1.180 px**) — el `aria-label` y el
   tooltip se quedan: no se pierde información, se pierde tinta;
3. los grupos **secundarios** caen al **«Más (N)»**, que los abre en una segunda fila;
4. los **primarios no se van nunca** (en Inicio: Fuente y Párrafo).

El rótulo del GRUPO no está en la lista a propósito: es la mitad del argumento del frente.
El scroll horizontal queda **sólo como último recurso**, para el ancho donde ni los
primarios entran.

🔴 **Y no puede oscilar, y no por una histéresis puesta a mano**: la decisión no mira lo
que hoy se ve. Mira el ancho del contenedor (que no cambia por esconder nada) y los anchos
*naturales* cacheados por `modo:id`. Dos entradas estables ⇒ salida estable. Hay test que
aplica la decisión sobre su propio resultado.

⚠️ **`ANCHO_DEL_MAS = 52`** se reserva de más a propósito: pasarse deja unos píxeles sin
usar, quedarse corto esconde un grupo y la fila **sigue** sin entrar — el arreglo que no
arregla.

---

## 8. Accesibilidad

- **Pestañas**: `role="tablist"`/`role="tab"` con `aria-selected` y `aria-controls`, roving
  tabindex, ←/→/Inicio/Fin (el molde es `onTeclas` de
  `src/features/canales/BarraFiltros.tsx`). La flecha mueve **y elige**: la pestaña no
  dispara ninguna acción, así que separar «recorrer» de «elegir» agregaría un Enter por gusto.
- **La fila de comandos es UNA sola parada de `Tab`** (`role="toolbar"` + roving), que es
  lo que reemplaza al focus trap. **Escape devuelve el foco al papel** — con test, y
  verificado por mutación.
- ⚠️ **Con el foco en un campo, las flechas y el Escape son del campo**: el selector de
  fuente es un `input`. Se pregunta con `SELECTOR_CAMPOS`, el selector único de la casa —
  con una copia propia, la misma tecla en el mismo lugar se juzgaría distinto según quién
  la escuche (es el defecto que #12 arregló).
- Todo botón icon-only lleva `aria-label` + tooltip; los toggles llevan `aria-pressed`;
  **los apagados llevan su motivo en el `title`**.

---

## 9. Los tests

**5 archivos, 40 tests** en `ribbon/`, más los 4 de `BarraDeFormato.test.tsx` que siguen
pasando sin tocarse.

| Archivo | | Qué fija |
|---|--:|---|
| `catalogo.test.ts` | 7 | que nada finja: motivo obligatorio, ids únicos, íconos que existen, **Insertar cruzado contra el esquema**, y que no se perdió ninguno de los controles de la barra anterior |
| `acomodar.test.ts` | 9 | los cuatro escalones, que no oscila, y que un grupo sin medir se muestra |
| `tamanos.test.ts` | 6 | el paso camina la lista, los extremos devuelven `null`, el rango 6–200 |
| `copiarFormato.test.ts` | 4 | que aplicar también **saca** lo que sobra |
| `Ribbon.test.tsx` | 14 | el cableado: pestañas, nada sin cablear, todo lo apagado con motivo, los botones del paquete montados fuera de su toolbar, Escape, modo lectura, zoom, ancho, ortografía, deshacer/rehacer en todas |

**Verificado por mutación** (el estándar del repo): zoom sin estado propio → 🔴 · sin
bloqueo de modo lectura → 🔴 · Escape sin `alSalir` → 🔴 · `real` forzado en un bloque
retirado → 🔴 · `cortar` fuera del registro → 🔴.

**Suite completa del front: 117 archivos, 1.188 tests, en verde.** `tsc --noEmit -p
tsconfig.app.json` y `oxlint` limpios. `npm run mapa` regenerado y `npm run mapa:verificar`
en verde (97 módulos, 0 violaciones).

### Lo que los tests NO cubren, dicho

- **Que la Ribbon se VEA.** jsdom no hace layout: el acomodo real, el ajuste de los
  botones de 30 px (el tamaño que usan los del paquete) y el alto de la barra sólo se
  pueden verificar mirando.
- **`formattingToolbar={false}`** — sigue sostenido por un comentario, igual que antes: la
  flotante se monta en otro portal y sólo con una selección de texto real.

---

## 10. Qué falta

### Fase 7 — evidencia · **la única fase sin empezar**

La galería está lista y no necesita server ni base:

```bash
npx vite --port 5199   #  →  http://localhost:5199/galeria-libreta.html
```

⚠️ **Vite se ata a `[::1]` en esta máquina: abrir por `localhost`, no por `127.0.0.1`.**

Cuatro marcos: **1920** · **1366** · **1024** (compacta) · **760** (aparece el «Más»), más
uno con la **página en blanco** — el caso donde varios botones del paquete devuelven `null`
y la barra podría quedar existiendo sin un control adentro.

🔴 **La captura la tiene que sacar una persona**: la extensión de Chrome no está conectada
en esta máquina (verificado: cero navegadores). Es la misma limitación que
`docs/barra-de-formato-libreta.md` ya declaraba. Las capturas van a `docs/evidencia/`.

Qué mirar, en orden:

1. que la Ribbon se vea **entera y arriba del papel**, con los grupos separados y su
   rótulo debajo;
2. que cambiar de pestaña cambie los grupos, y que Deshacer/Rehacer sigan ahí;
3. **lo apagado**: pasar el mouse por Pegar, Emoji, las cuatro de Multimedia, todo Dibujar
   y las tres de Colaboración — cada una tiene que decir POR QUÉ;
4. **los cuatro anchos**, en ese orden, para ver los cuatro escalones del acomodo.

### Deuda que este frente deja abierta

- 🔴 **Falta el ADR.** Regla dura #3: toda reescritura documenta qué reemplaza y archiva
  al predecesor. Esto reemplaza la barra fija de `docs/barra-de-formato-libreta.md`, y ese
  documento **todavía describe la barra vieja** («qué tiene la barra hoy», §3). Hay que
  escribir el ADR y actualizar aquel §3, o va a envejecer igual que `arquitectura.md`.
- ⚠️ **`CLAUDE.md` no menciona este frente.** Si queda algún 🔴 que frene un error antes de
  cometerlo, va ahí; el fundamento va al ADR.
- ⚠️ **El pincel se desarma al cambiar de pestaña** (su estado vive en `TabInicio`). Es
  defendible y es reversible.
- ⚠️ **Zoom y ancho vuelven a su valor normal al cambiar de página**: el editor se remonta
  con `key` y el elemento es otro. Son ajustes de cómo mirás ESTA página; guardarlos es
  otro frente.
- ⚠️ **«Vista ▸ Lista de páginas» sólo tiene efecto de `md:` para arriba.** En ancho de
  teléfono la lista y la página ya son maestro-detalle, y esconderla ahí dejaría la
  pantalla sin forma de volver.
- ⚠️ **Nada de esto está commiteado todavía**, y el frente anterior (la barra fija) tampoco
  lo estaba cuando esto empezó: los dos conviven sin commitear en el working tree.

### Lo que este frente NO tocó

`ESQUEMA_LIBRETA` · `ESTILOS_PROPIOS` · `soloBloquesConocidos` · `soloEstilosConocidos` ·
`TAMANO_POR_DEFECTO` y su test contra `index.css` · el `jsonb` guardado · `useAutoguardado`
· `guardado.ts` · los espacios · el link público · `paginaPublica.ts` · **nada del server**
· ninguna migración.

`formattingToolbar={false}` **se queda** en `BlockNoteView`: apaga la barra flotante, y con
la Ribbon fija arriba sigue siendo lo correcto.

---

## 11. Los archivos

| | | |
|---|--:|---|
| `src/features/notas/ribbon/` | 2.606 | 22 archivos de código |
| `src/features/notas/ribbon/*.test.*` | 688 | 5 archivos, 40 tests |
| `src/features/notas/galeria.tsx` | 130 | la evidencia sin server |
| `galeria-libreta.html` | | el entry, aparte del bundle de la app |
| `src/features/notas/BarraDeFormato.tsx` | 50 | el punto de montaje, con los dos 🔴 que no cambian |
| `src/features/notas/Libreta.tsx` | | el estado del tab, el de la lista, y la prop hacia el editor |
| `src/index.css` | | se retiró la regla muerta de `.bn-toolbar`; entró `[data-ancho='completo']` |
| `src/features/notas/SelectorBuscable.tsx` | | +1 atributo (`data-roving-omitir`) |
| `docs/mapa.md` | | regenerado |
