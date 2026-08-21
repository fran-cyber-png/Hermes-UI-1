/**
 * Clases compartidas entre features — la fábrica canónica.
 * Regla dura: sombra O borde, nunca ambos. cardClass lleva borde (la elección
 * institucional sobre #F5F7FB); quien necesite flotar usa shadow-panel SIN borde.
 * El kicker uppercase NO es el default: sectionLabel es sentence-case; `kicker`
 * existe aparte y se usa como máximo UNA vez por vista (cintillo ganado).
 *
 * ══ LA ESCALA DE TAMAÑOS (20-ago-2026, criterio tomado de Notion, adaptado a
 * la densidad de Hermes) ══════════════════════════════════════════════════
 *
 * Antes de este barrido, un botón nuevo podía nacer en cualquiera de cinco
 * tamaños sueltos (`text-[9px]` a `text-[13px]`) según qué archivo copiara
 * quien lo escribió. La regla, de mayor a menor, con el criterio de CUÁNDO
 * usar cada escalón — no memorizar el número, memorizar el ROL:
 *
 *   1. **Título de vista/sección** — `cardHeaderClass` (abajo) o su mitad
 *      tipográfica sola: `font-heading text-sm font-bold text-navy-ink`.
 *      14px/700, Montserrat. Ej.: «Mi turno», «Ficha», «Timeline»,
 *      «Entrenamiento del bot». Nunca `text-lg`/`text-xl` sueltos para esto
 *      salvo que sea una CIFRA héroe (ver 6) o un modal centrado con su
 *      propio criterio (`text-lg`/`text-base` en `VistaCorreos`/`VistaAgenda`
 *      ya está bien así — no hace falta perseguir esos).
 *   2. **Botones y controles interactivos** (toggles, tabs segmentados,
 *      selects, botones de acción) EN UN CONTEXTO CON ESPACIO — banda de
 *      header, barra de herramientas, formulario, modal: `text-sm
 *      font-normal`. El color/fondo lleva la emphasis, no el peso — es el
 *      criterio de Notion: incluso su botón más importante es 400, nunca
 *      bold. La ÚNICA excepción es el CTA primario único de una pantalla
 *      («Atender a…», «+ Crear», «Guardar»): ese conserva `font-bold` (o
 *      `font-semibold`), pero SIEMPRE en `text-sm` — nunca en `text-xs`.
 *   3. **Cuerpo / lo que se lee** (nombre de una fila, texto de un mensaje,
 *      preview, nota de un recordatorio): `text-sm`, sin negrita salvo que
 *      el ESTADO de la fila la pida (ej. no leído = semibold).
 *   4. **Secundario** (subtítulos de dos líneas, metadata, descripciones,
 *      vacíos): `text-xs` — `sectionLabel` (abajo) es este nivel para
 *      headers de sub-sección.
 *   5. **Caption / el piso** (badges, chips comprimidos, timestamps,
 *      iniciales de avatar chico, kickers): `text-[11px]`. Es el mínimo:
 *      NUNCA `text-[9px]`/`text-[10px]` — si algo pedía 9 o 10, sube a 11.
 *   6. **Cifra-héroe** (la ÚNICA cifra más importante de una card/pantalla):
 *      un escalón de Tailwind (`text-3xl`, `text-5xl`…), nunca un `px`
 *      suelto (`text-[44px]`). Cuánto más grande depende de cuánto espacio
 *      propio tiene esa cifra — no hay un número fijo.
 *
 * TABLAS (`<table>` o listas que hacen de tabla): encabezado de columna en
 * el piso (11px, muted, `font-medium`/`font-semibold`), dato en el nivel 3
 * (`text-sm`) — nunca al revés, y el dato nunca más chico que su encabezado.
 * Es la relación que Notion usa en sus propias tablas.
 *
 * RADIOS: usar las clases del proyecto (`rounded-md`, `rounded-full`…) — acá
 * `rounded-md` YA ES 10px (`--radius` está redefinido en `index.css`, no es
 * el default de Tailwind). No forzar `rounded-[6px]` para imitar a Notion
 * literal: la escala propia del proyecto gana.
 *
 * EXCEPCIONES QUE NO SE TOCAN (densidad > escalón):
 *   · Chips/filtros muy comprimidos compitiendo por ancho en una sola fila
 *     (columnas del Pipeline, `BarraFiltros`) — se quedan en el piso (11px)
 *     aunque el mismo tipo de botón en un lugar espacioso suba a `text-sm`.
 *   · Contenido DENTRO de popovers/menús angostos ya establecidos (el menú
 *     de `SelectorEtapa`, el buscador de `Intereses`) — no se persiguió cada
 *     1px de esos rincones, solo los controles de primer nivel.
 *   · Color y peso de énfasis SEMÁNTICO (oro = tiempo que se acaba, rojo =
 *     vencido/urgente) no son parte de esta escala — esto es solo tamaño y
 *     jerarquía tipográfica.
 *
 * Antes de escribir una clase de texto a mano, mirá si `sectionLabel` /
 * `kicker` / `cardHeaderClass` / `fieldClass` ya cubren el rol.
 */
export const sectionLabel = 'text-xs font-semibold text-muted-foreground';
export const kicker = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
export const fieldClass = 'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground';
export const cardClass = 'rounded-2xl border border-border bg-card overflow-hidden';
export const cardHeaderClass = 'flex items-center justify-between border-b border-border px-5 py-3 font-heading text-sm font-bold text-navy-ink';

/**
 * ══ EL BOTÓN, CON EL SPEC DE NOTION ══════════════════════════════════════════
 *
 * Medido el 21-ago-2026 leyendo el CSS que Notion sirve (12 chunks, 1,3 MB,
 * 1.571 custom properties). El mapa completo con las fuentes de cada número
 * está en `scratchpad/mapa-ui-notion-21-ago-2026.md`.
 *
 * El componente canónico de allá, traducido:
 *
 *   .button      { border-radius: var(--border-button-radius)  → 8px
 *                  border: 1px solid transparent; background: none }
 *   .buttonSizeS { min-height: 30px; padding: 4px 11px; font: 500 14px/20px }
 *   .buttonSizeM { min-height: 36px; padding: 4px 14px; font: 500 16px/24px }
 *   .buttonSizeL { min-height: 46px; padding: 11px 20px; font: 500 16px/24px }
 *
 * 🔴 **EL PESO ES 500, Y ESTO CORRIGE LA ESCALA DE ARRIBA.** El nivel 2 dice
 * «`text-sm font-normal` … es el criterio de Notion: incluso su botón más
 * importante es 400, nunca bold». **Medido, el botón de Notion es `font-weight:
 * 500` en los tres tamaños** — y 500+600 son 45 de las 84 declaraciones de peso
 * de su CSS. El espíritu de la regla se sostiene (el color lleva la énfasis, no
 * un 700); el número que la enunciaba estaba mal. La regla correcta es
 * **«medium, no bold»**.
 *
 * 🔴 **EL BORDE TRANSPARENTE NO ES DECORACIÓN: ES LO QUE EVITA EL SALTO.** Todas
 * las variantes de Notion setean `border-color`, nunca `border-width`. Si el
 * primario naciera sin borde y el secundario con uno, el botón se correría 1px
 * al cambiar de variante o al deshabilitarse. Por eso `border border-transparent`
 * vive en la base y ninguna variante toca el ancho.
 *
 * 🔴 **`s` (30px) NO COINCIDE CON LA ALTURA DE CONTROL DE LA CASA, QUE ES 28.**
 * Medido: 18 usos de `h-7`/`min-h-7` en 14 archivos de ocho vistas — la barra de
 * gestión del chat, la agenda, la cabecera, la cola de revisión, la Libreta.
 * `boton()` con 30px convive con ellos, no los reemplaza.
 * ⚠️ **Consecuencia práctica: NO metas un `boton()` dentro de una fila de chips
 * `h-7`** — queda 2px más alto y 3px más ancho por lado. Ya pasó una vez
 * (`gestion/Intereses.tsx`, el «Confirmar» adentro de un chip `min-h-7`: el chip
 * crecía de 28 a ~38px). Y los 3px no son gratis: el panel del chat se ensanchó
 * DOS veces (25rem → 27.75rem) porque sus tres chips miden 372px solos, y
 * `App.tsx:857` pide medir el DOM antes de volver a subirlo.
 * **Unificar los dos moldes en 28px es una decisión de diseño pendiente, no un
 * arreglo**: bajaría los 80 botones ya convertidos.
 *
 * ⚠️ **`s` ES EL DEFAULT ACÁ, Y NO ES EL DEFAULT DE NOTION.** Su `m` (16px) es el
 * workhorse de una página de ayuda; el nuestro es `s` (14px = `text-sm`), que es
 * lo que la escala de arriba ya llamaba nivel 2. `m` y `l` quedan para lo que
 * tiene espacio propio: un modal centrado, un estado vacío, una landing.
 *
 * ⚠️ **DESHABILITADO NO ES OPACIDAD.** Notion colapsa TODAS las variantes al mismo
 * contorno apagado (`color: muted; border-color: base; background: none;
 * cursor: auto`) en vez de bajarle el alfa a lo que había. Un `opacity-40` sobre
 * un fondo navy da un azul lavado que sigue leyéndose como botón primario; esto
 * dice «no se puede» con la forma, no con la transparencia.
 *
 * ⚠️ **NO LLEVA `active:scale-[0.97]`**, que es el reflejo de la casa. Notion no
 * escala sus botones: mueve `transform` en 100 ms sólo donde el movimiento ES el
 * contenido. Si un botón puntual lo quiere, que lo agregue al llamar.
 *
 * El hover va en **150 ms** (`--motion-duration-150`), no en los 200 de la casa:
 * es la duración que Notion usa para `background` en todos lados.
 */
export type VarianteBoton = 'primario' | 'secundario' | 'terciario' | 'simple';
export type TamanoBoton = 's' | 'm' | 'l';

const BOTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm border border-transparent ' +
  'transition-colors duration-150 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-ring disabled:cursor-auto disabled:border-border disabled:bg-transparent ' +
  'disabled:text-muted-foreground';

const BOTON_TAMANO: Record<TamanoBoton, string> = {
  s: 'min-h-[30px] px-[11px] py-1 text-sm leading-5',
  m: 'min-h-9 px-3.5 py-1 text-base leading-6',
  l: 'min-h-[46px] px-5 py-[11px] text-base leading-6',
};

/**
 * ══ LAS VARIANTES: LA ESTRUCTURA DE NOTION, LOS COLORES DE HERMES ═══════════
 *
 * Notion define CUATRO variantes y, para cada una, seis slots de color:
 * `background` · `background-hover` · `background-focus` · `background-active` ·
 * `border` · `text`. Lo que se copia acá es **esa estructura**; los valores
 * salen de la paleta de la casa (`index.css`), no de la de ellos.
 *
 * 🔴 **LA ESCALERA TIENE TRES PELDAÑOS, NO DOS.** base → hover → **active**, cada
 * uno un escalón más oscuro, y `focus` pisa el mismo que `hover`. Los 24 botones
 * que había acá tenían dos (base y hover) y el `active` lo resolvían con
 * `scale-[0.97]`: movimiento en vez de color. Notion no mueve el botón, lo
 * oscurece — el click se confirma donde está el dedo, no desplazando el blanco.
 *
 * 🔴 **EL PRIMARIO ES `--primary` (#2563EB), NO EL NAVY, Y ESO SE MIDIÓ.** Hermes
 * tiene DOS azules de acción y estaban repartidos sin regla. Contados: en
 * `<button>` gana `bg-primary` **45 a 26**; fuera de botones gana `bg-navy`
 * **36 a 12** (cabeceras, avatares, el riel). O sea que **navy es el color del
 * CHROME y primary el de la ACCIÓN** — la primera versión de esto se construyó
 * sobre el navy y dejó afuera al «Atender a…» del Dashboard, que es la acción
 * primaria de la vendedora según el CLAUDE.md.
 * ⚠️ `--primary-hover` YA existía y YA invertía el sentido por tema (claro
 * #2563EB→#1D4ED8 oscurece, oscuro #3B82F6→#60A5FA aclara). Sólo hubo que
 * agregarle `--primary-active`, el tercer peldaño.
 *
 * 🔴 **UN PELDAÑO NO PUEDE SER ALFA.** `bg-navy/90` sobre el fondo
 * claro de la casa (#F5F7FB) **aclara** el botón, que es al revés de lo que un
 * hover de botón sólido tiene que hacer — y es lo que hacían los 24 botones que
 * había acá. Los peldaños se derivan en `index.css` (`--navy-hover`,
 * `--navy-active`) con `color-mix` contra negro. **En tema oscuro se derivan
 * contra BLANCO**: ahí el navy ya está casi contra el fondo y oscurecerlo más no
 * se percibe. Misma escalera, sentido invertido — por eso son dos tokens y no
 * una operación en la clase.
 * ⚠️ `secundario` y `terciario` SÍ usan alfa, y ahí está bien: parten de un tinte
 * claro y suben la carga de `navy-muted` (50 % → 80 %), o sea que oscurecen.
 * 🔴 **Y `navy-ink` NO sirve de peldaño oscuro**: en tema oscuro vale `#DCE7F7`,
 * o sea que es un color de TEXTO que se da vuelta. Usarlo de fondo «más oscuro»
 * pinta el botón de blanco al cambiar de tema.
 *
 * ⚠️ **`secundario` es un TINTE, no un botón blanco.** El de Notion es
 * `gray-100`/`blue-100` — un relleno suave, no una caja blanca. Acá eso es
 * `--secondary` (#EFF4FE) con `--secondary-foreground`, que ya existía para el rol.
 *
 * 🔴 **NINGUNA VARIANTE LLEVA BORDE VISIBLE, Y SE MIDIÓ.** `--color-button-primary-border`
 * es `transparent` en sus 6 definiciones y `--color-button-secondary-border` en
 * **11 de 12** (la que sobra es una sobrescritura temática puntual). Un secundario
 * se distingue por su RELLENO, no por un contorno. El `border border-transparent`
 * de la base NO es una excepción a esto: reserva el 1px para que un tema pueda
 * agregar borde sin correr el layout, y mientras nadie lo pida no se ve.
 *
 * ⚠️ **`font-medium` VIVE EN LA VARIANTE, NO EN LA BASE.** Es el peso 500 de
 * Notion, y las tres variantes con forma propia lo declaran; `simple` no, porque
 * su contrato es heredar. En la base chocaría con esa herencia y ganaría el
 * orden en que Tailwind emite las utilidades, que no es algo para depender.
 *
 * ⚠️ **`simple` IGNORA EL TAMAÑO.** Es la variante desnuda de Notion: hereda color
 * y peso del contexto, sin alto mínimo, con 6px de padding parejo. Para un botón
 * que vive dentro de un texto o de una fila, donde imponerle 30px de alto lo
 * rompería.
 * 🔴 **NO es la salida de los dos chips que quedaron sin convertir**
 * (`VistaDashboard.tsx:549`, `HiloWhatsapp.tsx:511`): ésos son navy SÓLIDO con
 * texto blanco, y `simple` no tiene fondo. Son primarios más chicos que la `s` de
 * Notion, que no tiene escalón debajo de 30px. Mientras no exista un `xs` medido,
 * siguen a mano — y sumarlo hay que decidirlo, no deducirlo de que hacen falta.
 */
const BOTON_VARIANTE: Record<VarianteBoton, string> = {
  primario:
    'font-medium bg-primary text-primary-foreground hover:bg-primary-hover ' +
    'focus-visible:bg-primary-hover active:bg-primary-active',
  secundario:
    'font-medium bg-secondary text-secondary-foreground hover:bg-navy-muted/50 ' +
    'focus-visible:bg-navy-muted/50 active:bg-navy-muted/80',
  terciario:
    'font-medium text-foreground hover:bg-secondary focus-visible:bg-secondary active:bg-navy-muted/50',
  simple:
    'p-1.5 text-inherit hover:bg-secondary active:bg-navy-muted/50',
};

/**
 * Las clases de un botón. `boton()` sin argumentos es el CTA primario chico,
 * que es el caso que más se repite en Hermes.
 *
 * Lo que el llamador agrega es POSICIÓN y ANCHO (`ml-auto`, `w-full`, `mt-3`),
 * nunca tamaño de texto, peso ni radio: eso es justo lo que esto centraliza.
 */
export function boton(variante: VarianteBoton = 'primario', tamano: TamanoBoton = 's'): string {
  // `simple` trae su propio padding y no lleva alto mínimo: pedirle un tamaño es
  // pedirle lo que esa variante existe para no tener.
  const medida = variante === 'simple' ? '' : ` ${BOTON_TAMANO[tamano]}`;
  return `${BOTON_BASE}${medida} ${BOTON_VARIANTE[variante]}`;
}
