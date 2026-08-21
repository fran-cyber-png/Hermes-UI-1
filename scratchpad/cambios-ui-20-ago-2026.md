# Cambios de UI en Hermes — 20-ago-2026

Resumen de lo que cambió en `src/` (working tree, sin commitear todavía) durante la sesión del 20-ago-2026.
No es un ADR ni reemplaza documentación oficial — es una referencia rápida de "qué toqué y por qué" para
no perder el hilo antes de armar el PR. Los archivos concretos: `git diff --stat` sobre el estado actual.

## 1. Estandarización de tamaños y tipografía (el trabajo grande de la sesión)

Antes de esto, un botón nuevo podía nacer en cualquiera de cinco tamaños sueltos (`text-[9px]` a
`text-[13px]`) según qué archivo copiara quien lo escribió — no había una regla, solo precedentes
dispersos. Se tomó la jerarquía real de Notion (medida con JS contra su UI en vivo) y se adaptó a la
densidad propia de Hermes. La regla completa quedó documentada en el docblock de `src/lib/styles.ts`
(sección nueva, ~60 líneas) para que cualquiera que agregue un botón la tenga a mano.

**La escala** (memorizar el ROL, no el número):

| Nivel | Rol | Clase |
|---|---|---|
| 1 | Título de vista/sección | `font-heading text-sm font-bold text-navy-ink` (14px/700) |
| 2 | Botones/controles en contexto espacioso | `text-sm font-normal` (el CTA único de una pantalla conserva `font-bold`, siempre en `text-sm`) |
| 3 | Cuerpo / lo que se lee | `text-sm`, sin negrita salvo que el estado de la fila la pida |
| 4 | Secundario (subtítulos, metadata, vacíos) | `text-xs` |
| 5 | Caption / el piso (badges, timestamps, chips comprimidos) | `text-[11px]` — nunca 9 o 10px |
| 6 | Cifra-héroe | escalón real de Tailwind (`text-3xl`, `text-5xl`…), nunca un `px` suelto |

**Tablas**: encabezado de columna en el piso (11px, muted), dato en el nivel 3 (`text-sm`) — nunca al
revés. **Excepciones que NO se tocaron**: chips muy comprimidos compitiendo por ancho (columnas del
Pipeline, `BarraFiltros`), contenido dentro de popovers/menús angostos ya establecidos, y color/peso de
énfasis semántico (oro = tiempo que se acaba, rojo = vencido/urgente) — eso no es parte de la escala.

El patrón que más se repitió, vista tras vista: **segmentado/tab/chip a `text-xs font-bold` → `text-sm
font-normal`**, y **título de sección sin `font-heading`/`navy-ink` → con los dos**.

### Vista por vista

- **Dashboard** (`VistaDashboard.tsx`, `PanelNegocio.tsx`): tabs de "Mi turno" de `text-xs font-bold` a
  `text-sm font-normal`; título "Mi turno" y "N en el embudo" con la jerarquía correcta; cifra-héroe
  (`text-[44px]` → `text-5xl`, `text-2xl` → `text-3xl`); tres captions de 10px → 11px; fila de la cola
  de `text-[11px]`/`text-[13px]` sueltos a `text-sm`.
- **Pipeline** (`VistaEmbudo.tsx`, `TarjetaEmbudo.tsx`): además de tipografía, dos cambios de producto
  reales confirmados contra producción — se sacó el ícono de curso de cada chip (producción no lo
  muestra) y se sacó el botón "Sabe el precio" de cotizar en un clic de la columna Contestaron
  (producción tampoco lo tiene). Test actualizado (`TarjetaEmbudo.test.tsx`).
- **Contactos / Padrón** (`PantallaPadron.tsx`, `FiltroFaceta.tsx`, `BarraReparto.tsx`): selects y
  toggles de `text-xs font-semibold` a `text-sm font-normal`; la tabla dejó de repetir `text-xs` en cada
  `<td>` (hereda `text-sm` del contenedor); varios captions 10px → 11px.
- **Mensajes** (`ColaUnificada.tsx`, `BarraGestion.tsx`, `BotonLlamar.tsx`, `Intereses.tsx`,
  `RegistrarEvento.tsx`, `AgendarRapido.tsx`, `MenuHerramientas.tsx`, `PasarConversacion.tsx`,
  `HiloWhatsapp.tsx`, `DosRespuestas.tsx`): la barra de gestión (etiquetas, categoría "+", selector de
  etapa, "Registrar contacto", "Llamar", "Agendar", "Anotar", el menú de herramientas) pasó del molde
  `rounded-full text-[11px] font-semibold` a un molde nuevo y consistente: `h-7 rounded-md text-sm
  font-normal` con íconos de 14px en vez de 9-11px (el mismo cambio que ya tenía el círculo verde del
  Pipeline, aplicado acá). Búsqueda de la cola `text-xs` → `text-sm`. Varios captions 9-10px → 11px.
  Tabs + selector de línea se juntaron en una sola fila (ver §2).
- **Correos** (`VistaCorreos.tsx`, `LecturaDeCorreo.tsx`, `AdminRemitentes.tsx`): botón "Administrar
  remitentes" y "Nuevo remitente" de `text-xs`/`text-[11px] font-semibold` a `text-sm font-normal`;
  cuerpo del correo `text-xs` → `text-sm`; ~8 captions/labels de formulario de 10px → 11px.
- **Agenda** (`VistaAgenda.tsx`, `VistaGantt.tsx`, `CalendarHeader.tsx`, `DayColumn.tsx`,
  `EventCard.tsx`, `TimeColumn.tsx`, `MiniCalendario.tsx`, `ProximasActividades.tsx`,
  `AgendarRapido.tsx`, `SelectorImportancia.tsx`): botones "Hoy", los modos (día/semana/mes), "+ Crear",
  "Abrir chat", "Agendar" de `text-xs font-bold`/`font-semibold` a `text-sm`; título de fila y de tarjeta
  a `text-sm`; ~10 timestamps/labels de 9-10px a 11px (incluida la fila de días del mini-calendario, que
  estaba en 9px).
- **Entrenar bot** (`VistaEntrenamiento.tsx`): no necesitó cambios de tamaño — el único ajuste fue el
  título "Entrenamiento del bot", que estaba en `text-lg font-semibold` suelto y pasó a `font-heading
  text-sm font-bold text-navy-ink`.
- **Campañas** (`PantallaCampanas.tsx`, `PantallaListas.tsx`, `PantallaPlantillas.tsx`,
  `PantallaHistorial.tsx`): tabs de sección y "Armar una campaña"/"Crear una lista"/"Crear una plantilla"
  de `text-xs font-bold` a `text-sm`; la tabla de "Quién mandó qué" dejó de repetir `text-xs` por celda.
- **Libreta** (`AuditoriaDeLink.tsx`, `ModalDePlantillas.tsx`, `ModalDeLink.tsx`,
  `ModalDeRespuestasRapidas.tsx`, `AccionesDePagina.tsx`): cuatro títulos de modal que estaban en
  `text-lg`/`text-xl font-semibold` (más grandes que el estándar, no más chicos) bajaron a
  `font-heading text-sm font-bold text-navy-ink`; tres botones-toggle de la barra sobre el editor
  (Mover / Compartir con link / Dividir pantalla) de `text-xs` a `text-sm`; dos captions de 10px a 11px.
  Deliberadamente sin tocar: el riel de dibujo (`dibujo/BarraDeDibujo.tsx` y sus popovers), que es un
  carril vertical de 48px con rótulos a 8-10px — misma categoría que la excepción ya documentada de
  columnas comprimidas, en vertical. Y `PanelNotas.tsx`, que es código muerto (nadie lo renderiza).
- **Panel derecho / Ficha** (`PanelDerecho.tsx`, `HojaContacto.tsx`, `BloqueHechos.tsx`): título "Ficha"
  y headers de sección ("Timeline", "Ficha de Cerberus") con la jerarquía correcta (`sectionLabel`);
  botón "Escribirle" a `text-sm`; un par de captions 10px → 11px.

**Pendiente** (dijiste que seguíamos con esto): Navegador, Routing, y el resto de vistas menores/admin.

## 2. `SelectorLinea` — refactor terminado + un bug de hover real

- **Refactor**: `BarraFiltros.tsx` tenía partido a la mitad un refactor previo — el selector de línea se
  había sacado como componente propio (`SelectorLinea`, un dropdown de ancho fijo en vez del segmentado
  viejo que crecía con el número de líneas), pero tres consumidores de galería (`galeriaFiltros.tsx`,
  `galeriaVentana.tsx`) seguían pasándole `lineas`/`lineaActiva`/`onLinea`/`hayMias` a `BarraFiltros`
  directamente. Se terminó: `SelectorLinea` ahora vive y se importa aparte, `ColaUnificada.tsx` lo monta
  al lado de los tabs (una sola fila, ver arriba), y las galerías quedaron al día.
- **Bug de hover**: el ítem seleccionado del menú (el único con el ícono de check) mostraba el resaltado
  `hover:bg-muted` con una esquina redondeada y la otra cuadrada — reproducido de forma consistente
  moviendo la selección entre ítems (el defecto seguía al ícono de check, no a la posición en la lista).
  A pedido tuyo, en vez de perseguir la causa exacta del glitch de pintado del navegador, se sacó
  `rounded-lg` del botón del ítem: el hover ahora es un rectángulo derecho, sin esquinas, en los tres
  ítems por igual.

## 3. Bugs reales de código encontrados de paso (no son de tamaño/diseño)

Un patrón repetido: `algo.data?.campo.metodo(...)` — el `?.` solo protegía el PRIMER nivel
(`algo.data`), no el campo que sigue (`campo`). Con un mock/servidor que no trae ese campo, la app se
caía entera sin error boundary. Se corrigió agregando el segundo `?.` en los cuatro lugares donde
apareció: `PanelDerecho.tsx` (`agenda.data?.recordatorios?.filter`), `reparto/reparto.ts`
(`q.data?.destinos?.length`), `campana/ArmarCampana.tsx` (`plantillas.data?.plantillas?.filter`),
`canales/ColaUnificada.tsx` (`statsDia.data?.porVendedora?.find`).

## 4. Otros cambios en el árbol que no salieron de la estandarización de tamaños

Aparecen en el mismo diff porque se editaron en paralelo — los dejo anotados para que quede claro qué es
qué al armar el commit/PR:

- **Header de la app** (`App.tsx`): se sacó el botón "Ivi" con rótulo y `BarraFrescura`/
  `InterruptorAutoRespuesta`/`EstadoWhatsapp` del layout viejo; quedaron `InterruptorBot` y
  `BotonDeTema`, los dos rediseñados como anillos de 48px. El ancho del panel del chat pasó de `25rem` a
  `27.75rem` (medido en el DOM: los tres chips del trabajo diario + el botón de "ver etiquetas" no
  entraban en 25rem).
- **`InterruptorBot.tsx`** y **`BotonDeTema.tsx`**: rediseño a anillo de 48px sin caja/borde/texto,
  mismo molde que el nuevo `EstadoWhatsapp.tsx` (dos renglones: estado arriba en mayúsculas, número
  abajo).
- **`lib/formato.ts`**: nueva función `tempDegradado()` — degradado de fondo por temperatura, exclusivo
  de las tarjetas del Pipeline (reemplaza ahí el filete de 2px; `tempBorde()` sigue siendo el canon de
  las listas).

## Cómo verificar

```bash
npx tsc --noEmit -p tsconfig.app.json   # typecheck del front, limpio a la fecha de este doc
npm test                                 # vitest
```

Visual: `npm run dev` (o el mock de `scratchpad/servidor-mensajes-mock.mjs` si Docker no está disponible
en la máquina — ver memoria de sesión / `project-hermes-local-ui-fidelity`).
