# ADR 0011 — Las etiquetas suben a categorías con color, por vendedora

- **Fecha:** 2026-07-24
- **Estado:** aceptado
- **Decide:** issue #48 (milestone «WhatsApp Business potenciado»), plan `docs/plan-wsp-business/` Fase 3

> Nota de numeración: 0009 = urgencia única (#37); 0010 lo toman en paralelo los frentes de
> auth/notas. Este ADR se quedó con **0011** para no chocar. Si al mergear 0010 sigue libre, se
> renumera; si no, queda 0011.

## Contexto

Hasta hoy la vendedora etiquetaba una conversación con **texto libre gris** (`interesada`, `precio`,
`reclamo`) en la `BarraGestion`: un `<input>` que POSTeaba el string a `/api/gestiones/etiquetas`
(tabla `etiquetas`, compartida por el equipo, `unique(clave, etiqueta)`). Todas las etiquetas se
veían **iguales** — no había forma de leer la cola de un vistazo, ni de filtrarla por color, ni de
que la vendedora armara su propia libreta. Es el cimiento que le falta a la cola potenciada (#49,
modo Listas) y al chip de curso (#72).

El dueño (2026-07-24) lo pidió explícito: las etiquetas **se crean, editan, eliminan y se les elige
color** desde la UI (CRUD por vendedora), y alimentan el modo Listas de la cola.

## Decisión

**Las etiquetas suben de nivel a CATEGORÍAS con color elegible, por vendedora — sin tocar la tabla
de asignación.** Se separa el CATÁLOGO (qué categorías existen, con qué color) de la ASIGNACIÓN (qué
conversación lleva qué categoría):

1. **Tabla nueva `categorias`** (`server/src/db/schema.ts`, al final): el catálogo POR VENDEDORA
   (`vendedora_id` como `gestiones`/`recordatorios`) — `nombre` (≤30, trim+lowercase),
   `color` (clave de la paleta fija, validada por Zod), `es_favorito`, `orden`.
   `unique(vendedora_id, nombre)`, `index(vendedora_id, orden)`.

2. **`etiquetas` se CONSERVA tal cual** como tabla de **asignación** (sin cambiar su forma ni su
   `unique(clave, etiqueta)`). La identidad-por-string es el puente: `etiquetas.etiqueta` matchea
   `categorias.nombre` y se resuelve **al color de quien mira** (`categorias.vendedora_id = <viewer>`).
   Una etiqueta cuyo string no matchea ninguna categoría del que mira se pinta **neutra**. El color
   lo resuelve el **front** (join cliente por nombre) — así la tabla compartida y su GET no se tocan.

3. **Router nuevo `/api/categorias`** con `requiereVendedora` desde la primera línea (nace
   autenticado; la vendedora sale del token). CRUD completo; el GET trae además el **conteo de
   conversaciones por categoría** para que el modo Listas (#49) lo sirva sin otra ruta. La lógica de
   base vive en el seam inyectable `categorias/consultarCategorias.ts` (estilo `consultarCola`),
   testeado contra base (`*.test.db.ts`).

4. **Paleta fija `--cat-*`** en `src/index.css`, **sin oro**: `pizarra rojo naranja verde azul cian
   morado rosa`. Se excluye a propósito toda la familia ámbar/amarillo: en Hermes el oro significa
   **una** cosa (tiempo que se acaba) y abaratarlo como color decorativo rompería esa señal. Los
   tokens tienen nombre genérico porque los reusa el chip de curso (#72).

5. **Seed perezoso + backfill.** Al primer `GET` sin filas se siembran los tres del glosario
   (`interesada`→azul, `precio`→naranja, `reclamo`→rojo). El script one-off `backfill:categorias`
   siembra el catálogo desde las etiquetas ya existentes (color `pizarra`, orden por frecuencia,
   idempotente).

## Qué reemplaza

- **El `<input>` de texto libre gris** de `EtiquetasInline` (`BarraGestion.tsx`): pasa a **elegir de
  las categorías de la vendedora** (píldoras con su color) + «nueva categoría» que abre el selector
  de color y crea+asigna en dos pasos. La píldora asignada usa **borde de color** (regla dura: sombra
  o borde, nunca ambos; nunca oro).
- **La pantalla de administración** nace en el `···` › «Etiquetas» (`GestorCategorias.tsx`): listar,
  crear, renombrar, recolorear, marcar favorita, reordenar, borrar.

No se archiva ningún predecesor con historia git (no era un módulo, era un input y una tabla que se
conserva); el input viejo se reemplaza en el mismo PR.

## Alternativas descartadas

- **Color en la tabla `etiquetas`** (una columna `color` en la asignación). Rompería el
  `unique(clave, etiqueta)` compartido y ataría el color a quien etiquetó, no a quien mira. Se
  prefiere resolver el color en el front contra el catálogo del viewer.
- **Categorías del equipo / compartidas.** Quedan **por vendedora** (el dueño acepta el costo: la 2ª
  vendedora arranca con la libreta vacía, mitigado por el seed). Promoverlas a «del equipo» es un
  frente posterior.
- **Oro en la paleta.** Prohibido por la regla de marca.

## Consecuencias

- **Exige `db:push` manual al deployar** (Drizzle sin migraciones versionadas): tras el pull en VPS1,
  `cd server && npm run db:push` crea la tabla `categorias`, y `npm run backfill:categorias` (una vez)
  siembra el catálogo desde las etiquetas vivas.
- El modo Listas (#49) y el chip de curso (#72) ya tienen su cimiento: catálogo con color + favoritas
  + conteo, y una paleta genérica compartida.
- El filtro de la cola por categoría (chips de favoritas) **no** entra acá: es de la cola potenciada.
