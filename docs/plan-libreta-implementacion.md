# La Libreta — plan de implementación

> **4-ago-2026.** Ejecuta el diagnóstico de `docs/plan-libreta-que-deberia-tener.md`.
> Todas las APIs de abajo están **verificadas contra el código instalado**, no recordadas:
> `@blocknote/core@0.52.1` —los dos `.d.ts` que se citan abajo, `BlockNoteEditor.d.ts:43` y
> `BlockNoteSchema.d.ts`, son **tipos publicados de ese paquete npm, no archivos de Hermes**:
> viven bajo `node_modules/@blocknote/core/types/`—,
> `server/src/routes/hechos.ts`, `server/src/db/schema.ts:1233+`.

## Cómo se corta el trabajo

Cinco PRs. **Los tres primeros no dependen de ninguna medición**: arreglan defectos verificados
por lectura. Los dos últimos sí esperan.

| PR | Qué | Toca server | Migración | Despliegue |
|---|---|---|---|---|
| **1** | Que la Libreta no mienta | no | no | N4 solo |
| **2** | Las frases de precio, alcanzables | dato | no | ninguno (SQL) |
| **3** | Pantalla para editar `hechos` | no | no | N4 solo |
| **4** | Medir de verdad | sí (chico) | **sí** | N5 (botón) |
| **5** | La nota pegada a la conversación | sí | no | N5 (botón) |

---

# PR 1 · «Que no mienta» — los tres defectos silenciosos

**Rama** `fix/libreta-no-miente` · **Cierra** un issue nuevo · puro front, sin schema.

## 1.1 · Extraer el autoguardado a un hook, que es lo que lo hace testeable

El defecto vive en un `catch {}` adentro de un componente de 400 líneas, y por eso no se puede
interrogar. Sale a `src/features/notas/useAutoguardado.ts`:

```ts
export type EstadoGuardado =
  | { tipo: 'quieto' }
  | { tipo: 'guardando' }
  | { tipo: 'guardado' }
  | { tipo: 'fallo'; motivo: string };

export function useAutoguardado(...): { estado: EstadoGuardado; alCambiar(doc: unknown): void }
```

Se lleva adentro **las tres cosas que hoy están sueltas** en `Libreta.tsx`: el temporizador de
800 ms, el adelanto en el desmontaje (ya escrito, `Libreta.tsx:192-198`) y la decisión de crear
vs. actualizar.

**Y la lectura del error es una función PURA aparte**, `renglonDeEstado(estado)`, porque el
defecto no está en el `catch`: está en el **ternario** que solo sabe decir dos cosas
(`Libreta.tsx:275-277`). Una función pura se puede interrogar sobre el caso que hoy no existe.

- El motivo sale de `ErrorApi.message` cuando el server lo manda (`server/src/notas/notas.ts:31-33`
  ya devuelve *«la nota no puede superar los 2.000 caracteres (tiene N)»*).
- **`fallo` gana siempre**: mientras haya un fallo sin resolver, la barra NO puede volver a decir
  «Guardado» aunque `editadoAt` exista. Ese es exactamente el bug.

## 1.2 · Los bloques de archivo salen del menú

Hoy «Image» aparece en el `/` sin que haya `uploadFile`, y una página que sea solo imagen aplana
a `""`, el server la rechaza y el error se pierde.

```ts
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';

// `image`/`video`/`audio`/`file` tienen contenido "none": su URL vive en `props`, y
// `aTextoPlano` no lee props (a propósito). Ofrecerlos sin `uploadFile` es ofrecer un
// camino que termina en una página que no se guarda nunca.
const { image, video, audio, file, ...bloquesQueSePuedenGuardar } = defaultBlockSpecs;
export const ESQUEMA_LIBRETA = BlockNoteSchema.create({ blockSpecs: bloquesQueSePuedenGuardar });
```

`BlockNoteSchema.create({ blockSpecs })` verificado en los tipos publicados del paquete
`@blocknote/core` (`BlockNoteSchema.d.ts`); el editor lo recibe por la opción `schema`
(`BlockNoteEditor.d.ts:170`, del mismo paquete).

> **Es barato AHORA y caro después**: con 0 filas no hay ni un documento viejo que contenga esos
> bloques. Cuando los haya, sacarlos del schema los rompe al abrir.

## 1.3 · El editor en español

`useCreateBlockNote` hoy solo recibe `initialContent` (`Libreta.tsx:79-84`), así que el `/`, los
placeholders y todos los menús salen **en inglés**.

```ts
import { es } from '@blocknote/core/locales';
```

Verificado: la locale existe y viene completa. **Pero es español peninsular** — su placeholder es
*«Escribe o teclea '/' para comandos»* y Hermes escribe en voseo («Anotá lo que quieras»,
«Elegí una página»). Van pisadas a mano en un objeto `DICCIONARIO` propio: placeholders y las
frases del slash menu que usen imperativo.

`dictionary?: Dictionary & Record<string, any>` verificado en los tipos publicados de
`@blocknote/core` (`BlockNoteEditor.d.ts:43`).

## 1.4 · «Deshacer» al archivar

Regresión conocida, no idea nueva: el review del PR #47 exigió el camino de vuelta, `desarchivar`
existe en el server y en `useMutacionesNotas`, y **la Libreta ni lo destructura**
(`Libreta.tsx:173`). El arreglo quedó en `PanelNotas`, que ya no se monta.

## 1.5 · La doble creación de «Nueva página»

`guardar` decide por `seleccion`, y `setSeleccion` recién ocurre cuando resuelve `mutateAsync`
—que espera el refetch de la lista—, así que dos disparos dentro de esa ventana crean **dos
páginas**. Se cierra con una bandera de «hay un POST en vuelo» dentro del hook de 1.1.

## 1.6 · Corregir la documentación que quedó mintiendo

- **CLAUDE.md**: describe la pestaña «Notas» del panel derecho como viva. Es código muerto
  (`pestanas.ts:46` la declara y ningún componente la renderiza).
- **ADR 0034** y `docs/plan-espacio-de-notas.md` dicen que BlockNote es «el mismo motor que
  Notion». No se encontró fuente que lo sostenga: BlockNote se autodescribe sobre **ProseMirror y
  Tiptap**. Se corrige a eso, que además es lo que hace correcta la decisión de no migrar.

## Tests del PR 1

| Test | Qué fija |
|---|---|
| `renglonDeEstado.test.ts` (puro) | **`fallo` le gana a `guardado`** aunque `editadoAt` exista. Es el bug. |
| `useAutoguardado.test.tsx` (jsdom) | un `400` deja estado `fallo` con su motivo · dos «Nueva página» seguidas hacen **un** POST · el desmontaje adelanta lo pendiente (mover el test que ya existe, `guardadoAlSalir.test.tsx`) |
| `esquemaLibreta.test.ts` (puro) | `image`/`video`/`audio`/`file` **no** están en el schema |
| `diccionario.test.ts` (puro) | ninguna frase visible quedó en inglés ni en peninsular (`Escribe`, `teclea`, `Pulsa`) |
| `Libreta.test.tsx` (jsdom) | archivar muestra «Deshacer» y restaura |

**Verificación por mutación** (como en `App.test.tsx`): devolver el ternario viejo tiene que poner
en rojo `renglonDeEstado.test.ts`. Si no, el test no sirve.

## Verificación visual (regla dura #2)

Con el server de mentira que ya está escrito
(`scratchpad/api-de-mentira.mjs` + `VITE_API_URL`): desktop 1280×720 y mobile 390×844 de
**(a)** el estado de fallo, **(b)** el menú `/` en español y sin «Image», **(c)** el toast de
deshacer. Y una que falta y es aparte: **el side menu** — `src/index.css:301-303` pisa a `0` el
`padding-inline: 54px` que BlockNote reserva para dibujar el drag handle y el «+». Si están
recortados, «arrastrar bloques» existe y es invisible.

---

# PR 2 · Las frases de precio, alcanzables

**Rama** `fix/hechos-precio-visibles` · **no toca código**: es dato.

Medido en prod: 21 de las 27 activas tienen `momentos = []` y las 13 de plata tienen
`orden = 100` (el default del schema Zod). El panel muestra **3**, y el top-3 lo ocupan siempre
las mismas cuatro. Resultado: **las 4 frases de precio y las 8 de dónde pagar no aparecen nunca.**

Es un `UPDATE` de `orden` sobre `hechos` — pero **no a mano por SSH**: un script en
`server/src/scripts/` con **dry-run por default**, como `hechos:sembrar`.

> **La pregunta de diseño que hay que contestar antes**: ¿el precio va en el top-3 *siempre*, o
> solo en el momento de venta en que corresponde? Si es lo segundo, no es `orden`: es poblar
> `momentos`, que hoy están vacíos en 21 de 27. **Lo decide el dueño, no el script.**

---

# PR 3 · La pantalla para editar `hechos`

**Rama** `feat/pantalla-de-hechos` · puro front. **Esto es lo que el pedido de «espacio
compartido» realmente describe.**

La API existe **entera** y tiene **cero consumidores** en el front:

| Endpoint | Verificado en |
|---|---|
| `GET /api/hechos/catalogo` | `routes/hechos.ts:44` |
| `POST /api/hechos` | `:74` (`Hecho.safeParse`) |
| `PUT /api/hechos/:clave` | `:88` (`Hecho.partial()`) |
| `DELETE /api/hechos/:clave` | `:114` |

**La identidad es `clave` (el slug), no el `id`** — renombrar el rótulo no rompe nada. Campos:
`clave` · `rotulo` · `texto` · `momentos[]` · `orden` · `activo`.

Dónde vive: **no es una vista nueva del riel.** ADR 0034 acaba de fijar que al riel entra un
LUGAR con acción primaria nombrable, y esto es una pantalla de administración que se toca una vez
por semana. Va colgada del `···`, como «Mensajes predeterminados».

Lo que tiene que mostrar y hoy no se ve en ningún lado:

- **Qué ve la vendedora vs. qué ve el bot.** Hoy el bot ve 27 piezas y ella 3. Esa inversión es
  el hallazgo, y la pantalla es donde se hace visible: marcar cuáles entran al top-3.
- **Dar de baja es `activo = false`**, nunca DELETE (la regla de `alias_curso`).

**No toca permisos**: `hechos` no tiene `vendedora_id` — es del equipo por construcción.

---

# PR 4 · Medir de verdad

**Rama** `feat/medir-la-libreta` · **el único con migración**, así que **necesita el botón N5**.

La métrica de ADR 0034 §6, **con desglose por `clave`**, como script read-only.

Y la decisión de fondo: con 0 filas, **«la abrió y no supo qué poner» y «nunca la abrió» son
indistinguibles**, y llevan a rediseños opuestos. Hermes **no tiene telemetría de front** (ninguna
ruta de eventos entre las ~40 de `server/src/index.ts`) y, como no hay router (ADR 0002), abrir
una vista tampoco deja rastro en nginx.

Lo mínimo que resuelve la ambigüedad sin abrir un frente de analytics: una tabla
`vista_abierta (vendedora_id, vista, abierta_at)` y un `POST` que se dispara al cambiar de vista.
**Es un frente propio y tiene costo de privacidad** — decidilo a propósito, no de pasada.

> Si no se instrumenta, la semana de medición devuelve **otro cero mudo** y no se aprende nada.

---

# PR 5 · La nota pegada a la conversación

**Rama** `feat/nota-de-la-conversacion` · **solo después del PR 4.** Es la hipótesis C, y es lo
que el patrón de la industria dice (Attio, Close, Intercom, Superhuman: unánime).

1. **Volver a montar la nota anclada** dentro de `PanelDerecho`. Hay que decidir dónde entra en
   360 px ordenados por lo que decide una venta (ADR 0017) — probablemente la pestaña «Notas» que
   `pestanas.ts` ya declara y nadie renderiza.
2. **Sacar `eq(notas.clave, 'general')`** de `buscarNotas` (`server/src/notas/notas.ts:191`) y
   devolver la `clave` para poder saltar a la conversación. El GIN es `to_tsvector('spanish', texto)`
   y no lleva `clave` adentro, así que **sigue sirviendo sin reindexar**.
   Ojo con la ruta: hoy ignora el parámetro `clave` cuando viene `q` (`routes/notas.ts:64-70`).
3. **Archivar con ADR** lo que quede huérfano: `PanelContexto.tsx`, `LibretaPersonal`, y las ramas
   de `Libreta.tsx` que tratan `origen === 'gestion'` y son inalcanzables con `clave='general'`.

> **La decisión de reusar `PanelNotas` o archivarlo va PRIMERO.** No se pueden hacer las dos.

---

# Lo que este plan deja afuera a propósito

| | Por qué |
|---|---|
| Migrar a Tiptap/Lexical | BlockNote **ya es** Tiptap 3 + ProseMirror. 2-4 días para quedar igual. |
| `@blocknote/xl-*` (PDF, DOCX, IA) | 🔴 **`GPL-3.0 OR PROPRIETARY`** y Hermes se distribuye empaquetado. Si hace falta PDF: `blocksToFullHTML()` + `window.print()`. |
| Adjuntos de verdad | Infra: disco en VPS1 sin GC, sin cuota, sin backup escrito. Y nadie los pidió: 0 filas. |
| Colaboración en vivo / comentarios | Servidor propio **+ permisos**, que Hermes no tiene. |
| Subir el tope de 2.000 | Cero casos medidos: de 617 envíos, ninguno lo supera; el p95 es 943. El problema es que **choca en silencio**, no el número. |
| Historial de versiones · papelera · semilla | Sin una sola observación de uso. |
| Que la Libreta guarde precios y objeciones | **`hechos` ya lo hace, 30 a 0.** Duplicar parte la fuente de verdad. |

---

# Riesgos

1. **PR 1 no hace que nadie empiece a usarla.** Son arreglos correctos y necesarios, pero el
   impacto está en el PR 2 y el 3. Si hay que elegir uno solo, elegí el 3.
2. **El PR 5 puede volverse innecesario** si la medición dice que la libreta suelta sí se usa.
   Por eso va último.
3. **El `concurrency` de `main` se puede tragar un deploy** (pasó hoy con ADR 0034: la corrida
   salió `cancelled`, no `failed`). Verificar siempre con un marcador del cambio propio dentro del
   bundle vivo, nunca con «CI verde».
