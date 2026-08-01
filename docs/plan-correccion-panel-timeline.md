# Plan de corrección — Panel derecho (timeline)

> Corrección del frente `PanelDerecho.tsx` + `EncabezadoTimeline.tsx` +
> `BarraMetaContacto.tsx` + `EventoLinea.tsx` + `PieAccionTimeline.tsx` +
> `timeline.ts`, según la design review (2026-07-31).
>
> **Cero cambios en el server.** El working tree tiene WIP de bot en
> `server/src/bot/` — ese frente queda fuera de este plan por completo.

---

## 0. Cómo leer este plan

Cada tarea tiene: archivos a tocar, cambio exacto (con líneas actuales),
tests, y cómo verificar. El orden de ejecución es el orden de las secciones:
**MVP primero (bugs de verdad), V2 después (forma), V3 al final (estructura)**.

Verificación global en cada fase (regla dura #2):
`npx tsc --noEmit -p tsconfig.app.json` · `npm test` · galería
(`npx vite --port 5199` → `galeria-mensajes-completa.tsx`) con screenshot
desktop + 360 px.

---

## FASE MVP — correcto y accesible, sin rediseño de forma

### MVP-1 · Sacar el placeholder de IA y el chevron muerto

- **Archivos**: `src/features/panel/PanelDerecho.tsx`, `src/features/panel/EncabezadoTimeline.tsx`.
- **Por qué**: `PanelDerecho.tsx:116` shippea prosa falsa ("Vista previa del
  resumen IA — se cablea cuando exista el endpoint") y `EncabezadoTimeline.tsx:139-141`
  es un botón sin `onClick` (control muerto, heurística Nielsen #4).
- **Cambio exacto**:
  1. En `PanelDerecho.tsx`: borrar la prop `resumenIa="Vista previa…"` del `<EncabezadoTimeline>`.
  2. En `EncabezadoTimeline.tsx`: borrar el bloque `{resumenIa && (…)}` (líneas 135-143),
     la prop `resumenIa` de `PropsEncabezado`, y los imports `Sparkles` y `ChevronDown`.
- **Verificación**: la app no muestra ninguna caja de resumen IA; `tsc` limpio.
- **Nota**: el componente vuelve en V2-5, ya colapsable, solo cuando el endpoint exista.

### MVP-2 · Un solo vocabulario de estado (borrar `mapearEstado`/`ETIQUETA_ESTADO`)

- **Archivos**: `src/features/panel/PanelDerecho.tsx`, `src/features/panel/EncabezadoTimeline.tsx`.
- **Por qué**: dos implementaciones del mismo estado. Hoy `'alto'` y `'cliente'`
  comparten clases idénticas (`EncabezadoTimeline.tsx:28-29`), y un contacto
  `sin-saber` + padrón pinta "Alta intención" en verde mientras
  `estadoContacto.ts:135-145` dice «No figura con este número». Lección #37.
  Además `acento` y `compras` —ya calculados y testeado— se descartan.
- **Cambio exacto**:
  1. `PanelDerecho.tsx`: borrar `mapearEstado` (líneas 28-32) y `tieneAlgo`
     (línea 78). Al `<EncabezadoTimeline>` pasarle:
     ```tsx
     acento={estado.acento}
     tituloEstado={estado.titulo}
     compras={estado.compras}   // ResumenCompras | null
     ```
  2. `EncabezadoTimeline.tsx`: reemplazar `ETIQUETA_ESTADO` y el badge
     (líneas 27-31 y 114-116) por un mapeo **de `AcentoContacto`**:
     ```tsx
     const BADGE_ACENTO: Record<AcentoContacto, string> = {
       cliente: "border-success/30 bg-success/10 text-success",
       alerta:  "border-warning/30 bg-warning/10 text-warning-foreground",
       frio:    "border-temp-frio/30 bg-temp-frio/10 text-temp-frio",
       neutro:  "border-border bg-muted text-muted-foreground",
     };
     ```
     El badge pinta `tituloEstado` con `BADGE_ACENTO[acento]`.
  3. En la línea de identidad (debajo del nombre), mostrar las compras cuando
     existan — el dato que cambia el trato, hoy tirado:
     ```tsx
     {compras && (
       <span className="font-semibold text-success">
         {compras.n} {compras.n === 1 ? "compra" : "compras"} · {compras.total} {compras.moneda}
       </span>
     )}
     ```
     (misma línea que el badge, alineado a la derecha).
- **Verificación**: con un contacto que ya compró y Cerberus caído, el badge
  dice «No figura con este número» en ámbar — nunca verde.

### MVP-3 · Piso tipográfico: nada de 9/10 px, contraste ≥ 4.5:1

- **Archivos**: `EventoLinea.tsx`, `EncabezadoTimeline.tsx`, `BarraMetaContacto.tsx`,
  `PieAccionTimeline.tsx`.
- **Cambio exacto** (búsqueda y reemplazo):
  | De | A | Dónde |
  |---|---|---|
  | `text-[9px]` | `text-[11px]` | pill de timestamp y de pendiente, `EventoLinea.tsx:54,125` |
  | `text-[10px]` | `text-xs` | chips `EncabezadoTimeline.tsx:152`, acciones `EventoLinea.tsx:85` |
  | `text-slate-400` | `text-slate-500` | todo texto de 11 px o menor (#94a3b8 ≈ 2.9:1, falla AA) |
  | `size-9` / `size={9}` / `size={10}` | `size-3` (12 px) como mínimo | iconos decorativos |
- **Verificación**: nada de la pantalla queda por debajo de 11 px; el contraste
  de micro-texto pasa 4.5:1 sobre blanco.

### MVP-4 · Acciones accesibles (no solo hover, targets ≥ 24 px)

- **Archivos**: `src/features/panel/EventoLinea.tsx`.
- **Cambio exacto**:
  1. Línea 80: `opacity-0 transition-opacity group-hover/ev:opacity-100` →
     `opacity-60 transition-opacity group-hover/ev:opacity-100 group-focus-within/ev:opacity-100`
     (el piso de 60% deja ver que hay acciones; el focus también las revela).
  2. Cada botón de icono (editar, borrar, corregir, agregar): `aria-label`
     (`"Editar evento"`, `"Borrar del timeline"`, `"Corregir lo que la IA detectó"`,
     `"Agregar ${campo}"`) — el `title` solo no alcanza (WCAG 4.1.2).
  3. Hit area: `min-h-6 min-w-6 grid place-items-center` en cada botón
     (WCAG 2.5.8, mínimo 24 px).
- **Verificación**: navegar todo el panel solo con Tab; cada acción es visible
  al enfocarla y operable con Enter.

### MVP-5 · Foco único (sacar el ring duplicado)

- **Archivos**: `src/features/panel/BarraMetaContacto.tsx`.
- **Por qué**: `index.css:276-279` define el outline global de foco; la línea 52
  agrega `focus-visible:ring-2 focus-visible:ring-primary/40` encima → dos
  indicadores, y el débil (40% de opacidad) tapa al fuerte.
- **Cambio exacto**: en el botón de `ItemMeta`, borrar
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`.
  El outline global alcanza.

### MVP-6 · Chips sin duplicar

- **Archivos**: `src/features/panel/PanelDerecho.tsx`, `src/features/panel/EncabezadoTimeline.tsx`.
- **Por qué**: la campaña aparece tres veces (tarjeta meta, chip con Megaphone,
  evento "Llegada"). Una verdad por pantalla (Gestalt).
- **Cambio exacto**:
  1. `PanelDerecho.tsx:87-89`: borrar el chip de campaña; queda solo `{ texto: 'VIP' }`.
  2. Como ningún chip lleva icono, simplificar la prop a `chips: string[]`,
     borrar `ICONO_CHIP` y los imports `Megaphone`/`Calendar` de `EncabezadoTimeline.tsx:1,33-36`,
     y renderizar los chips sin icono.
- **Verificación**: la campaña vive solo en la tarjeta meta y en el evento de llegada.

### MVP-7 · Dead code

- **Archivos**: `PanelDerecho.tsx`, `App.tsx`, `EventoLinea.tsx`, `timeline.ts`, `timeline.test.ts`.
- **Cambio exacto**:
  1. `PanelDerecho.tsx:36-41`: borrar `onCorreo` y `onAgendarBienvenida`
     (las props van con `_` y nunca se usan). **Y borrarlas del call site**:
     `App.tsx:586-587` deja de pasar `onCorreo`/`onAgendarBienvenida`.
  2. `PanelDerecho.tsx:131`: `onAccion={() => {}}` — **no se shippea un botón
     sin handler**. Regla: si la mutación real no está en la rama
     (`asentarVentaEnEmbudo` / registrar interés), el pie muestra solo la rama
     de mensaje (`sin-saber`/`cargando`) y el botón vuelve en V3 cableado.
     Si la mutación existe, cablearla — nunca un no-op.
  3. `EventoLinea.tsx:45`: el ternario `(e.estado === "pendiente" ? "bg-slate-100" : "bg-slate-100")`
     es muerto → dejar `"bg-slate-100"` directo.
  4. `timeline.ts:58`: `progreso` se computa y nadie lo renderiza. Sacarlo del
     tipo de retorno y de `timeline.test.ts` (vuelve en V2-3, donde sí se muestra).
  5. `PanelDerecho.tsx:123`: keys → `${e.tipo}-${e.timestamp ?? 'sin-fecha'}-${e.valor ?? ''}`
     (provisional hasta V2-1, donde el evento lleva `id` estable).
- **Verificación**: `rg "onCorreo|onAgendarBienvenida|progreso" src/features/panel` → sin resultados.

### MVP-8 · Tokens de color en header y pie

- **Archivos**: `EncabezadoTimeline.tsx:108`, `PieAccionTimeline.tsx:21,35`, `EventoLinea.tsx:42`.
- **Cambio exacto**:
  1. Avatar: `bg-slate-800` → `bg-navy`; quitar `ring-slate-200`.
  2. Botón del pie: `bg-slate-800` → `bg-primary hover:bg-primary-hover`
     (`--primary-hover` ya existe en `index.css:20-21`); borrar la sombra
     arbitraria `shadow-[0_4px_16px_-4px_rgba(0,0,0,0.2)]`; mantener `rounded-xl`.
  3. `EventoLinea.tsx:42`: borrar el glow arbitrario
     `shadow-[0_0_0_3px_rgba(16,185,129,0.12)]` (cae solo en V2-2 con el rail,
     pero se elimina ya para no propagarlo).
- **Verificación**: la app se ve igual de marcada, pero con la paleta del sistema.

**DoD de la fase**: `tsc` limpio, `npm test` verde, screenshot antes/después,
recorrido de teclado completo (MVP-4), ningún texto por debajo de 11 px (MVP-3).

---

## FASE V2 — el timeline y la metadata dejan de ser cajas

### V2-1 · `timeline.ts`: cronología real (orden + grupos + ids estables)

- **Archivos**: `src/features/panel/timeline.ts`, `src/features/panel/timeline.test.ts`.
- **Por qué**: hoy `timeline.ts:149` concatena `[...confirmados, ...ia]` — orden por
  fuente, no por fecha; una compra del año pasado aparece antes que la llegada de
  hoy. El timeline no responde «última actividad».
- **Cambio exacto**:
  1. Firma con reloj inyectado (patrón del repo, `senales/enfriamiento.ts`):
     ```ts
     export function ensamblarTimeline(
       datos: {...},
       ahora: () => Date,
     ): { grupos: GrupoDia[]; pendientes: CampoPendiente[]; progreso: number }
     ```
  2. Cada evento lleva `id` estable (para keys de React):
     `id: `${tipo}:${timestamp ?? 'sin-fecha'}:${valor ?? ''}``.
  3. Orden: `timestamp` desc (más reciente primero); eventos **sin** timestamp
     van al final de su grupo (no se inventa fecha, no se descartan).
  4. Agrupación por día con etiquetas del reloj inyectado:
     ```ts
     interface GrupoDia { etiqueta: string; eventos: EventoLinea[] }
     // etiqueta: 'Hoy' | 'Ayer' | '14 jul' | fecha larga si pasó >1 año
     ```
  5. `progreso` vuelve al tipo de retorno (lo consume V2-3).
- **Tests** (extender `timeline.test.ts`): orden desc con timestamps mezclados;
  eventos sin timestamp al final; agrupación Hoy/Ayer/fecha con reloj fijo;
  `id` estable para el mismo evento; `progreso` correcto.

### V2-2 · `EventoLinea.tsx`: dot rail sin cajas

- **Archivos**: `src/features/panel/EventoLinea.tsx`, `src/features/panel/PanelDerecho.tsx`.
- **Por qué**: cada evento pinta 5 capas de color (punto + bg + borde + icono +
  pill) dentro de una caja — un collage, no un timeline. Patrón: Linear/GitHub/Stripe.
- **Cambio exacto** — el evento pasa a ser una fila de texto sobre un rail:
  ```
  ●  14:02  Cotización · [IA]        ← punto (10px, color por estado) + hora a la derecha
      "Sí, me interesa, ¿cuánto cuesta?"
  ```
  1. Sacar: caja (`rounded-lg border … c.borde c.bg`), icono del rótulo, pill de
     timestamp, fila "Fuente/confianza" (líneas 48-72 y 72-109) — fuente y
     confianza van a `title` del rótulo.
  2. `COLOR` pasa a solo `{ punto, tag }` (nada de borde/bg):
     ```ts
     confirmado: { punto: "bg-success",      tag: "" },
     manual:     { punto: "bg-primary",      tag: "Manual" },
     ia:         { punto: "bg-warning",      tag: "IA" },
     pendiente:  { punto: "border-dashed",   tag: "Pendiente" },
     ```
  3. Estructura:
     ```tsx
     <li className="relative flex gap-3 py-1.5 pl-1" data-ultimo={esUltimo}>
       <Punto estado={e.estado} />                 {/* 10px, z-10 */}
       <span className="absolute left-2 top-4 bottom-[-0.375rem] w-px bg-border data-[ultimo]:hidden" />
       <div className="min-w-0 flex-1 pb-2">
         <div className="flex items-baseline gap-2">
           <span className="text-xs font-semibold text-foreground">{e.rotulo}</span>
           {tag && <span className="text-[10px] font-semibold uppercase text-warning">IA</span>}
           <time className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{hora}</time>
         </div>
         {e.valor && <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.valor}</p>}
       </div>
     </li>
     ```
  4. La línea conectora se oculta en el último (`data-ultimo:hidden`), no se
     renderiza más allá del último punto.
  5. El timestamp deja de ser pill: es `text-[11px] tabular-nums` quieto a la
     derecha. El estado va como tag textual junto al rótulo — dos slots, no uno.
  6. Las acciones de hover (MVP-4) siguen, sin la fila de meta.
- **`PanelDerecho.tsx`**: el timeline se renderiza como `<ol>` (semántica de
  lista ordenada temporalmente); el mapeo pasa `esUltimo` y usa `e.id` como key.
- **Nota**: `COLOR` hoy también lo importa la galería; verificar
  `galeria-mensajes-completa.tsx` y actualizar su copia si hace falta.

### V2-3 · Pendientes como zona «Por completar»

- **Archivos**: nuevo `src/features/panel/ZonaPendientes.tsx`; `EventoLinea.tsx`
  (borrar `LineaPendiente`); `PanelDerecho.tsx`.
- **Por qué**: un ghost con borde punteado intercalado en la actividad no es un
  evento; es una tarea. Intercom/Notion separan "what's missing" de "what happened".
- **Cambio exacto**:
  ```tsx
  export function ZonaPendientes({
    pendientes, progreso, onAgregar,
  }: { pendientes: CampoPendiente[]; progreso: number; onAgregar: (campo: string) => void })
  ```
  - Cabecera: label de sección "Por completar" + `n/total` a la derecha
    (el `progreso` de V2-1, por fin consumido).
  - Filas: `+` siempre visible (24 px, `aria-label="Agregar ${campo}"`) + campo
    en `text-xs text-muted-foreground`. Sin caja, sin pill "Pendiente" (el
    título de la zona ya lo dice).
  - Sección oculta cuando `pendientes` está vacío.
  - Orden en el panel: después de la meta/resumen, antes de la actividad
    (ver wireframe del plan de la review).

### V2-4 · `BarraMetaContacto` → `BloqueMeta` (definition list, sin card)

- **Archivos**: nuevo `src/features/panel/BloqueMeta.tsx`; borrar
  `BarraMetaContacto.tsx`; `EncabezadoTimeline.tsx`.
- **Por qué**: card anidada en card (`rounded-2xl border bg-card p-4` dentro del
  panel), valores a 15 px que truncan la campaña a ~13 caracteres, skeleton fijo
  de 4 bloques. Patrón: Attio/Stripe — pares label/valor, no celdas con icono.
- **Cambio exacto**:
  ```tsx
  export interface CampoMeta {
    label: string;                 // 'Origen' | 'Campaña' | 'Primer contacto' | 'Asignada'
    valor: string;                 // '' → no se renderiza el par
    onClick?: () => void;
  }
  export function BloqueMeta({ campos }: { campos: CampoMeta[] })
  ```
  - `grid grid-cols-2 gap-x-4 gap-y-3` (sin card, sin borde, sin iconos);
    a <340 px: `grid-cols-1` (cambio de clase por breakpoint, no flex-wrap).
  - Label: `text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`.
  - Valor: `mt-0.5 truncate text-[13px] font-medium text-foreground`.
    A 13 px la campaña gana ~3× de caracteres visibles vs. 15 px.
  - Si `onClick`: el par completo es botón con `hover:bg-muted rounded-md px-1 -mx-1`
    y el foco global (sin ring propio — MVP-5).
  - `—` como valor vacío: se muestra solo si el campo existe pero no tiene valor
    (ej. "Asignada"); **el par no se renderiza si no hay dato**.
    `EncabezadoTimeline` deja de recibir `{ origen: '', campana: '', … }` de
    `PanelDerecho.tsx:114` para contactos sin lead: se pasa `null` y el bloque
    no se pinta (solo skeleton mientras `lead.isPending`).
  - Skeleton: 2 pares label+barra, con el ancho reflejando `campos.length`.

### V2-5 · `ResumenIa.tsx`: colapsable, neutro, solo con endpoint

- **Archivos**: nuevo `src/features/panel/ResumenIa.tsx`; `EncabezadoTimeline.tsx`;
  `PanelDerecho.tsx`.
- **Cambio exacto**:
  ```tsx
  export function ResumenIa({ texto }: { texto: string | null })
  ```
  - `texto === null` → renderiza `null` (MVP-1 sigue vigente: nada de placeholder).
  - Colapsado por defecto: fila de 28 px — `Sparkles size-14` en `text-primary` +
    "Resumen IA" 12 px/600 + `ChevronDown` rotando (`aria-expanded`, `aria-controls`,
    botón con `aria-label="Mostrar u ocultar resumen"`).
  - Expandido: `mt-2 rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground`.
  - Sin verde: el resumen es provisional, no una venta. El ámbar queda para el
    tag "IA" de los eventos.
  - Colocación: entre la meta y la zona de pendientes (dentro del header, pero
    colapsado no pesa: una fila de 28 px).
- **`PanelDerecho.tsx`**: pasa `texto={null}` hasta que exista el endpoint.

### V2-6 · `PieAccionTimeline`: un solo botón con estados

- **Archivos**: `src/features/panel/PieAccionTimeline.tsx`.
- **Por qué**: markup duplicado (líneas 17-40 son el mismo botón dos veces),
  sin estados, sin tokens (ya tocado en MVP-8).
- **Cambio exacto**:
  ```tsx
  function BotonPrimario({ label, icono, cargando, onClick }: {...})
  // h-10 w-full rounded-xl bg-primary text-sm font-bold text-primary-foreground
  // hover:bg-primary-hover transition-[background-color,transform] active:scale-[0.99]
  // disabled:opacity-50 + Loader2 animate-spin cuando cargando
  ```
  - Una sola instancia; el label/icono salen de `estado.tono`.
  - El slot del pie **no cambia de altura**: mensaje (`sin-saber`/`cargando`)
    ocupa la misma `h-10` centrada que el botón.
  - `onAccion` obligatorio: si no hay handler, no se renderiza el botón
    (regla de MVP-7.2).

**DoD de la fase**: `timeline.test.ts` cubre orden/grupos/ids; screenshot de la
galería con 8 eventos — ninguna caja coloreada en el feed; la campaña se lee
completa en la meta; recorrido de teclado con el resumen colapsable.

---

## FASE V3 — la estructura del ADR 0017 + responsive

### V3-1 · Recuperar el orden por preguntas (quién es → qué quiere → qué mandarle → detalle → qué hago)

- **Archivos**: `PanelDerecho.tsx` + recuperación desde historia git.
- **Por qué**: esta rama borró `BandaEstado.tsx`, `BloqueInteres.tsx`,
  `AccionesContacto.tsx`, `TimelineContacto.tsx`, `PanelCurso.tsx`. El ADR 0017
  ordena el panel por las preguntas que deciden la venta; un feed solo responde
  «qué pasó».
- **Cambio exacto**:
  1. Recuperar los archivos borrados: `git show <commit-anterior>:src/features/panel/… > …`
     (buscar en `git log --oneline -- src/features/panel` antes de `77997ac`).
     Referencia del mapeo: `docs/mapeo-panel-derecho.md`.
  2. Reintroducir `BandaEstado` como el bloque de identidad (la banda de 3 px +
     acento) y que el header del timeline se subordine a ella (nombre, teléfono,
     compras viven en la banda; el badge sale de `acento`, MVP-2).
  3. Reintroducir `BloqueInteres` (qué quiere) y `AccionesContacto`/`DosRespuestas`
     + `BloqueHechos` (qué mandarle) **entre** la meta y la actividad.
  4. El timeline de V2 queda como la pestaña/sección de detalle por defecto
     (junto a Ficha/Enviar/Notas/Curso si se recuperan las pestañas).
  5. **Decisión de producto pendiente (dueño)**: pestañas vs. secciones
     apiladas. Se valida con Estephano antes de implementar; no se decide en el código.
- **Verificación**: screenshot con lead nuevo + con cliente de 3 compras; las
  dos lecturas (quién es / qué mandarle) se resuelven sin scroll.

### V3-2 · Ancho del panel como token + responsive

- **Archivos**: `src/index.css`, `src/App.tsx`, componentes del panel.
- **Cambio exacto**:
  1. En `@theme`: `--panel-w: 22.5rem` y `App.tsx:566` →
     `w-[var(--panel-w)]` (hoy hardcodeado).
  2. Breakpoints (arquitectura, no parches):
     | Rango | Panel |
     |---|---|
     | ≥1440 px | `--panel-w: 25rem` (400 px) |
     | 1024–1439 px | `--panel-w: 22.5rem` |
     | 768–1023 px | `--panel-w: 20rem` (320 px) |
     | <768 px | sheet derecho: `fixed inset-y-0 right-0 w-[min(100vw-2rem,23.75rem)]`, backdrop, Esc cierra, `role="dialog" aria-modal` |
  3. Los bloques internos ya son fluidos (dl, rail, pie) — nada más que tocar.
- **Verificación**: screenshots a 1440 / 1280 / 1024 / 390 px.

### V3-3 · Persistir el estado del resumen IA

- **Archivos**: `ResumenIa.tsx`.
- **Cambio exacto**: preferencia de UI en `localStorage`
  (clave `hermes:resumen-ia-abierto`), default cerrado; un solo lugar que la lee
  y escribe (patrón de los hooks de preferencias existentes si hay uno).
- **Verificación**: abrir/cerrar, recargar, el estado se mantiene.

---

## Orden de ejecución resumido

| Orden | Tarea | Prioridad | Esfuerzo |
|---|---|---|---|
| 1 | MVP-1 placeholder IA | Alta | ~15 min |
| 2 | MVP-2 estado único | Alta | ~45 min |
| 3 | MVP-7 dead code | Alta | ~30 min |
| 4 | MVP-3 tipografía | Alta | ~30 min |
| 5 | MVP-4 a11y botones | Alta | ~45 min |
| 6 | MVP-5 foco · MVP-6 chips · MVP-8 tokens | Media | ~45 min |
| 7 | V2-1 cronología (`timeline.ts` + tests) | Alta | ~2 h |
| 8 | V2-2 dot rail | Alta | ~2 h |
| 9 | V2-4 BloqueMeta | Alta | ~1.5 h |
| 10 | V2-3 pendientes · V2-5 resumen · V2-6 pie | Media | ~2 h |
| 11 | V3-1 ADR 0017 | Alta | ~4 h + validación dueño |
| 12 | V3-2 responsive · V3-3 pref | Media | ~3 h |

## Riesgos

| Riesgo | Mitigación |
|---|---|
| V3-1 depende de una decisión del dueño (pestañas vs. secciones) | Se valida antes de tocar código; MVP y V2 no dependen de ella |
| `COLOR`/componentes borrados también los usa la galería | `rg` sobre `galeria-mensajes-completa.tsx` al tocar cada componente |
| El WIP de bot (`server/src/bot/`) convive en el árbol | Este plan no toca `server/`; si un rebase mezcla, se resuelve el conflicto solo en `src/features/panel/` |
| Recuperar archivos borrados de la historia | Verificar con `git show <commit>:<archivo>` que el commit previo a `77997ac` tenga la versión final; no copiar de ramas intermedias |
