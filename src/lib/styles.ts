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
