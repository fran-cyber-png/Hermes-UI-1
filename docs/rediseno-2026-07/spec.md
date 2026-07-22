# SPEC FINAL — Rediseño Hermes: «Cierre de edición»

**Versión de implementación 1.0 · 2026-07-21 · Directorio raíz: `/Users/milaa/goberna/hermes`**

---

# 1. Dirección

## Nombre y tesis

**Cierre de edición — Hermes como redacción de diario político.** Cada vista se diagrama como una página de diario con **UN titular**: la cifra héroe en Montserrat que responde la pregunta del momento («¿cuántos esperan?», «¿cuánto compró?», «¿qué mes es?»). Todo lo demás baja a cuerpo de texto y byline. Los metadatos (horas, folios, teléfonos, totales) hablan siempre en la **voz mono de imprenta** — `font-mono tabular-nums`, nunca decoración. Los kickers se racionan como cintillos de sección: **uno por página, ganado** (de 33 a ≤6 en toda la app). El **dorado es la hora del cierre**: aparece solo donde el tiempo se está acabando de verdad (ventana de Meta, vencidos, la línea del ahora) y se retira de compuertas, conectores, orígenes y fallbacks. La jerarquía editorial hace al CRM más entendible (la página decide qué se lee primero: urgencia arriba, archivo al margen, lo pendiente en tinta plena, lo resuelto en gris) y más útil porque cada acción encadena a la siguiente: la vendedora opera como **mesa de cierre** — responder, Enter, siguiente — no como quien pasea entre pestañas. Test de utilidad injertado de la dirección «mesa»: **toda superficie debe responder «¿y ahora qué?» con la siguiente jugada calculada**; si un estado (éxito, vacío, error) no ofrece nada, está incompleto.

## Momentos firma definitivos

1. **El titular de las 9am** (Dashboard). La banda A abre con la cifra héroe: `font-heading text-2xl font-bold tabular-nums` + bajada en `text-xs text-muted-foreground` — «**14** personas esperan · la más vieja hace 6 horas» — calculada sobre la MISMA base que el filtro «Solo calientes». Sin mover el `h-16`, sin gastar oro.
2. **Los datelines del hilo** (Conversación). Separadores de día como chips centrados `font-mono text-[11px]` («hoy» / «ayer» / «lun 14 jul») que toman la tinta de la rampa `temp-*` cuando el último mensaje envejeció — el hilo cuenta su propio enfriamiento. Y ANTES del cierre de la ventana, la cuenta regresiva en dorado legítimo: «Te quedan 2 días para escribirle en privado».
3. **La manchette del Pipeline**. Contador por columna en `font-heading text-xl font-bold tabular-nums`, honesto («9 de 34» con paginación), sobre columnas-bandeja hundidas sin marco, con filete izquierdo de 2 px de temperatura en cada tarjeta — posición y enfriamiento en una sola lectura.
4. **La hora del cierre en la Agenda**. «julio» como titular Montserrat `text-2xl bold` con «2026» en `font-mono text-xs` al lado; en semana/día, regla dorada de 2 px con puntito marcando el ahora — el único oro estructural de la app: tiempo pasando literalmente por la grilla.
5. **El recibo de imprenta** (Venta). Con el bug de precedencia del folio arreglado, la confirmación muestra el folio en `font-mono text-lg` + botón «Copiar folio», el mini-embudo con Cierre creciendo +1 en verde, y una sola acción siguiente: «Agendar bienvenida». La edición cerrada, verificable y encadenada.
6. **El saludo de la mañana** (Login — injerto de P3). Banda navy con HERMES en Montserrat `text-4xl`, el escudo dorado se dibuja una vez al montar (~600 ms, respeta `prefers-reduced-motion`), último usuario precargado, «Hola de nuevo», foco directo en la contraseña. Ritual de 3 segundos, no un form.
7. **La cabina** (transversal — injerto de P1). Mantener «?» despliega el mapa de teclas en `font-mono` sobre card `shadow-panel`: ⌘1–6 vistas · «/» búsqueda · ↑↓+Enter cola · Esc cerrar. Y el modo racha: tras cada envío, «Siguiente: {nombre} · espera hace 3 h →» con Enter — **ofrece, nunca apura** (validar el tono con la vendedora real antes de fijarlo; jamás rachas, récords ni comparación con el equipo).

---

# 2. Sistema transversal

> **Corrección de auditoría (verificada en código)**: `src/lib/styles.ts` es **código muerto — cero imports en `src/`**. Los ~33 kickers y los dobles-marcos son copias inline en cada feature. Por lo tanto: (a) se repara `styles.ts` para que sea la fábrica canónica de acá en adelante, y (b) la ración real se hace con **barrido por archivo**, con grep como compuerta de cierre.

## 2.1 `src/lib/styles.ts` — la fábrica reparada

Reemplazar el archivo completo por:

```ts
/**
 * Clases compartidas entre features — la fábrica canónica.
 * Regla dura: sombra O borde, nunca ambos. cardClass lleva borde (la elección
 * institucional sobre #F5F7FB); quien necesite flotar usa shadow-panel SIN borde.
 * El kicker uppercase NO es el default: sectionLabel es sentence-case; `kicker`
 * existe aparte y se usa como máximo UNA vez por vista (cintillo ganado).
 */
export const sectionLabel = 'text-xs font-semibold text-muted-foreground';
export const kicker = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
export const fieldClass = 'rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground';
export const cardClass = 'rounded-2xl border border-border bg-card overflow-hidden';
export const cardHeaderClass = 'flex items-center justify-between border-b border-border px-5 py-3 font-heading text-sm font-bold text-navy';
```

Nuevos helpers compartidos (crear `src/lib/formato.ts` — injerto de P1):

```ts
// tempClass: contrato ÚNICO de la rampa. Tiñe SOLO tinta de marcas de tiempo
// (y el filete de 2px del kanban) — jamás fondos ni bordes en masa.
export function tempClass(fecha: string | Date): string {
  const h = (Date.now() - new Date(fecha).getTime()) / 3_600_000;
  if (h < 24) return 'text-muted-foreground';      // fresco: silencio
  if (h < 72) return 'text-muted-foreground';      // tibio: silencio (el oro de 20-24h lo maneja la ventana, no esta rampa)
  if (h < 336) return 'text-temp-frio';            // < 14 días: ladrillo
  return 'text-temp-helado';                        // 14+: acero
}
export function tempBorde(fecha: string | Date): string {
  const h = (Date.now() - new Date(fecha).getTime()) / 3_600_000;
  if (h < 24) return 'border-l-temp-fresco';
  if (h < 72) return 'border-l-temp-tibio';
  if (h < 336) return 'border-l-temp-frio';
  return 'border-l-temp-helado';
}
export function formatoTelefono(t: string): string; // '51986394450' → '51 986 394 450'
export function fechaCorta(f: string): string;      // '12 mar 2026', fallback al crudo si no parsea
```

Extraer `ETAPA_CHIP` (hoy duplicado en `VistaDashboard.tsx`) a `src/lib/etapas.ts` y consumirlo desde Dashboard, cola y kanban.

## 2.2 `src/index.css`

- **Borrar `border-radius: 4px;` del bloque `:focus-visible`** (línea ~200). El outline moderno ya sigue el radio propio del elemento. Fin del salto de forma al enfocar.
- Definir una sola vez: `--ease-house: cubic-bezier(0.32,0.72,0,1);` en `:root` y exponerla en `@theme inline` como `--ease-house` para poder escribir `ease-house` o `ease-[var(--ease-house)]`.
- Keyframe compartido de entrada: `@keyframes entrar { from { opacity: 0; transform: translateY(4px) } }` — se usa como `animate-[entrar_240ms_var(--ease-house)]`.

## 2.3 Política tipográfica — los tres registros

| Voz | Fuente | Uso | Clases |
|---|---|---|---|
| **Titular** | Montserrat (`font-heading`) | UNA cifra/palabra héroe por vista | `font-heading text-2xl font-bold tabular-nums` (variantes `text-xl`/`text-3xl` documentadas por vista) |
| **Cuerpo** | system sans | Todo lo conversacional | `text-sm` / `text-xs` |
| **Imprenta** | `font-mono` | timestamps, teléfonos, folios, totales, teclas, líneas «para sistemas:» | `font-mono text-[11px] tabular-nums` |

**Piso micro-tipográfico: `text-[11px]`. Solo dos tamaños micro (11px y `text-xs`). Nada de 9/10px.** Compuerta de cierre (injerto de P3): `grep -rEn 'text-\[(9|10)px\]' src/` debe devolver **cero** antes de reportar terminado. Hoy hay 5 ocurrencias: `App.tsx:132`, `VistaDashboard.tsx:509/523/528`, `VistaAgenda.tsx:77`.

## 2.4 Política de kickers (cintillos)

Máximo **uno por vista, ganado**. Sobreviven exactamente estos (usando el export `kicker`):
1. Dashboard → «Equipo»
2. Conversación → título de caja de `QuePuedoHacer` («Qué podés hacer con esto», voseado)
3. Panel derecho → «Comentó en» / «De dónde vino» (seccionan contenido real; cuentan como el cupo del panel)
4. Correos → «Últimos enviados»

**Todos los demás** (Login ×2, Dashboard ×4, cola, ResponderPanel ×2, HistorialPersona, RegistrarGestion ×5, PanelContexto «Contexto» y «Ficha de Cerberus», etc.) bajan a `sectionLabel` sentence-case o desaparecen. Compuerta: `grep -rn 'uppercase' src/ | wc -l` debe bajar de 33 a ≤8 (los 4-6 ganados + posibles usos no-kicker justificados).

## 2.5 Presupuesto del oro — regla de PR atómico

**El oro (`gold`/`gold-ink`) significa una sola cosa: tiempo que se acaba.** Usos legítimos que quedan/entran: chip de ventana 24h/«quedan N días», vencidos, rampa 20–24h del radar, cuenta regresiva de `QuePuedoHacer`, la línea del ahora de Agenda, badge del riel de Agenda.
**Retiros obligatorios** (deben salir en el MISMO PR que las altas, sin estado intermedio): `EstadoWhatsapp` «conectando» (→ `bg-primary`), aviso de compuerta del kanban y de BarraGestion/RegistrarGestion (→ familia `warning`), `BadgeOrigen` anuncio (→ `bg-secondary`), fallback de `estiloDeNota` en Agenda (→ `bg-secondary text-navy`), avisos de sistema caído en Personas/Correos/FichaContacto (→ `text-warning-foreground`), pill «0 esta semana» (solo si >0).
Distinción injertada de P3: **ámbar semántico (`warning` #F59E0B / `warning-foreground` #78350F) ≠ oro de marca**. Los bloqueos y degradaciones hablan en ámbar; el oro nunca.

## 2.6 Estados estándar (obligatorios en toda superficie)

- **Loading**: skeleton con la **anatomía del layout real** (`animate-pulse bg-muted`, anchos variados), nunca «Cargando…» ni spinner centrado. Un vacío jamás se evalúa con `isPending` activo.
- **Error**: rama explícita y visible, con copy que niega la calma falsa («No se pudo cargar X — no es que no haya nada.») y acción (Reintentar). Nada retorna `null` ante error.
- **Empty**: declara su porqué y ofrece la siguiente jugada. Copy directo, voseo, sin anglicismos («matchea» prohibido).
- **Hover**: color/sombra, nunca `scale` sobre texto truncado. **Active**: `active:scale-[0.98]` (o `[0.96]` en íconos). **Focus**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1` en botones; `focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25` en inputs. Ningún control interactivo puede ser un `<svg>` con onClick: siempre `<button type="button">`.
- **Errores de mutación**: toda mutación con efecto visible lleva `onError` con mensaje inline `text-[11px] text-destructive`. Nada muta en silencio.
- **Avisos**: nunca se autodestruyen por reloj mientras la vendedora los necesita (fuera los `setTimeout` de 6s/8s). Se cierran por gesto (X, click afuera, Escape) o por el próximo intento exitoso.
- **Copy técnico**: patrón «para sistemas:» (injerto P3) — la parte humana primero, la línea técnica al final en `font-mono text-[11px] text-muted-foreground` prefijada `para sistemas:`, o en popover. La vendedora nunca recibe órdenes de terminal ni nombres de tablas/vars de entorno como instrucción.

## 2.7 Motion

- Curva única: `var(--ease-house)`. Duración 200–300 ms. **Erradicar `transition-all`** y todo `duration-500`: acotar a `transition-[transform,opacity]` o `transition-[color,background-color,transform]` según el caso.
- Entradas: solo transform/opacity (`animate-[entrar_240ms_var(--ease-house)]` o `slide-in-from-top-1`/`-bottom-1` con `duration-300`). Se anima **solo lo nuevo** (filas SSE, mensajes recién llegados vía set de ids en ref), nunca listas enteras en cada render.
- `prefers-reduced-motion` ya está manejado globalmente; no agregar excepciones.

## 2.8 Teclado (contrato global)

En `App.tsx`, un `useEffect` con `keydown` en window:
- **Guarda universal**: `if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;` — antes de cualquier atajo.
- `⌘/Ctrl + 1–6` → `setVista(VISTAS[n-1].id)`. Publicado en el riel: `title={`${v.label} · ⌘${i+1}`}`.
- `Escape` → cierra la conversación abierta **solo** en vista bandeja (y solo fuera de inputs).
- `?` (mantenido o toggle) → overlay cabina con el mapa en `font-mono` sobre card `shadow-panel`.
- `/` → enfoca la búsqueda de la cola (ref levantado).
- Los `Escape` locales (BarraGestion, EtiquetasInline, popovers) hacen `e.stopPropagation()`.
- QA obligatorio: probar el mapa completo con foco en cada tipo de campo, y en **ambas cáscaras** (Tauri y Electron) — regla dura #2.

## 2.9 El puente de datos (injerto de P3)

Generalizar `telefonoPersonas` a un único estado `puente` en `App.tsx`:
```ts
type Puente =
  | { tipo: 'chat'; telefono: string }        // → Mensajes, abre chat nuevo con el número
  | { tipo: 'persona'; telefono: string }     // → Contactos, busca (hoy: telefonoPersonas)
  | { tipo: 'correo'; para: string };         // → Correos, prellena el Para
```
Cada vista consumidora lo recibe como prop inicial y lo limpia al usarlo. Sin API nueva.

## 2.10 Orden de ejecución obligado (3 fases, cada una con screenshot antes de la siguiente)

1. **Fase 1 — sistema**: `styles.ts` + `index.css` + helpers (`formato.ts`, `etapas.ts`) + **todo el presupuesto del oro** (altas y retiros juntos) + barrido de dobles-marcos y kickers + piso 11px. Compuertas: los dos greps en cero/objetivo.
2. **Fase 2 — momentos firma por vista** (orden de las secciones de abajo).
3. **Fase 3 — teclado, puente y modo racha.**

Tras cada tanda: `cd server && npm test` (271 verdes), `npx tsc --noEmit -p tsconfig.app.json` y `cd server && npx tsc --noEmit`. Verificación visual con screenshot desktop + ventana angosta por vista (regla dura #2).

---

# 3. Por vista

Cada ítem referencia el archivo y, cuando aplica, el hallazgo de la auditoría que resuelve. Severidad **[A]**=alta del audit. Orden = impacto.

## 3.1 Shell y navegación (`src/App.tsx`, `src/features/canales/BarraFrescura.tsx`, `src/features/whatsapp/EstadoWhatsapp.tsx`, `src/index.css`, `src/lib/styles.ts`)

1. **[A] `styles.ts` reparado** según §2.1 (aunque hoy nadie lo importe, es la fábrica futura; el barrido inline es Fase 1).
2. **[A] Badge de Agenda al piso** (`App.tsx:132`): `className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gold px-1 font-mono text-[11px] font-bold leading-none text-navy ring-2 ring-card"`.
3. **[A] BarraFrescura sin copy de developer** (`BarraFrescura.tsx:49`): estado «datos viejos» → chip de una línea en el header: `<AlertTriangle size={12}/> Captura detenida hace N días` con `rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground`. Al click, popover (card `shadow-panel`, sin borde): para la vendedora «Los mensajes nuevos de Facebook e Instagram no están entrando. Avisá a sistemas.» y debajo, `font-mono text-[11px] text-muted-foreground`: «para sistemas: npm run ingest:interactions (en server/)».
4. **[A] El oro se retira de «conectando»** (`EstadoWhatsapp.tsx:19`): punto → `bg-primary animate-pulse`. Línea 25 «desconectado»: punto `bg-warning`, texto `text-foreground font-semibold` (fuera `text-gold-ink`).
5. **EstadoWhatsapp nunca desaparece** (`:12`): exponer `isPending`/`isError` de `useSesionWa`. `isPending` → `<div className="h-7 w-32 animate-pulse rounded-lg bg-muted"/>`. `isError` → chip real con punto `bg-muted-foreground` y texto `font-mono text-[11px]` «sin señal del server». Jamás `return null` tras el primer render.
6. **Ban con peso** (`:21/:30`): contenedor del chip con ternario — `estado === 'baneado' ? 'border-destructive/40 bg-destructive/10' : 'border-border'`. Tooltip: `title={`WhatsApp: ${meta.texto}`}` (fuera el enum crudo).
7. **Línea de salud unificada** (injerto P1): fusionar BarraFrescura + EstadoWhatsapp en una tira a la derecha del header, `font-mono text-[11px] text-muted-foreground` — «datos hace 2 h · WA conectado» — que en verde se contrae a esa mínima expresión y **solo crece y toma color al fallar** (los chips de los puntos 3–6 son sus estados degradados). Timestamp de frescura siempre en mono (`BarraFrescura.tsx:27`).
8. **Riel legible** (`App.tsx:121`): `w-16`, botones en columna: ícono + `<span className="mt-1 text-[11px] font-medium leading-none">{v.label}</span>`. `title={`${v.label} · ⌘${i+1}`}`.
9. **Segundo badge navy sobre Mensajes**: contador de conversaciones sin responder (dato ya disponible en la query de conversaciones), mismo pill de 18 px pero `bg-navy text-white`. Dos badges, dos significados: oro = Agenda (tiempo), navy = cola (trabajo).
10. **`:focus-visible` global** (`index.css:200`): borrar `border-radius: 4px;`.
11. **Carga inicial** (`App.tsx:81`): skeleton con la anatomía del shell: `<div className="flex h-dvh bg-background"><div className="w-16 border-r border-border bg-card"/><div className="flex flex-1 flex-col"><div className="h-14 border-b border-border bg-card"/><div className="flex-1 space-y-3 p-6">{3 bloques rounded-2xl bg-card animate-pulse}</div></div></div>`.
12. **Fuera `key={vista}`** (`App.tsx:174`): la Bandeja queda **siempre montada** (`hidden` cuando `vista!=='bandeja'`); las demás vistas pueden remontar. Animación direccional por clase en `useEffect`: índice destino > origen → `slide-in-from-bottom-1`, menor → `slide-in-from-top-1` (`duration-300 ease-house`, solo transform/opacity). Red mínima obligatoria: persistir el borrador del composer por conversación fuera del componente (Map en módulo o ref en App). QA: verificar con transporte falso que TanStack no refetchea de más y el SSE no duplica listeners; soak de sesión larga (injerto P3).
13. **Teclado global** según §2.8.
14. **Higiene**: `data-tauri-drag-region` en el `<nav>` (`:106`); avatar `rounded-lg` (`:144`); header `bg-card` sólido sin `backdrop-blur` y gutter unificado con la Bandeja — elegir **header `px-3`** para alinear con `p-3` (`:162`); botones del riel `transition-[color,background-color,box-shadow,transform] active:scale-[0.96]` (`:124`).

## 3.2 Login (`src/features/auth/Login.tsx`, `src/features/auth/sesion.ts`, `server/src/cerberus/auth.ts`, `server/src/routes/auth.ts`)

1. **[A] Doble marco** (`Login.tsx:40`): `className="flex flex-col gap-4 rounded-2xl bg-card p-6 shadow-panel"` — fuera `border border-border`.
2. **Momento héroe institucional**: banda/panel superior navy `#0E2A52` (`bg-navy`) con el escudo en `text-gold-ink` y HERMES en `font-heading text-4xl font-extrabold text-white`, lema «La mesa de la vendedora» como bajada `text-xs text-navy-muted`. El form queda sobre el bg claro. Único lugar de la app con navy pleno de fondo.
3. **Firma de apertura**: el trazo del escudo SVG se dibuja al montar (`stroke-dasharray`/`stroke-dashoffset`, ~600 ms, `--ease-house`, una sola vez).
4. **Memoria diaria**: último username en `localStorage('hermes.ultimoUsuario')` (jamás la contraseña); si existe → campo precargado, `autoFocus` en contraseña, título «Hola de nuevo».
5. **Errores con próximo paso** (`Login.tsx:26` + `routes/auth.ts:24` + `cerberus/auth.ts:97/62`):
   - Front: `err.status === 401` → «Usuario o contraseña incorrectos. Revisá y volvé a intentar.»; cualquier otro → «Cerberus no responde. Esperá un minuto y probá de nuevo; si sigue, avisá a sistemas.» Nunca `err.message` crudo. `role="alert"` en el bloque.
   - Server: `routes/auth.ts` devuelve **503** con `tipo: 'cerberus_caido'` cuando Cerberus no contesta; `cerberus/auth.ts` deja de concatenar la excepción — motivo fijo humano, el detalle a `console.error`.
6. **`sesion.ts:32`**: borrar token solo ante 401 real — `.catch((err) => { if (err instanceof ErrorApi && err.status === 401) localStorage.removeItem(CLAVE); })`; ante red caída, estado «no pude conectar con el server» con botón reintentar.
7. **Foco unificado**: inputs `focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25` (manteniendo `outline-none`); botón `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2`.
8. **Botón**: `transition-[background-color,transform] duration-200 ease-house`; ícono `duration-200`; `aria-busy={enviando}` + `aria-busy:opacity-90 aria-busy:cursor-wait` (el `opacity-40` queda solo para campos vacíos).
9. **Sustracción**: labels a `sectionLabel` sentence-case («Usuario», «Contraseña») — −2 kickers; una sola mención de Cerberus (placeholder neutro «tu usuario», la nota al pie explica); detector de CapsLock: `getModifierState('CapsLock')` → renglón `font-mono text-[11px] text-muted-foreground` «Mayúsculas activadas» bajo la contraseña.

## 3.3 Dashboard radar (`src/features/dashboard/VistaDashboard.tsx`)

1. **[A] El titular de las 9am** (`:236/:173`): en la banda A, `<span className="font-heading text-2xl font-bold tabular-nums text-foreground">{nCalientes}</span>` + `<span className="text-xs text-muted-foreground">personas esperan · la más vieja hace {X}</span>` (dato de `atender` ya calculado). **`nCalientes` se calcula sobre la MISMA unión chats+formularios que usa el filtro** (`[...chats, ...forms].filter(x => relevanciaDe(...) === 'alta').length`) — el número siempre cuadra con las filas. El punto dorado se queda. Es el ÚNICO titular de la vista.
2. **[A] Riel honesto en la carga** (`:422/:465/:504`): en cada card del riel, `isPending ? <skeleton> : total === 0 ? <vacío> : <dato>`. Skeletons con forma: barra `h-2 rounded-full animate-pulse bg-muted` (embudo), 5 líneas de anchos desiguales (cursos), 3 filas `h-6` (equipo). Jamás los tres empty-states durante la carga.
3. **[A] Teclado y botones reales en el radar** (`:347/:389`): filas con `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } }}`; acciones visibles-atenuadas — quitar `opacity-0`, usar `text-muted-foreground group-hover:text-navy focus-within:text-navy` (o mínimo `opacity-40 group-hover:opacity-100 focus-within:opacity-100`); Llamar y Buscar envueltos en `<button type="button">` reales.
4. **[A] Gradiente de enfriamiento** (`:386`): teñir el `hace()` de cada fila con `tempClass(base.cayo_at)` (§2.1) — frío ladrillo, helado acero, muted para fresco/tibio, **gold-ink intacto en la ventanita 20–24h**. Todos los `hace()`/timestamps del radar en `font-mono text-[11px] tabular-nums`.
5. **Ración de kickers 5→1** (`:257/:419/:463/:489/:509`): eliminar el h2 «El radar» (el punto vivo + contador identifican la zona; `aria-label="El radar"` en la section); «Embudo · 38» → «38 en el embudo» en `text-xs font-medium` normal-case; «Qué piden» → `sectionLabel`; **solo «Equipo» conserva `kicker`**; header de columnas del Equipo a `text-[11px]`.
6. **Piso 11px** (`:509/:523/:528`): iniciales del avatar a `text-[11px]` (avatar `size-7` si aprieta); badge «vos» → `ring-2 ring-navy` en el avatar propio.
7. **Filas sin teléfono** (flujos `:351`): quitar `cursor-pointer`, hover y `role="button"`; mostrar el correo con acción «Copiar correo» (y «Mandar correo» vía puente cuando Correos esté conectado).
8. **Copys de página**: vacío de landings → «Las landings todavía no llegan a Hermes — falta que Sistemas conecte Bravo. No es que no caigan.» (runbook §9 a comentario de código) (`:317`); pills vencidas con `hace()` → «· hace 10 días» (`:222`); leyenda del embudo palabra completa, fuera `slice(0,3)` (`:453`); corte declarado: cuando post-filtros > 80, línea final «Mostrando los 80 más recientes de {total} — afiná los filtros para ver el resto.» `text-[11px] text-muted-foreground py-3 text-center` (`:165`).
9. **Jerarquía física**: riel a `rounded-xl p-3.5`; `rounded-2xl` solo banda A y radar (`:416`).
10. **El radar que se siente radar**: fila nueva del SSE entra con `translate-y-1 opacity-0 → 0/1` (200 ms, `ease-house`) + `bg-secondary` que decae ~2 s (solo las nuevas, set de ids en ref).
11. **Micro**: skeleton del radar = 8–10 filas con anatomía real (2 líneas, `border-b border-border/70`, anchos 2/5·3/5·1/3 variados) (`:310`); CTA `transition-[transform,background-color] duration-200 ease-house` (`:243`); pills de agenda `active:scale-[0.98]` (`:216`); `EtiquetaInline` guarda en blur si hay texto — Escape queda como único descarte (`:98`).

## 3.4 Pipeline kanban (`src/features/vistas/VistaEmbudo.tsx`)

1. **[A] Profundidad de un solo nivel** (`:176/:49`): columna = bandeja hundida `rounded-2xl bg-secondary/50 p-2 transition-colors` (SIN `shadow-panel` ni `border`); destino de drop → `bg-secondary ring-1 ring-primary/40`. Tarjeta = única placa: `bg-card shadow-[0_1px_2px_rgba(14,42,82,0.06)] hover:shadow-panel` (SIN `border border-border`).
2. **[A] Cierre deja de ser drop condenado** (`:162`): en `soltar()`, si `etapa === 'cierre'` → **no** `mover.mutate`; abrir el flujo de Registrar venta con la conversación precargada (señal a `onAbrir` + estado). Durante el arrastre, el header de Cierre muestra «Soltá para registrar la venta» con peso, en vez del highlight azul genérico. Cierre con acento: h3 `text-navy`, tick verde cuando >0.
3. **[A] Manchette honesta** (`:183` + flujos `:74`): contador por columna en `font-heading text-xl font-bold tabular-nums text-foreground` (muted en Perdidos), título en 13 px al lado. Con `hayMas`: mostrar **«{enEtapa.length} de {totalServer}»** usando la MISMA query de embudo que alimenta `data.embudo` del Dashboard (query local `['embudo','totales']`, sin API nueva) — y verificar ANTES de mostrar ambos números que las dos fuentes cuentan etapa con la misma definición (riesgo P3); si difieren, corregir la definición, no esconder el número. El «Traer más» de columna dice «hay {n} más». Fallback mínimo si el total no está: `{n}+` con `aria-label="al menos {n}"`.
4. **[A] Aviso de compuerta en voz de bloqueo** (`:147/:106`): `rounded-lg border border-border bg-secondary/70 px-3 py-2 text-xs text-foreground` con `AlertTriangle` en `text-temp-frio`. **Sin `setTimeout`**: se limpia al próximo arrastre o con X. `aria-live="polite"`. Ring `ring-1 ring-temp-frio` de ~1.5 s en la tarjeta rebotada + copy «— agregalo en la tarjeta, acá abajo» (el Intereses inline ya vive ahí).
5. **Mapa térmico**: filete izquierdo `border-l-2` + `tempBorde(edad)` en cada tarjeta; `hace()` teñido con `tempClass` (`:56`).
6. **Perdidos como cajón** (`:159`): `grid-cols-[1fr_1fr_1fr_1fr_0.75fr]`; sección Perdidos `bg-transparent border border-dashed border-border` con header muted.
7. **Física del arrastre** (`:45/:84/:187`): `onDragEnd` limpia `arrastrada`/`sobre`; tarjeta arrastrada `opacity-40 scale-[0.98]`; placeholder punteado «Soltá acá» (`rounded-xl border border-dashed border-primary/60 p-3 text-center text-[11px] text-primary`) también al final de columnas CON tarjetas cuando `esDestino`; actualización optimista en `onMutate` (`setQueryData` moviendo la clave) con rollback en `onError` — la compuerta rechaza y la tarjeta vuelve sola.
8. **Micro**: skeleton con la grilla real (5 secciones × 2–3 bloques `h-16 animate-pulse rounded-xl bg-secondary/60` + barra de header) (`:157`); `grid min-h-0 flex-1 grid-cols-[repeat(4,minmax(190px,1fr))_minmax(150px,0.75fr)] gap-2.5 overflow-x-auto` (`:159`); «Abrir en la Bandeja» con `focus-visible:opacity-100` (`:61`); `active:scale-[0.98]` en botones (`:139`); la instrucción permanente de la barra solo se renderiza con `arrastrada != null` (`:131`); el letrero «Vacía» muere — el punteado queda solo en `esDestino` (`:195`).

## 3.5 Mensajes — cola unificada (`src/features/canales/ColaUnificada.tsx`, `FilaConversacion.tsx`; archivo de `Bandeja.tsx`/`FilaInteraccion.tsx`/`useBandeja.ts`)

1. **[A] Vacío honesto** (`ColaUnificada.tsx:176`): portar el patrón de Bandeja — `const { data: frescura } = useFrescura(); const vacioPorAtraso = frescura != null && !frescura.fresca && frescura.total > 0;` y renderizar el copy de `Bandeja.tsx:95-102` («No hay nada acá, pero no es porque estés al día. La última captura fue hace N…») ANTES de caer en `filtro.vacio`.
2. **[A] Fin del dead-end de búsqueda** (`:177`): sacar el bloque `{hayMas && …}` del ternario para que se renderice también bajo el vacío; ahí el botón se vuelve «Buscar en más historia» (`w-full rounded-lg border border-border py-2 text-xs font-bold`, llama `cargarMas`). Copy sin anglicismo: «Ninguna conversación cargada coincide con "{busqueda}".»
3. **Fila de 2 renglones** (`FilaConversacion.tsx:78`): eliminar los textos «Mensaje»/«Comentario»; `c.n > 1 && !c.respondida` → burbuja a la derecha `rounded-full bg-primary px-1.5 py-px text-[11px] font-bold tabular-nums text-primary-foreground`; el check «respondida» junto al timestamp.
4. **Peso invertido** (`:92`): preview de `!c.respondida` → `text-foreground` (con `font-medium` solo si además `pide_info`); nombre de `c.respondida` → `font-medium text-muted-foreground`. El tinte `bg-success/5` queda.
5. **Columna derecha de dos líneas** (`:68/:74`): `flex flex-col items-end gap-0.5` — chip dorado de ventana arriba, `<span className="font-mono text-[11px] tabular-nums text-muted-foreground">{hace(horas)}</span>` debajo. Copy unificado: «quedan 5 días». `VENTANA_DIAS` importada de `./types` (fuera la const local, `:7`).
6. **Cierre de edición despachada**: «Les puedo escribir» en cero CON frescura viva → «Respondiste a {n} personas hoy» en `font-heading text-3xl font-bold text-navy` sobre el «Estás al día», + la siguiente jugada: si hay pendientes en pide-info, botón «Ver los {n} que piden info →» (`setIntencion('pide-info')`); si no, «Revisá tu Agenda» con el conteo. (Cifra héroe única de esta vista — la banda de racha no compite acá.)
7. **Header fusionado** (`:87/:149`): un solo `<div className="shrink-0 border-b border-border px-3 pb-2 pt-3">` con búsqueda (`mb-2`) y fila filtros+total; total humano en voz instrumento: «{total.toLocaleString('es')} en cola», `pr-1 font-mono text-[11px] tabular-nums text-muted-foreground` (`:166`).
8. **Kicker «Pide info» → chip** (`:80`): `rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary`, oculto cuando el filtro activo ya es pide-info (prop `mostrarPideInfo`, pasada como `intencion !== 'pide-info'`).
9. **Teclado de despacho** (`:91`): «/» global enfoca la búsqueda (ref); Escape en el input limpia (`onKeyDown` + `stopPropagation`); ↑↓+Enter recorren la cola con roving tabindex.
10. **Seleccionada con filo** (`FilaConversacion.tsx:48`): `bg-secondary shadow-[inset_-3px_0_0_var(--color-primary)]` + `active:bg-muted`.
11. **Canon de banda izquierda**: la banda de 3 px = **temperatura** en todas las listas (ya lo es acá); sumar chip de etapa vía `ETAPA_CHIP` compartido (§2.1).
12. **Fila pin de orientación** (flujos `App.tsx:89`): cuando `seleccionada` no aparece en `visibles`, fila fijada arriba con `border-l-[3px] border-l-navy`: «Abierta desde {origen} — no coincide con «{filtro.label}»» + acción «Ver en Todo» (`setIntencion('')`).
13. **Micro**: skeleton de 6 filas con anatomía real (avatar `size-9 rounded-full` + 2 barras) (`:174`); fila nueva del SSE con `slide-in-from-top-1 duration-300 ease-house` solo la nueva; teléfono-como-nombre en `font-mono font-medium tabular-nums` con `formatoTelefono` (`:37`); `transition-all` acotadas (`:89/:108`).
14. **Archivo**: una vez migrado el vacío honesto (punto 1), archivar `Bandeja.tsx` + `FilaInteraccion.tsx` + `useBandeja.ts` con **ADR corto en `docs/adr/`** (regla dura #3, mismo tratamiento que PanelWhatsapp).

## 3.6 Mensajes — conversación (`src/features/whatsapp/HiloWhatsapp.tsx`, `src/features/canales/HiloMessenger.tsx`, `ResponderPanel.tsx`, `QuePuedoHacer.tsx`, `HistorialPersona.tsx`)

1. **[A] Datelines** (`HiloWhatsapp.tsx:165`): agrupar mensajes por fecha antes del map; separador `mx-auto w-fit rounded-full bg-muted px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground` con «hoy»/«ayer»/«lun 14 jul». Cuando el último mensaje de la persona tiene >1 día, ese separador toma la tinta de la rampa (`tempClass`) — tibio dorado (`text-gold-ink` para 1–3 días es el único caso donde el separador usa oro: la ventana yéndose), frío ladrillo. Mismo patrón en HiloMessenger.
2. **[A] Doble marco de burbujas** (`HiloWhatsapp.tsx:151`, `HiloMessenger.tsx:75-78`): entrante = `bg-card ring-1 ring-border` **sin sombra**; la sombra `shadow-[0_1px_2px_rgba(14,42,82,0.06)]` pasa solo a la saliente (`rounded-br-md bg-secondary text-navy`).
3. **[A] Oro fuera del origen** (`HiloWhatsapp.tsx:281`): `BadgeOrigen` anuncio → `bg-secondary text-secondary-foreground` (idéntico a landing, `:291`); si anuncio necesita distinguirse, el `Megaphone` en `text-navy`.
4. **Cuenta regresiva viva** (`QuePuedoHacer.tsx`): con `cap.dias` a 1–2 días del cierre de la ventana de 7, línea en `text-gold-ink`: «Te quedan {n} días para poder escribirle en privado» — el oro ANTES de que sea tarde. El aviso de ventana ya cerrada (`:120`): ícono Clock y párrafo a `text-gold-ink` (legítimo: tiempo que se acabó). Frase con unidad: «Este comentario ya tiene {cap.dias} días.» (`:49`).
5. **Una sola cabecera para los tres canales** (`HiloWhatsapp.tsx:121`, `HiloMessenger.tsx:52/56`, `ResponderPanel.tsx:119`): nombre `font-heading text-sm font-bold`, avatar `rounded-[11px]`, `px-4 py-3` en las tres.
6. **La cita editorial** (`ResponderPanel.tsx:140`): el comentario de la persona en `font-heading text-lg` con comilla de apertura grande en navy y filete izquierdo del color del canal — «esto dijo, así respondo».
7. **Mesa de despacho**: tras enviar, la tarjeta «Respondido» suma «Siguiente de la cola →» (Enter salta) — alimenta el modo racha (§3.11).
8. **Composer con foco** (`HiloWhatsapp.tsx:231`): `useEffect` → `textareaRef.current?.focus()` al cambiar `telefono` (solo si `conectado`).
9. **Foco parejo**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1` en enviar (`:255`), adjuntar (`:227`), quitar adjunto (`:203`) y X de ResponderPanel (`:133`); textareas de ResponderPanel con `outline-none focus:border-primary` (`:193/:211`).
10. **Animación con criterio** (`HiloWhatsapp.tsx:145`): entrada solo para mensajes nuevos (set de ids vistos en un ref), `duration-300 ease-house`; como mínimo solo los últimos 3 con stagger `style={{animationDelay: i*40+'ms'}}`. Send de WhatsApp: `transition-transform duration-200` (fuera `transition-all duration-500`, `:255`). Botón de ResponderPanel (`:237`): `transition-transform duration-200 ease-house active:scale-[0.98]`.
11. **Escape no destructivo** (flujos `ResponderPanel.tsx:58` **[A de flujos]**): en el listener, `if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;` antes de `onCerrar()`. En BarraGestion/EtiquetasInline, `e.stopPropagation()` en sus handlers de Escape.
12. **Copys**: plural humano en ResponderPanel (`:130`): 0→«hoy», 1→«ayer», resto «hace {n} días»; fallback por canal (`:127`): `persona_nombre ?? (canal === 'instagram' ? 'Alguien en Instagram' : 'Usuario de Facebook')`; voseo unificado («Qué podés hacer con esto», «Mandale un mensaje privado», «Podés borrarlo después»); «…» tipográfico en las 4 apariciones de `...`; plantilla pública humana: «Hola — con gusto. Escribinos por mensaje privado y te mandamos el programa completo con fechas y precios.» (`:22`); kickers 4→1 (solo `QuePuedoHacer:88`, voseado; labels de textareas e historial a `sectionLabel`).
13. **Estados con forma**: skeleton de burbujas fantasma alternadas (`h-10 rounded-2xl rounded-bl-md bg-muted animate-pulse`, anchos w-40/w-56/w-64) en ambos hilos (`HiloWhatsapp:139`, `HiloMessenger:65`); aviso «se ve desde que se vinculó» baja a texto suelto `text-center text-[11px] text-muted-foreground` y solo con <5 mensajes (`:135`); vacío de Messenger con porqué + link a Business Suite (`HiloMessenger:67`); HistorialPersona (`:31`): skeleton `mt-5 h-20 animate-pulse rounded-xl bg-muted/50` + `.catch()` visible «No pudimos cargar su historial — puede que ya te haya escrito antes.»

## 3.7 Gestión y panel derecho (`BarraGestion.tsx`, `RegistrarGestion.tsx`, `Intereses.tsx`, `BotonLlamar.tsx`, `FichaContacto.tsx`, `PanelContexto.tsx`, `FormularioVenta.tsx`, `BadgeCanal.tsx`)

1. **[A] Bug de precedencia del folio** (`FormularioVenta.tsx:113`): `setSaved((saveMode === 'venta' ? 'Venta registrada en Cerberus.' : 'Cotización registrada en Cerberus.') + (r.folio ? ` (${r.folio})` : ''))`. Y el **recibo de imprenta**: pantalla de éxito con folio en `font-mono text-lg` + botón «Copiar folio» (`navigator.clipboard`), mini-embudo con el segmento Cierre +1 en verde (reusar la mini-barra del riel del Dashboard), y única acción siguiente «Agendar bienvenida al curso» (cae en la Agenda vía puente).
2. **[A] Una sola primaria** (`RegistrarGestion.tsx:130` + `FichaContacto.tsx:157`): «Registrar venta» queda como única navy; «Registrar gestión» → `border border-border bg-card text-navy hover:bg-muted` (mismo ícono y tamaño).
3. **[A] Oro fuera de la compuerta** (`BarraGestion.tsx:240`, `RegistrarGestion.tsx:193`): error de compuerta → `rounded-lg bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground`. **Sin autodestrucción a los 8 s** (`BarraGestion:194`): se limpia en `onSuccess` o con X. **La compuerta guía**: además del mensaje, `ring-2 ring-primary` temporal (~2 s) al control de Intereses de la misma barra + foco en su buscador.
4. **Especializar los dos mandos** (`FichaContacto.tsx:147` — flujos): RegistrarGestion pierde el selector de etapa y los intereses (quedan solo en BarraGestion) y se renombra «Notas y próxima acción»; la etapa visible como texto lector. Guardar deshabilitado hasta que haya algo: `disabled={!etapa && !accion && !notas.trim()}` y fuera el `?? 'contactado'` (`RegistrarGestion:84`). Sufijo de Agenda leyendo la mutación: `{crear.variables?.proximaAccion ? ' — la próxima acción está en tu Agenda' : ''}` (`:119`).
5. **Cifra héroe de la ficha** (`FichaContacto.tsx:108`): al resolver cliente, abrir con `<div className="font-heading text-2xl font-bold tabular-nums text-navy">{moneda} {total}</div><div className="text-[11px] text-muted-foreground">en {n} compras</div>`; folios a detalle con fecha `font-mono text-[11px] tabular-nums` corta (`fechaCorta`) y estado semántico (`text-success` pagado / `text-destructive` anulado / muted resto) (`:126`).
6. **Nada muta en silencio**: `onError` inline `text-[11px] text-destructive` en etiquetas («No se guardó la etiqueta — probá de nuevo.», `BarraGestion:43`), intereses («No se guardó el interés — sin esto, Cotizado no abre.», `Intereses:40`) y conversión («No se registró la conversión — probá de nuevo.», `FichaContacto:170`).
7. **Intereses con teclado honesto** (`Intereses.tsx:97`): con `sugerencias.data?.length`, Enter agrega la primera (o la resaltada con ↑↓ vía índice activo); texto libre solo sin resultados.
8. **BotonLlamar** (`:40/:24/:55`): modo compacto como `<button type="button" aria-label="Llamar" onClick={llamar} className="rounded p-1 text-success hover:bg-success/10">`; popover sin timeout de 6 s (cierre por overlay transparente `fixed inset-0` + Escape); un solo marco: `shadow-panel` sin `ring-1 ring-border`.
9. **Popover Agendar** (`BarraGestion.tsx:134/:135/:151`): `rounded-xl bg-card p-2.5 shadow-panel` (fuera el border); Escape en el input y overlay de click-afuera cierran; spinner solo en el chip clickeado (`{pendiente === o.etiqueta ? <Loader2/> : o.etiqueta}`); éxito confirmando el dato: «Agendado · Mañana 9:00» en `bg-success/10`.
10. **Perdido fuera del segmented** (`:208`): separador `ml-1 border-l border-border pl-1`, chip `text-muted-foreground hover:text-destructive`, primer clic → confirmación inline «¿Perdido? Sí / No» antes de mutar.
11. **Modal de venta con oficio** (`FormularioVenta.tsx:120/:62/:233/:288/:216`): `useEffect` keydown Escape → `onCerrar` (respetando inputs) + `role="dialog" aria-modal="true"` + foco inicial en el primer select; país precargado matcheando `data.pais` de la ficha, moneda desde `localStorage('hermes.ultimaMoneda')` (persistir en `onSuccess`), copy «precargado de la ficha — cambialo si hace falta»; monto total `<span className="font-heading text-2xl font-bold tabular-nums text-navy">{moneda} {monto.toFixed(2)}</span>`; «Elegí moneda»/«Elegí país» (fuera el usted); +/− a `size-6 rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground active:scale-95`.
12. **Ración de kickers 14→2** (`RegistrarGestion:136`, `PanelContexto:54/:116`): fuera «Contexto» (el avatar-header ES el título); «Ficha de Cerberus» y los 5 labels de RegistrarGestion a `sectionLabel`; el kicker «Etapa» muere (el chip ya lo dice); quedan «Comentó en» / «De dónde vino».
13. **Micro**: X de etiquetas/intereses `focus-visible:opacity-100` + `opacity-40` base en touch (`BarraGestion:64`, `Intereses:72`); Cerberus-caído `text-warning-foreground` (`FichaContacto:85`); skeleton de la ficha con forma (pill 60px + barra ancha + fila de 3 barras + 2 rectángulos `rounded-lg`) (`:81`); `duration-200` en Registrar venta (`:157`); `capitalize` fuera — labels mapeados, «Sin gestión» literal (`RegistrarGestion:111`); BadgeCanal: bajo 18 px de disco, sin inicial; con ≥18, `fontSize: Math.max(9, size*0.5)` (`BadgeCanal:22`); jerga `tb_contacto_canal` reescrita: «La ficha por teléfono aplica a WhatsApp. Para este canal, la ficha cruzada está en camino.» (`FichaContacto:74`).
14. **Lead nuevo con salida** (flujos `FichaContacto:166` **[A]**): bajo «Marcar como interesado», link honesto `<a href={`${CERBERUS}/clientes/nuevo/`} target="_blank">Crear cliente en Cerberus →</a>` con copy «al volver, refrescá la ficha» — mientras no exista el alta proxy.

## 3.8 Contactos (`src/features/vistas/VistaPersonas.tsx`)

1. **[A] Fin del dead-end** (`:107` + flujos): fila de acciones bajo el header de la ficha (cliente Y nuevo): **«Escribirle»** primario (levanta `puente {tipo:'chat'}` a App, reusa la fábrica de chat nuevo de ColaUnificada) + `BotonLlamar` + «Registrar venta» si `estado==='cliente'` (reusa FormularioVenta con `canal='whatsapp'`).
2. **[A] Vacío inicial con propósito** (`:86`): reemplazar el `null` por: ícono Search `text-muted-foreground/40` + «¿Te dictaron un número o llegó por Messenger sin teléfono? Pegalo arriba: te digo si ya es cliente de la Escuela.» (`text-sm text-muted-foreground`) + la aclaración del límite por teléfono movida acá. **Spotlight**: sin búsqueda activa, barra centrada verticalmente y generosa (input `text-base`); al buscar se acopla arriba con transform 250 ms `ease-house`.
3. **[A] Doble marco ×3** (`:87/:101/:108`): quitar `border border-border` de skeleton, «nuevo» y ficha — queda `bg-card shadow-panel`.
4. **[A] Lead nuevo con continuidad** (`:100`): «{telefono} no figura en Cerberus. Es un lead nuevo.» + «Cuando le registres una venta, la ficha va a aparecer sola acá.» + las acciones del punto 1 («Escribirle» resuelve el «¿y ahora qué?»).
5. **Ficha con titular** (`:114`): nombre `font-heading text-2xl font-bold`; cifra héroe «2 compras · USD 1.250» en `font-heading text-xl tabular-nums text-navy`.
6. **Datos humanos** (`:150/:149`): fecha con `toLocaleDateString('es', {day:'numeric', month:'short', year:'numeric'})` y fallback al crudo si `Number.isNaN(Date.parse(...))`; estado `font-medium text-foreground` con color semántico si el set es conocido.
7. **Micro**: skeleton con la forma de la ficha (pill `h-5 w-16 rounded-full` + `h-6 w-48` + `h-3 w-2/3` + 2 bloques `h-12 rounded-xl` en `grid sm:grid-cols-2`) (`:87`); entrada del resultado `animate-[entrar_240ms_var(--ease-house)]` (`:85`); aviso de sistema caído `text-warning-foreground` (`:93`); hint al submit inválido «Faltan dígitos — incluí el código de país (51 …)» `text-[11px] text-muted-foreground` (`:50`); copy sin «matchea»: «Busca solo por teléfono. El nombre o el usuario de Instagram llegan con la identidad entre canales.» (`:81`); `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary` en Buscar y «Ver en Cerberus» (`:74/:126`); fuera el `mt-4` vestigial (`:59`); chips de búsquedas recientes en `font-mono` bajo la barra (últimos 3 teléfonos, estado local).

## 3.9 Correos (`src/features/correos/VistaCorreos.tsx`)

1. **[A] Falso vacío** (`:144`): ramificar primero — `enviados.isPending` → 3 filas skeleton con la forma de la lista (dot `size-1.5` + barras `w-24`/`w-48`/`flex-1` `animate-pulse bg-muted`); `enviados.isError` → «No se pudo cargar la lista — no es que no haya correos.»; recién después el vacío real.
2. **[A] El fallido a la vista** (`:156`): para `estado === 'fallido'`, chip visible en la fila: `<span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">falló · {c.motivo}</span>`; el dot queda para los enviados.
3. **Estado del canal honesto** (`:75/:76/:78`): rama previa `estado.isError` → «No se pudo consultar el estado del canal de correo — reintentá en un momento.»; el aviso SMTP solo con `estado.data?.conectado === false`. Audiencia ordenada: primero «El canal de correo todavía no está conectado. Es un paso de sistemas — dos minutos — y esta pantalla se enciende sola cuando esté.»; al final `font-mono text-[11px] text-muted-foreground`: «para sistemas: SMTP_HOST · SMTP_USER · SMTP_PASS en el .env»; `<b>` → `<span className="font-semibold">`; tinta `text-warning-foreground` (no gold-ink).
4. **Jerarquía** (`:69`): h1 «Nuevo correo» a `font-heading text-lg font-bold`; «Últimos enviados» conserva su `kicker` (cupo de la vista); fechas relativas humanas («hace 2 h») agrupadas por día.
5. **⌘↵ envía** (`:101`): `onKeyDown` en el textarea — `(e.metaKey || e.ctrlKey) && e.key === 'Enter'` → `enviar.mutate()` con las guardas del disabled; microcopy «⌘↵ para enviar» (`:131`).
6. **Puente desde la ficha**: aceptar `correoInicial` como prop (patrón §2.9) para llegar con el Para lleno; FichaContacto renderiza `data.correo` en la fila mono con acción «Mandar correo».
7. **El encendido visible**: cuando `conectado` pasa a true, «desde mail.goberna.us» entra con una única transición opacity/translate.
8. **Micro**: `aria-label` en Para/Asunto/Cuerpo + `focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]` (`:88`); botón Enviar `transition-all duration-200 ease-house` → mejor `transition-[background-color,transform]` (`:126`); lista con `basis-48 shrink min-w-0 truncate` en el correo y vendedora `hidden sm:block` (`:158`); `focus-visible` en Enviar.

## 3.10 Agenda (`src/features/agenda/VistaAgenda.tsx`)

1. **[A] Oro fuera del fallback** (`:44`): `estiloDeNota` fallback → `return 'bg-secondary text-navy'`.
2. **[A] Doble marco de popovers** (`:100/:198`): quitar `border border-border` en Detalle y Crear; queda la sombra en capas (subir la primera capa a `0 1px 3px rgba(14,42,82,0.10)` si falta definición).
3. **[A] Estado de error** (`:355`): rama `agenda.isError` antes del render: «No se pudo cargar tu agenda.» + botón Reintentar (`agenda.refetch()`, `rounded-lg border border-border px-3 py-1.5 text-xs font-semibold`). Loading → skeleton con la grilla real (cabecera 7 columnas + 6 filas `animate-pulse bg-muted/40` en `grid-cols-7`).
4. **[A] Vencidos accionables** (`:318`): el span → botón `onClick={() => { setFoco(new Date()); setModo('dia'); }}` con `hover:bg-destructive/20 transition-colors`; copy «3 promesas vencidas».
5. **[A] Hora del chip al piso** (`:77`): `font-mono text-[11px] tabular-nums opacity-80` (compensar con `px-1` si aprieta).
6. **El mes como titular** (`:314`): `<h2 className="font-heading text-2xl font-bold capitalize tracking-tight text-foreground">julio <span className="ml-1 align-baseline font-mono text-xs font-normal text-muted-foreground">2026</span></h2>` (mes y año separados en el render); `text-xl` en modo día.
7. **La línea del ahora**: en semana y día, regla horizontal `h-[2px] bg-gold` con puntito a la izquierda en la posición de la hora actual (recalculada por minuto con un interval); en el mes, el anillo de hoy suma subrayado dorado fino solo si hay pendientes hoy.
8. **HTML sano** (`:376`): la celda del día → `<div role="gridcell" onClick={…} className="cursor-pointer …">`; los Chips quedan como únicos `<button>`; «+N más» → `<button type="button">`.
9. **Dato nunca descartado** (`:184` — también [A] de flujos): si `telefono.trim()` y `!conTel` (incompleto o WA desconectado), aviso bajo el input `text-[11px] text-destructive` con el motivo real («WhatsApp está desconectado: se guarda sin atar al chat» / «número incompleto») y **segundo clic para confirmar** sin atar.
10. **Crear en dos toques** (`:179/:474`): fila de chips de `opcionesRapidas()` arriba del datetime (`rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold hover:border-primary`; activo `bg-navy text-white`); línea viva `font-mono text-[11px]` que traduce lo elegido («mañana jueves 23, 9:00»); envolver en `<form onSubmit>` (Enter agenda); Escape cierra (keydown global del panel); Detalle y Crear mutuamente excluyentes (`setCrearEn` limpia `detalle` y viceversa).
11. **Borrar con red** (`:155`): primer clic → botón «¿Borrar?» `bg-destructive text-white text-[11px] font-bold` que revierte solo a los 3 s; segundo clic borra.
12. **Pill «esta semana»** (`:322`): solo si `estaSemana.length > 0` y excluyendo vencidos (`d >= inicioHoy`); en cero, nada.
13. **FilaDia propia** (`:465`): `<button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary/30">` con hora `w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground` + barrita `h-8 w-1 rounded-full` (color de `estiloDeNota`) + nota `text-sm font-semibold truncate` + persona `text-[11px] text-muted-foreground truncate` («sin conversación atada» si no hay).
14. **Densidad a un metro**: bajo el número de cada día del mes, 1–3 puntitos de 3 px con el color del tipo dominante.
15. **Micro**: hover del chip por color — `transition-colors hover:brightness-95` (fuera `hover:scale-[1.02]`, `:73`); vacío total con guía encajada entre cabecera y grilla: «Todavía no agendaste nada. Clic en cualquier día para tu primer seguimiento — nada se envía solo.» (`border-b border-border bg-secondary/30 px-4 py-2 text-center text-xs text-muted-foreground`) (`:360`).

## 3.11 Flujos transversales y teclado

1. **[A] Teclado global** (`App.tsx:66`): implementar §2.8 completo. Overlay «?» cabina.
2. **[A] Fix del Escape destructor** (`ResponderPanel.tsx:58`): ver §3.6.11 — guarda `closest('input, textarea, select')` + `stopPropagation` en handlers locales.
3. **[A] Ficha de Personas actúa / lead nuevo con camino** — resueltos en §3.8.1 y §3.7.14.
4. **[A] Conteos que cuadran** (kanban vs Dashboard) — resuelto en §3.4.3, con la verificación de paridad de definiciones ANTES de mostrar «N de M».
5. **El puente** (§2.9): implementar `puente` en App; consumidores: VistaPersonas («Escribirle» → chat), FichaContacto («Mandar correo» → Correos), radar (leads de landing → Personas, ya existe), recibo de venta («Agendar bienvenida» → Agenda con teléfono atado).
6. **Modo racha**: al enviar respuesta o marcar hecho en la Bandeja, banda superior «Siguiente: {nombre} · espera hace 3 h →» (Enter abre), reusando el cálculo de `atender` del Dashboard; el contador de calientes baja en vivo. **Tono: ofrece, nunca apura** — sin rachas, récords ni comparación; validar el copy con la vendedora real antes de fijarlo. Si el tono no valida, la banda se degrada a solo el botón «Siguiente» sin contador.
7. **Canon visual entre listas**: banda izquierda = temperatura en TODAS (cola ya; radar marca relevancia con su punto dorado, no con la banda); `ETAPA_CHIP` compartido en cola + radar + kanban.
8. **Clics muertos**: toda fila con `onClick` responde a Enter; leads sin teléfono pierden affordance de clic y ganan acción real (§3.3.7).

---

# 4. Qué NO tocar

- **Tokens de marca**: la paleta completa de `index.css` (navy/blue/gold/gold-ink/bg/card/border/ink/muted, familia warning, rampa temp-*) no se modifica — solo se agregan `--ease-house` y el keyframe `entrar`. Montserrat sigue siendo la única display.
- **API y server**, salvo los DOS cambios acotados del Login (§3.2.5: motivo humano en `cerberus/auth.ts`, status 503 tipado en `routes/auth.ts`). Nada más del server. Cero endpoints nuevos: el total del kanban usa la query de embudo existente; el «tipo de último mensaje» en el preview de la cola queda FUERA de este spec (requiere API).
- **La costura de WhatsApp**: `TransporteWhatsapp`, `identidadWa.ts`, `EnvioControlado` — intocables. Un envío = una acción humana. El `temporary_ban` siempre visible (este spec lo refuerza, jamás lo relaja). Nada de auto-respuesta, broadcast, warmup.
- **Compuertas del embudo server-side** (`server/src/routes/gestiones.ts`): la lógica no cambia — solo cómo la UI la presenta (interceptar el drop de Cierre es UI; el server sigue rechazando igual).
- **Decisiones cerradas**: sombra O borde; una acción primaria por pantalla; piso 11px; cifras humanas; vacíos con porqué; sin gamificación caricatura. Este spec las implementa — el implementador no las re-negocia.
- **Sin router**: las vistas siguen conmutadas por estado (ADR 0002). El teclado y el puente usan el mismo `setVista`, no introducen routing.
- **Los 271 tests deben seguir verdes** y ambos typechecks limpios tras cada fase. El archivo de `Bandeja.tsx`/`FilaInteraccion.tsx`/`useBandeja.ts` exige ADR en `docs/adr/` y paridad verificada ANTES de borrar (regla dura #3); ídem cualquier otro predecesor.
- **Auditoría de cierre por vista** (antes de reportar terminada cada una): (1) ¿UN solo titular? (2) ¿el oro solo significa tiempo? (3) `grep -rEn 'text-\[(9|10)px\]' src/` en cero y `uppercase` ≤8; (4) ¿cada estado responde «¿y ahora qué?»?; (5) screenshot desktop + ventana angosta (regla dura #2).