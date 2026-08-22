# Mapa de la UI de Notion — medido, no deducido (21-ago-2026)

Referencia para terminar la estandarización de `src/lib/styles.ts`. Complementa
`cambios-ui-20-ago-2026.md`: aquella sesión midió la jerarquía con JS contra la app en vivo, ésta
mide **el design system completo leyendo el CSS que Notion sirve**.

## Cómo se obtuvo, y qué alcance tiene

12 chunks de CSS (1,3 MB) que carga `notion.so/help`, con **1.571 custom properties** — el design
system entero, con su escala numerada.

> ⚠️ **ES LA SUPERFICIE WEB, NO EL EDITOR.** Esto es el sistema de las propiedades web de Notion
> (help center, template gallery, marketing). El chrome del editor —sidebar, menú de slash, popovers
> de bloque— vive detrás del login y se inyecta por JS en runtime: no hay hoja estática que leer.
> Para eso hace falta un navegador con sesión, que es lo que se hizo el 20-ago. **Antes de citar un
> número de acá para un componente del editor, verificalo ahí.**

## La escala de tipo

`--font-size-*`. **El piso de la escala es 12px — no existe un escalón debajo.**

| token | rem | px | | token | rem | px |
|---|---|---|---|---|---|---|
| `50` | .75 | **12** | | `400` | 1.375 | 22 |
| `100` | .875 | **14** | | `500` | 1.625 | 26 |
| `150` | .9375 | 15 | | `600` | 2 | 32 |
| `200` | 1 | **16** | | `700` | 2.625 | 42 |
| `300` | 1.125 | 18 | | `800` | 3.375 | 54 |
| `350` | 1.25 | 20 | | `900`…`1100` | 4–6 | 64–96 |

**Uso real** (px literales en el CSS servido): `14px` ×36 · `16px` ×13 · `12px` ×8 · `20px` ×4 ·
`17px` ×3 · `40px` ×3. **14px domina**, igual que `text-sm` acá.

**Por debajo de 12px hay tres usos en 1,3 MB**: dos de 11px y uno de 8px (el ícono dentro de un
botón circular de "cargar más"). O sea: sub-12 no está prohibido, está **racionado**. El piso de 11px
de Hermes es defendible; `text-[9px]`/`text-[10px]` no.

## Los pesos

`400` regular · `500` medium · `600` semibold · `700` bold. Distribución real: **400 ×25 · 500 ×23 ·
600 ×22 · 700 ×12**.

> 🔴 **ESTO CORRIGE EL DOCBLOCK DE `styles.ts`.** Ahí dice «es el criterio de Notion: incluso su
> botón más importante es 400, nunca bold». **Medido, el botón real es 500**:
> `font-size:14px; font-weight:500; line-height:1.2; padding:0 8px` (los botones de las vistas de
> base de datos, `#2383e2`). El criterio correcto no es «400 siempre» sino **«medium, no bold»** —
> 500 y 600 juntos son 45 de 84 declaraciones de peso. El espíritu de la regla se sostiene (el
> color lleva la énfasis, no un 700); el número que la enuncia está mal.

Notion además define pesos variables un escalón más pesados para compensar el óptico:
`420` / `520` / `620` / `680`.

## Los radios — uno por ROL, no uno para todo

| token | px | | rol | radio |
|---|---|---|---|---|
| `200` | 4 | | botón | **8px** (`500`) |
| `300` | 5 | | botón grande | 10px (`600`) |
| `400` | 6 | | botón de ícono | 4px (`200`) |
| `500` | **8** | | ítem de menú | 8px (`500`) |
| `600` | 10 | | card · popover · banner | **12px** (`700`) |
| `700` | **12** | | badge | 4px o `round` |
| `800` | 14 | | asset / media | 4px (`200`) |

> ⚠️ **Acá usamos un radio donde Notion usa tres.** `rounded-md` de Hermes ya es 10px (redefinido en
> `index.css`) y se aplica igual a botones, chips e ítems de menú. Notion separa: control 8, tarjeta
> y popover 12, ícono y badge 4.

## El ítem de menú, con su regla real

```css
padding: 4px 8px;  border-radius: 5px;  gap: 6px;  min-width: 150px;
:hover { background: var(--color-gray-200) }   /* #f6f5f4 */
```

Relevante para el glitch de hover del `SelectorLinea` que se resolvió sacando `rounded-lg`: Notion
**no** usa esquina recta ahí, usa 5px — la mitad de `rounded-md`.

## El kicker: el hallazgo más accionable

Notion tiene el mismo rol, y se llama `smallcaps`:

```css
font-size: 11px;  text-transform: uppercase;  letter-spacing: .06em;
line-height: 1;   font-weight: 500;  color: var(--color-text-muted);
```

Contra el nuestro (`styles.ts:70`):

```
kicker = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground'
```

| | Notion | Hermes | |
|---|---|---|---|
| tamaño | 11px | 11px | ✅ igual |
| color | muted | muted | ✅ igual |
| **peso** | **500** (medium) | **700** (bold) | ❌ dos escalones más pesado |
| **tracking** | **.06em** | `tracking-wide` = .025em | ❌ menos de la mitad |
| **line-height** | **1** | sin declarar (hereda) | ❌ |

Un kicker es un rótulo que **no** compite con el contenido: Notion lo consigue con espaciado de
letras, no con peso. Nuestro `font-bold` + tracking corto hace lo opuesto.

**Cambio propuesto** (un solo lugar, `styles.ts:70`, y lo heredan sus 9 usos en 6 archivos):

```
kicker = 'text-[11px] font-medium uppercase tracking-[.06em] leading-none text-muted-foreground'
```

## Motion

| token | valor | | uso real |
|---|---|---|---|
| `duration-100` | .1s | | `transform .1s ease-in-out` |
| `duration-150` | .15s | | `background .15s` — el hover |
| `duration-200` | .2s | | fade-out (`ease-in`) |
| `duration-300` | .3s | | transform global (`ease-in-out-quint`) |

fade-in = **150ms ease-out** · fade-out = **200ms ease-in** — entra más rápido de lo que sale.

> ⚠️ Acá `duration-200 ease-house` es el default para todo, hover incluido. Notion pinta el hover en
> **150ms** y mueve un `transform` en **100ms**. Nuestro feedback de hover es ~33 % más lento.

## Grises

`100` #f9f9f8 · `200` **#f6f5f4** (el hover) · `300` #dfdcd9 · `400` #a39e98 · `500` #78736f ·
`600` #615d59 · `700` #494744 · `800` #31302e · `900` #191918

Cálidos, no neutros: todos tiran a amarillo/marrón. El nuestro es azulado (`#F5F7FB`) — decisión
institucional, no un defecto.

## Interlineado

Con `font-size:14px`, el `line-height` dominante es **1.2** (12 de 20 declaraciones). Denso, no aireado.

## Qué hacer con esto

Ordenado por relación valor/riesgo:

1. **El kicker** — un renglón en `styles.ts`, lo heredan 9 usos en 6 archivos. Es el delta más claro.
2. **Corregir el docblock**: «su botón es 400, nunca bold» → medido es **500**; la regla es
   «medium, no bold».
3. **Radio por rol** — separar control (8) de card/popover (12) de ícono/badge (4). Es un frente
   propio: toca muchos archivos y cambia la silueta de la app.
4. **Hover a 150ms** — barato, pero cambia el tacto de toda la app; medir antes de generalizar.
5. **Subir el piso a 12px** — Notion no tiene escalón debajo. Colapsaría el nivel 5 dentro del 4
   (`text-xs`). **Es una pregunta de diseño, no un arreglo**: la densidad de Hermes es mayor que la
   de una página de ayuda, y los 532 usos de `text-[11px]` no son un error contra este mapa.

---

# Implementado: el botón (21-ago-2026)

`boton(variante, tamaño)` en `src/lib/styles.ts`, con el spec medido arriba. Docblock completo ahí.

```ts
boton()                        // primario chico — el caso que más se repite
boton('secundario', 'm')
boton() + ' mt-3 w-full'       // el llamador aporta POSICIÓN, nunca tamaño/peso/radio
```

**Lo que colapsó.** Los 24 CTA primarios de la app estaban escritos cada uno a mano, con:

| eje | variantes que convivían |
|---|---|
| radio | `rounded-full` · `rounded-xl` (16) · `rounded-lg` (12) · `rounded-md` (10) · `rounded` (4) |
| peso | `font-bold` (700) en 23 de 24 — ninguno en el 500 de Notion |
| tamaño | `text-sm` · `text-xs` · `text-[11px]` |
| deshabilitado | `opacity-40` · `opacity-35` · `opacity-50` · `opacity-60` |
| foco | `outline-ring` · `outline-primary` · `ring-2 ring-primary/40` · `outline-none` |
| `active` | `scale-[0.97]` · `scale-[0.98]` · nada |

**22 convertidos**, en 17 archivos. Typecheck limpio · **1.795 tests verdes** (162 archivos) · oxlint sin
hallazgos nuevos.

### Los dos que NO se convirtieron, y por qué

- 🔴 **`dashboard/VistaDashboard.tsx:549`** — `rounded-full px-2.5 py-0.5 text-[11px]`. Tiene `bg-navy`
  y es un `<button>`, pero **mide 11px de alto de padding**: es una píldora, no un CTA. `boton()` le
  impondría `min-h-[30px]` y le rompería la fila.
- 🔴 **`whatsapp/HiloWhatsapp.tsx:511`** — `text-[11px] px-2.5 py-1 rounded-md`, botón en línea dentro
  de una burbuja del hilo. Mismo motivo: la altura del botón de Notion no entra ahí.

**La lección es la del docblock**: `boton()` es para lo que ES un botón. Un chip que usa `<button>` por
accesibilidad no se vuelve un botón por eso, y forzarlo rompe la densidad que la fila necesita.

### Lo que queda del mapa, sin hacer

1. El **kicker** (peso 500, tracking .06em, leading-none) — un renglón, 9 usos.
2. Corregir el nivel 2 del docblock de la escala: «su botón es 400» → medido es **500**. *(El docblock
   de `boton()` ya lo dice; falta enmendar el de arriba para que no se contradigan.)*
3. **Radio por rol** (control 8 · card/popover 12 · ícono/badge 4). `boton()` ya planta el 8 en los
   controles; falta card, popover y badge.
4. Hover global a 150 ms. `boton()` ya lo usa; el resto de la app sigue en 200.
5. Botones **secundario** y **fantasma**: las variantes existen y **no tiene consumidores todavía** —
   los ~90 botones outline/ghost de la app siguen a mano.

---

# Corrección: la escalera iba al revés (21-ago-2026, misma tarde)

La primera versión de `boton()` copió la estructura de Notion pero **erró la dirección del peldaño**,
y el docblock afirmaba lo contrario de lo que el código hacía.

> 🔴 **`bg-navy/90` sobre el fondo de la casa (#F5F7FB) ACLARA el botón.** Alfa = más superficie
> visible a través. Notion va de `blue-400` a `blue-700`: **oscurece**. Los 24 botones que había acá
> hacían todos lo mismo mal, así que no era un defecto mío — era el que venía — pero yo lo documenté
> como si oscureciera, que es peor que no documentarlo.

**El arreglo**: dos peldaños derivados en `index.css`, no alfa en la clase.

```css
--navy-hover:  color-mix(in oklab, var(--navy) 88%, black);   /* claro */
--navy-active: color-mix(in oklab, var(--navy) 76%, black);
--navy-hover:  color-mix(in oklab, var(--navy) 82%, white);   /* oscuro */
--navy-active: color-mix(in oklab, var(--navy) 68%, white);
```

⚠️ **En tema oscuro el sentido se invierte, y por eso son TOKENS y no una operación en la clase.** Ahí
el navy ya está casi contra el fondo: oscurecerlo más no se percibe. Misma escalera, sentido opuesto —
algo que `bg-navy/90` no puede expresar porque no sabe sobre qué está.

⚠️ `secundario` y `terciario` **sí** usan alfa y ahí está bien: parten de un tinte claro y suben la
carga de `navy-muted` (50 % → 80 %), o sea que oscurecen de verdad.

Además: **6 `hover:bg-navy/90` sueltos** (fuera de los 22 convertidos, en classNames dinámicos que el
barrido no alcanzaba) pasaron a `hover:bg-navy-hover`.

## Las cuatro variantes, con la estructura de Notion y los colores de Hermes

Notion define `primary` · `secondary` · `tertiary` · `simple`, y para cada una seis slots:
`background` · `-hover` · `-focus` · `-active` · `border` · `text`. Lo copiado es **esa estructura**.

| variante | base | hover / focus | active |
|---|---|---|---|
| `primario` | `bg-navy` | `bg-navy-hover` | `bg-navy-active` |
| `secundario` | `bg-secondary` + borde | `bg-navy-muted/50` | `bg-navy-muted/80` |
| `terciario` | transparente | `bg-secondary` | `bg-navy-muted/50` |
| `simple` | transparente, hereda color y peso | `bg-secondary` | `bg-navy-muted/50` |

🔴 **`focus` pisa el mismo peldaño que `hover`** — es un slot propio en Notion y acá faltaba.
🔴 **`font-medium` vive en la VARIANTE, no en la base**: en la base chocaría con la herencia de
`simple` y el ganador lo decidiría el orden en que Tailwind emite las utilidades.

## Otra corrección: `simple` NO es la salida de los dos chips

Escribí que `simple` resolvía `VistaDashboard.tsx:549` y `HiloWhatsapp.tsx:511`. **Es falso**: ésos son
navy sólido con texto blanco, y `simple` no tiene fondo. Son primarios más chicos que la `s` de Notion,
que no tiene escalón debajo de 30px. Mientras no exista un `xs` medido, siguen a mano.

**Verificado**: typecheck limpio · 1.795 tests verdes (162 archivos) · oxlint sin hallazgos nuevos ·
`color-mix` emitido en los dos temas con su fallback de Lightning CSS.

---

# Los bordes, y el barrido de secundario/terciario (21-ago-2026)

## Medido: los botones de Notion NO llevan borde

| variante | `--color-button-*-border` |
|---|---|
| `primary` | `transparent` en **6 de 6** |
| `secondary` | `transparent` en **11 de 12** (la que sobra es una sobrescritura temática) |
| `tertiary` | sin default dominante; los 4 valores vienen de contextos puntuales |

> ⚠️ **El `border: 1px solid transparent` de la base NO contradice esto.** Reserva el 1px para que un
> tema pueda agregar borde sin correr el layout. Mientras nadie lo pida, no se ve. Un secundario se
> distingue por su **relleno**, no por un contorno — y por eso a `secundario` se le sacó el
> `border-border` que le había puesto.

## El barrido

346 elementos `<button>` sin convertir. **La mayoría no son botones**, y meterles `boton()` les
rompería el layout:

| | qué es | por qué no |
|---|---|---|
| `ProximasActividades.tsx:38` | fila clickeable | `w-full text-left` — `justify-center` la destruye |
| `VistaNavegador.tsx:298` | tarjeta de destino | `items-start`, contenido multilínea |
| `MiniCalendario.tsx:37` | ícono suelto | `p-1` sin padding horizontal |

Tras filtrar por forma de botón quedaron **101**, y de ésos se convirtieron **36**:

| se saltó | cuántos | motivo |
|---|---|---|
| color semántico | 40 | `text-destructive`/`warning`/`success` — `secundario` los aplanaría |
| bajo la `s` de 30px | 10 | `text-[9/10/11]px`: Notion no tiene escalón debajo |
| fondo propio | 3 | chips de estado, no botones |
| píldora | 2 | `rounded-full` con rol de chip |

🔴 **`terciario` casi no se usa (6), y es a propósito.** Los 27 «outline» que había eran
`border border-border` + fondo transparente. Pasarlos a `terciario` los dejaba **sin borde Y sin
fondo**: texto pelado, invisible como botón. El equivalente real de Notion es **`secundario`** —
relleno suave, sin borde. Saca el borde (que es lo que se pedía) y conserva la forma.

## Dos hallazgos del barrido

- 🔴 **HERMES TIENE DOS «PRIMARIOS» Y `boton('primario')` SÓLO CUBRE UNO.** Los modales de la Libreta
  (`AccionesDePagina`, `SelectorDeEspacio`) usan `bg-primary` (#2563EB), no `bg-navy` (#0E2A52).
  Convertir sólo la mitad fantasma de esos pares dejaba dos botones de distinta altura, así que esos
  pares quedaron enteros sin tocar. **Decidir si `bg-primary` es una variante o una deuda es un
  frente aparte.**
- ⚠️ **Hay tres helpers locales llamados `boton`** (`PanelUsuario.lineaPropia.test.tsx`,
  `PantallaHechos.test.tsx`, `dibujo/BarraDeDibujo.tsx`) que no tienen relación con el export. No
  colisionan —el typecheck lo confirma— pero inflan cualquier `grep boton(`: el total dice 76 y las
  llamadas reales son 57.

## Estado

**57 llamadas en 38 archivos** — 23 primario · 28 secundario · 6 terciario · 0 simple.
Cero bordes visibles en botones convertidos. Typecheck limpio · 1.795 tests verdes · oxlint sin
hallazgos nuevos.

---

# El primario era el otro azul (21-ago-2026, revisión página por página)

Revisando el **Dashboard** apareció que su CTA —«Atender a {nombre}», la acción primaria de la
vendedora según el `CLAUDE.md`— **no estaba en el sistema**: usa `bg-primary`, y `boton('primario')`
se había construido sobre `bg-navy`.

## Medido: Hermes tiene DOS azules de acción, y cada uno tiene su lugar

| | en `<button>` | en otra cosa |
|---|---|---|
| `bg-primary` #2563EB | **45** | 12 |
| `bg-navy` #0E2A52 | 26 | **36** |

**Navy es el color del CHROME** (cabeceras, avatares, el riel); **primary es el de la ACCIÓN.** No era
una división limpia —`AgendarRapido.tsx` usaba los dos en botones— pero la tendencia es clara y decide
el empate.

`boton('primario')` pasó a `bg-primary` / `hover:bg-primary-hover` / `active:bg-primary-active`.

> ⚠️ **`--primary-hover` YA existía y YA invertía el sentido por tema** (claro #2563EB→#1D4ED8
> oscurece; oscuro #3B82F6→#60A5FA aclara). O sea que la regla que yo tuve que derivar a mano para el
> navy ya estaba escrita acá, bien, desde antes. Sólo faltaba `--primary-active` (#1E40AF / #93C5FD).
>
> Los tokens `--navy-hover`/`--navy-active` **se quedan**: los usan los botones que siguen siendo navy
> a propósito.

## Adopción tras el cambio

**85 llamadas en 45 archivos** — 49 primario · 28 secundario · 8 terciario.
Quedan **22 botones con azul literal**, todos saltados con motivo (íconos sin padding horizontal,
por debajo de los 30px, filas/tarjetas, color semántico).

---

# El tamaño `s` cede ante la densidad de la casa (21-ago-2026)

Revisando la **barra superior del chat** en Mensajes apareció que `boton()` traía un molde que choca
con el que ya existía.

| | barra de gestión (20-ago) | `boton('*','s')` v1 (Notion) |
|---|---|---|
| alto | **28px** (`h-7`) | 30px |
| padding | `px-2` (8px) | `px-[11px]` |
| radio | `rounded-md` (10px) | `rounded-sm` (8px) |
| peso | `font-normal` (400) | `font-medium` (500) |

🔴 **28px NO es el molde de esa barra: es la altura de control de la casa.** Medido: **18 usos** de
`h-7`/`min-h-7` en **14 archivos de ocho vistas** — gestión del chat, agenda, cabecera, cola de
revisión, Libreta, eventos. `boton()` con 30px no estandarizaba nada: agregaba el molde número 19.

🔴 **Y los 3px de padding no son gratis.** El panel del chat se ensanchó **dos veces** (25rem →
27.75rem) porque sus tres chips miden **372px solos**, y `App.tsx:857` deja escrito que antes de
volver a subirlo hay que medir el DOM. `px-[11px]` por chip empuja justo contra esa pared.

**`s` pasó a `min-h-7 px-2 py-1 text-sm leading-5`.** Es **la única desviación deliberada** de los
números de Notion, y el criterio que la autoriza ya estaba escrito en la escala de arriba: «criterio
tomado de Notion, **adaptado a la densidad de Hermes**».

⚠️ **Lo que NO se cede: el radio (8px) y el peso (500).** Están medidos y no chocan con nada de acá.
El `font-normal` de la barra venía de la afirmación equivocada de que el botón de Notion pesa 400.

⚠️ **`min-h-7`, no `h-7`.** La barra usa altura fija y ahí está bien —sus rótulos son de una palabra—
pero `boton()` también viste CTAs de modal, y una altura fija recorta el segundo renglón.

⚠️ **`m` y `l` conservan los números de Notion** (36/46px): son para contextos con espacio propio.

## Una regresión propia, encontrada y revertida

`gestion/Intereses.tsx:348` — el «Confirmar» de una propuesta de interés — **vive DENTRO de un chip
`min-h-7`** con `px-2 py-1`. Convertido a `boton()` quedaba en 30px: **más alto que su contenedor
entero**, que crecía a ~38px. Revertido, conservando el peldaño de hover corregido.

**La lección, otra vez la misma**: un `<button>` adentro de otra cosa no es un botón del sistema.
