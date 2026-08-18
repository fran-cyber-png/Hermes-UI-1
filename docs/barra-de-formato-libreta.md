# La barra de formato de la Libreta

> 🔴 **SUPERADO EL 18-AGO-2026 POR ADR 0058.** La barra fija que describe el §3 **ya no
> existe**: se convirtió en una Ribbon de cinco pestañas
> (`docs/adr/0058-la-ribbon-de-la-libreta.md`, bitácora en `docs/ribbon-de-la-libreta.md`).
>
> **Este documento sigue vivo por el §4**, que es la única parte que toca el esquema —
> `fuente` y `tamano`, la puerta de una sola dirección y su red `soloEstilosConocidos`— y
> que la Ribbon **no tocó**. El §2 (por qué no hay librería de ribbon y qué se descartó) y
> el §7 (cómo se mide si sirvió) también siguen valiendo.
>
> **Lo que quedó viejo es el §3**: esos quince controles siguen existiendo, pero repartidos
> en grupos rotulados y acompañados de lo que antes no tenía dónde ir. La tabla de qué hay
> hoy vive en el ADR.

> Contexto del frente `feat/desarrollo-notas-c` (17-ago-2026). Qué se construyó, de
> dónde salió cada pieza, y qué debería pasar si esto sirve.
>
> ⚠️ **Todo lo de acá está verificado con tests, typecheck y lint — NO con una
> captura de pantalla.** La extensión de Chrome no está conectada en esta máquina,
> así que la regla dura #2 sigue sin cumplirse: falta que una persona lo mire.

---

## 1. ¿Ya estaba implementado y oculto?

**Las dos cosas, y la distinción importa.**

| | |
|---|---|
| **La capacidad** | Ya estaba entera. Negrita, listas, título, color, alineación y enlace se podían hacer desde el primer día |
| **La barra fija** | No existía |

BlockNote —el editor de la Libreta— trae una **barra flotante** que aparece al
seleccionar texto, y un menú que se abre con **`/`**. Los dos ya andaban. También
los atajos (`Mod+B`, `Mod+K`).

Así que este frente **no agrega poder: agrega descubribilidad.** Conviene decirlo
así y no como «faltaba poder poner negrita», porque cambia cómo se mide si sirvió.

Es el argumento de **ADR 0034** un nivel más adentro: la Libreta entera estaba
construida y tenía **cero filas** en producción porque se abría con una tecla que
nadie enseñó. Una herramienta que no se ve no existe.

**Lo único que sí es capacidad nueva son la fuente y el tamaño** (§4), que no
existían en ninguna forma.

---

## 2. ¿Salió de una librería?

**No hay un «plugin de ribbon» para BlockNote.** Se buscó.

Lo que sí hay, y es lo que se usó:

- El patrón oficial **[Static Formatting Toolbar](https://www.blocknotejs.org/examples/ui-components/static-formatting-toolbar)**:
  `FormattingToolbar` **sin** su `FormattingToolbarController` se renderiza en el
  flujo en vez de flotar, y `BlockNoteView` recibe `formattingToolbar={false}`
  para apagar la flotante. Con las dos prendidas, seleccionar texto abriría una
  segunda barra con los mismos botones encima de la fija.
- Los **botones y selects que el paquete ya trae** (`BasicTextStyleButton`,
  `ColorStyleButton`, `TextAlignButton`, `NestBlockButton`, `CreateLinkButton`,
  `BlockTypeSelect`).
- **[`createReactStyleSpec`](https://www.blocknotejs.org/examples/custom-schema/font-style)**
  para los dos estilos propios.

### Lo que se descartó, con su motivo

| Alternativa | Por qué no |
|---|---|
| **Cambiar de editor** (TinyMCE, CKEditor 5, que sí traen ribbon de fábrica) | Otro formato de `doc jsonb`, reescribir `aTextoPlano`, `soloBloquesConocidos` y `ESQUEMA_LIBRETA`, migrar lo guardado. Y los dos son GPL-o-comercial. Por una barra no vale |
| **`queryLocalFonts()`** para enumerar las fuentes del sistema | Experimental y **solo Chromium** — la cáscara corre WKWebView en macOS, donde no existe. Además **dispara un permiso al usuario** y exige HTTPS |
| **`fontfaceobserver` / `font-detective`** | Hacen por dentro la misma medición que se escribió acá en ~25 líneas. Mismo criterio con el que **ADR 0038** dejó ffmpeg self-hosted en vez de traerlo de un CDN |
| **Google Fonts por CDN** | Sumaría una dependencia de red a un CRM que corre en laptops de vendedoras, y el repo ya decidió no depender de terceros vivos para que una función ande |

---

## 3. Qué tenía la barra ~~hoy~~ (superado por ADR 0058)

> 🔴 **Esta fila ya no existe.** Los quince controles siguen ahí, agrupados y rotulados
> dentro de la Ribbon; qué hay hoy y en qué pestaña vive en
> `docs/adr/0058-la-ribbon-de-la-libreta.md`. **La tabla de abajo se conserva porque su
> tercera columna —«¿toca el esquema?»— sigue siendo cierta y es lo que importa**: de los
> quince, sólo fuente y tamaño cambian lo que se guarda (§4).

```
↶ ↷ │ Tipo ▾ │ Fuente ▾ │ Tamaño ▾ │ N K S̲ S̶ ⌨ │ A▾ │ ⬅ ⬛ ➡ │ ⇤ ⇥ │ 🔗 │ ✧
```

| Control | Cómo está implementado | ¿Toca el esquema? |
|---|---|---|
| Deshacer · Rehacer | Propio: `editor.undo()` / `editor.redo()` sobre `FormattingToolbar.Button` | no |
| Tipo de bloque (título, listas, cita, tabla, código) | `BlockTypeSelect` del paquete | no |
| **Fuente** | Propio — `SelectorBuscable` + estilo `fuente` | **sí** |
| **Tamaño** | Propio — `SelectorBuscable` + estilo `tamano` | **sí** |
| Negrita · Cursiva · Subrayado · Tachado · Código | `BasicTextStyleButton` ×5 | no |
| Color de texto y resaltado | `ColorStyleButton` | no |
| Alineación (izq · centro · der) | `TextAlignButton` ×3 | no |
| Sangría (anidar · desanidar) | `NestBlockButton` / `UnnestBlockButton` | no |
| Enlace | `CreateLinkButton` | no |
| Limpiar formato | Propio: `editor.removeStyles(editor.getActiveStyles())` | no |

⚠️ **`removeStyles` no es «sacá todo»: recibe QUÉ sacar** — sin argumento ni
compila. Se le pasa lo activo en vez de una lista escrita a mano, que es la única
forma de que no se olvide un estilo nuevo el día que el esquema crezca.

### Lo que quedó afuera, a propósito

- **Copiar formato, Styles, Tags, dictado** — no existen en BlockNote. Son
  features propias, no una barra.
- **Buscar** — ya vive en la Libreta (`useBuscarNotas`) y sobre **todas** las
  páginas. Un segundo buscador que solo mire la abierta serían dos respuestas a la
  misma pregunta en la misma pantalla.

---

## 4. Fuente y tamaño: la única parte que cambia lo guardado

Son estilos que BlockNote no tiene, creados con `createReactStyleSpec`
(`estilosDeTexto.tsx`). Desde que existen, el texto puede guardarse así:

```json
{ "type": "text", "text": "hola", "styles": { "fuente": "Georgia, serif" } }
```

### 🔴 Es una puerta de una sola dirección

La misma que `editor.ts` ya documentaba para los bloques de archivo: **el día que
se saquen del esquema, toda página escrita con una fuente elegida deja la ventana
en blanco.** No es «la nota no abre»: `useCreateBlockNote` construye el editor
durante el render y en `src/` no hay ningún `ErrorBoundary`.

Y `soloBloquesConocidos` **no cubría esto** — filtra bloques, y un estilo vive
adentro de `styles`, en el contenido en línea.

**Por eso entraron junto con `soloEstilosConocidos`** (`editor.ts`), que camina el
árbol entero y limpia donde aparezca un `styles`. No enumera rutas a propósito: los
estilos viven en `content[]`, pero también en `children[]` (listas anidadas) y en
`rows[].cells[]` (tablas), y una ruta olvidada no da error — deja pasar el estilo
justo en el caso raro. Es el mismo criterio que `aTextoPlano` del lado del server.

Con esa red, el rollback degrada a **abrir sin formato**, que es feo y reversible,
en vez de la ventana en blanco, que no lo es.

### Cómo se eligen las fuentes que se ofrecen

**Se miden.** Se dibuja el texto con la fuente candidata y se compara el ancho
contra una genérica: si no está instalada, el navegador cae al respaldo y los
anchos dan idénticos (`fuentesDisponibles.ts`).

- Se miden las **tres** genéricas (`monospace`, `sans-serif`, `serif`), no una:
  con una sola, cualquier fuente que por casualidad mida igual se reporta ausente.
- Se mide **la familia sola**, no la cascada: `"Optima, sans-serif"` siempre daría
  presente, porque el respaldo existe.
- Sin canvas (jsdom, o un navegador que no deje medir) **se ofrecen todas**:
  degrada de más, nunca de menos.

Eso es lo que hace la lista elegible: de 36 candidatas, solo aparecen las que esa
máquina tiene, así que **ninguna se ve igual a otra**. Y cada opción se dibuja con
su propia fuente.

### El combo se escribe, como en Word

`SelectorBuscable.tsx`. El campo **es** el control: se toca, se selecciona todo el
texto, se escribe encima y la lista se filtra. `↑ ↓` recorren, `Enter` aplica,
`Escape` **restaura** el valor anterior.

En tamaño, además, un número escrito a mano vale (acotado 6–200 px). La opción de
la lista le gana a lo tecleado: si escribís `14` y ese tamaño existe, es ése.

Tres detalles que sin ellos molesta:

- **`select()` al enfocar** — si no, tocar «Arial» y escribir `geo` deja `Arialgeo`.
- **`onMouseDown` y no `onClick`** en las opciones — el clic normal llega después
  del blur del campo, y para entonces el panel ya se cerró: no se elegía nunca.
- **Escape se maneja en el `onKeyDown`**, no en `usePopover`: ese hook **ignora el
  Escape cuando el foco está en un campo**, y esa regla es correcta y deliberada
  (quien escribe una etiqueta y aprieta Escape espera perder la palabra, no el
  formulario). Acá el campo es el control, así que Escape tiene que cerrar. El
  clic-afuera lo sigue manejando `usePopover`, sin reimplementar nada.

---

## 5. Dos cosas que este frente cambió y hay que saber

### La Libreta deja de heredar Montserrat

Se le fijó **Arial 16px** al papel (`index.css`) para que el selector no mienta: si
dice «Arial», tiene que escribir en Arial. Antes decía «Predeterminada», que no es
ninguna fuente.

Contradice la regla de `index.css` que devolvía la fuente de la marca al editor.
**Es una decisión de producto del dueño (17-ago-2026)**, no un efecto colateral.

⚠️ Con eso se compró un **número duplicado**: «Arial» y «16» están en el CSS y en
el TS, y no hay dónde unificarlos (uno es CSS, el otro TypeScript). Hay un test que
**lee `index.css`** y los cruza — verificado por mutación en las dos direcciones.

### La barra cruza el panel, el texto sigue en columna

La restricción de ancho se mudó **del contenedor al texto**: `.bn-editor` se centra
con `max-width: 48rem` y el contenedor ocupa el panel entero. Así se evitó levantar
la instancia del editor y envolver todo con `BlockNoteContext` a mano, que es API
bastante menos transitada.

🔴 **Y BlockNote renderiza sus hijos DESPUÉS del contenido.** Medido:

```
0. .bn-editor            ← el papel, con min-height: 60vh
1. [data-libreta-barra]  ← la barra
2. .bn-root
```

Sin corregirlo, la barra quedaba **60vh más abajo**: existía, tenía sus botones y
no se veía. Se corrige con `order: -1` en el CSS (la doc oficial usa
`column-reverse`, que da vuelta también `.bn-root`, que no es nuestro).

⚠️ **Eso lo encontró una captura de pantalla, no un test** — jsdom no hace layout,
así que para él la barra estaba perfecta. Es la lección de ADR 0024 otra vez.

---

## 6. Dónde se usa

**Solo en la Libreta** (vista ⌘8 / tecla `n`), en el editor de una página —
`EditorDePagina` de `Libreta.tsx`, que se monta en tres lugares: una página
guardada, una página en blanco, y una abierta por link.

**No se dibuja en solo lectura**: es el caso del link con permiso `ver` (ADR 0048)
y el de una nota histórica de `gestiones`. Ofrecer negrita sobre algo que no se
puede editar promete una acción que no existe.

**No toca ninguna otra pantalla.** Nada del composer de WhatsApp, del panel derecho
ni de la cola.

⚠️ **La página pública (`/n/<token>`) no muestra estos formatos**, y es correcto:
`server/src/espacios/paginaPublica.ts` pinta desde `texto` (el plano), no desde `doc`. Un link
compartido se ve sin formato — ya pasaba con la negrita.

---

## 7. Cómo se sabe si esto sirvió

**La métrica no es que la barra se vea. Es que las páginas dejen de ser texto plano.**

La Libreta ya falló una vez por descubribilidad (ADR 0034: cero filas) y una
segunda por otra cosa (ADR 0046 §8, medido el 10-ago: 5 páginas, 65 caracteres en
total, las cinco pruebas — «asdasd», «ryvv», «/»). Esta es la tercera apuesta sobre
el mismo tablero, así que conviene mirar el número antes de agregarle nada.

```sql
-- ¿Alguien usa el formato, o las páginas siguen siendo texto plano?
SELECT
  count(*)                                                        AS paginas,
  count(*) FILTER (WHERE doc::text LIKE '%"styles":{"%')          AS con_algun_estilo,
  count(*) FILTER (WHERE doc::text LIKE '%"fuente"%')             AS con_fuente,
  count(*) FILTER (WHERE doc::text LIKE '%"tamano"%')             AS con_tamano
FROM notas
WHERE archivado_at IS NULL;
```

Si a las dos semanas `con_algun_estilo` sigue en cero, **lo que faltaba no era la
barra** — y ahí la pregunta vuelve a ser la de ADR 0046: en Hermes lo que se usa es
un clic que mueve algo, no escribir.

---

## 8. Los archivos

| Archivo | | Qué |
|---|--:|---|
| `src/features/notas/BarraDeFormato.tsx` | 244 | La barra y los cuatro controles propios |
| `src/features/notas/SelectorBuscable.tsx` | 218 | El combo tipo Word, reusable |
| `src/features/notas/fuentesDisponibles.ts` | 143 | Las 36 candidatas y la medición |
| `src/features/notas/estilosDeTexto.tsx` | 74 | Los dos estilos propios del esquema |
| `src/features/notas/editor.ts` | | `styleSpecs` + **`soloEstilosConocidos`** |
| `src/features/notas/Libreta.tsx` | | Monta la barra, `formattingToolbar={false}`, `ColumnaDeEscritura` |
| `src/index.css` | | El papel (Arial 16), el `order: -1` y la neutralización de `.bn-toolbar` |

**Tests**: `BarraDeFormato.test.tsx` (4) y `estilosDeTexto.test.ts` (11).

Suite completa del front en verde: **1.148 tests, 112 archivos**.

### Lo que los tests NO cubren, dicho

- **`formattingToolbar={false}`** — se verificó por mutación que sacarlo deja los
  tests en verde. La flotante se monta en otro portal y solo con una selección de
  texto real, que jsdom no produce. Hoy esa mitad la sostiene un comentario.
- **Que la barra se VEA.** jsdom no hace layout. Cubrirlo pide un navegador de
  verdad — una galería con Playwright, el camino que el repo ya usa para la
  evidencia.
