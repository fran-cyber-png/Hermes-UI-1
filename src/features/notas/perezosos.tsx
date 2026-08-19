import { Suspense, lazy, type ComponentProps } from 'react';
import type { DiagramaDePagina } from './DiagramaDePagina';
import type { EditorDePagina } from './EditorDePagina';

/**
 * LAS DOS FRONTERAS PEREZOSAS DE LA LIBRETA — entrar a la vista no es abrir una
 * página, y abrir una página de texto no es abrir un diagrama.
 *
 * ══ 🔴 LO QUE COSTABA TENERLAS ADENTRO ══════════════════════════════════════
 *
 * La vista entera venía en UN chunk perezoso, así que entrar a la Libreta
 * —aunque fuera a buscar una nota vieja y volverse— bajaba y parseaba BlockNote
 * **y** React Flow. Medido con `vite build` sobre el árbol de este PR:
 *
 *     entrar a la Libreta        377,8 KB gzip  →   19,7 KB   (−95 %)
 *     abrir una página de texto        (venía)  →  288,6 KB + 35,8 de CSS
 *     abrir un diagrama                (venía)  →   82,1 KB
 *
 * O sea que hasta hoy **el editor de diagramas lo pagaba todo el mundo**, y
 * quien nunca abre uno lo pagaba igual. Y en la máquina de la vendedora esto no
 * está precargado: `index.html` no lleva `modulepreload` de este chunk, así que
 * se descarga al entrar, en su red.
 *
 * ══ POR QUÉ LAS DOS VIVEN EN ESTE ARCHIVO Y NO EN CADA LLAMADOR ═════════════
 *
 * `Libreta.tsx` y `PantallaDividida.tsx` montan los MISMOS dos componentes. Con
 * un `lazy()` en cada uno serían cuatro fronteras para dos módulos: cada una con
 * su `Suspense`, su esqueleto y su forma de fallar — y un arreglo en una no
 * llegaría a la otra (#37). Acá hay una por componente, y las dos pantallas la
 * comparten.
 *
 * ⚠️ **El `key` de afuera sigue funcionando igual.** `EditorDePagina` se remonta
 * al cambiar de página porque `useCreateBlockNote` fija su `initialContent` en el
 * primer render; `Suspense` no cambia eso (React aplica el `key` al elemento, no
 * al límite). Sólo el PRIMER montaje suspende: después el módulo ya está en el
 * registro y saltar de página no dibuja ningún esqueleto.
 */

const Editor = lazy(() => import('./EditorDePagina').then((m) => ({ default: m.EditorDePagina })));
const Diagrama = lazy(() => import('./DiagramaDePagina').then((m) => ({ default: m.DiagramaDePagina })));

/**
 * PRECARGAR — lo que hace que partir el chunk no se pague en la cara de nadie.
 *
 * Sin esto, el split cambia «entrar tarda» por «abrir la primera página tarda»,
 * que es peor: entrar es una vez por sesión y abrir una página es todo el
 * tiempo. Se llaman al montar la Libreta, sin `await` y sin atajar el error: si
 * la descarga falla, el `import()` del render lo vuelve a intentar y ahí sí
 * tiene un `Suspense` que mostrar.
 *
 * Es el MISMO `import()` que usa el `lazy()` de arriba, así que el registro de
 * módulos lo resuelve una sola vez.
 */
export function precargarEditor(): void {
  void import('./EditorDePagina');
}

export function precargarDiagrama(): void {
  void import('./DiagramaDePagina');
}

/**
 * El esqueleto habla el idioma del `fallback` que ya tiene la vista en
 * `App.tsx`: `animate-pulse` sobre `bg-muted`, sin texto y **sin oro** (el
 * dorado significa tiempo que se acaba, y acá no se acaba nada). Tiene la FORMA
 * de lo que viene —una barra arriba y el papel debajo— para que el contenido no
 * entre corriendo la pantalla.
 *
 * ⚠️ SIN CAJA PROPIA. Antes centraba y acotaba su propio ancho; ahora quien lo
 * monta (`EditorPerezoso`, siempre adentro de `ColumnaDeEscritura` o de un
 * contenedor equivalente) ya puso la caja —a veces la hoja A4, a veces el
 * ancho fluido de la pantalla dividida—, y duplicarla acá adentro dibujaría
 * una caja más chica DENTRO de la caja de verdad mientras carga.
 */
function EsqueletoDeEditor() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="h-9 animate-pulse rounded-lg bg-muted" />
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function EsqueletoDeDiagrama() {
  return (
    <div className="p-3" aria-hidden>
      <div className="h-96 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

/**
 * LA HOJA — el texto envuelto como una página A4 de verdad (19-ago-2026, a
 * pedido del dueño): 21 × 29,7cm, con los márgenes que trae Word por default
 * (2,5cm). El tamaño y el fondo viven en `.hoja-a4` (`index.css`) — acá solo
 * se centra la hoja en el panel.
 *
 * ⚠️ SOLO PARA TEXTO. Un diagrama arma su propia barra y necesita todo el
 * ancho del panel (ver `esDiagrama` en `Libreta.tsx`), así que
 * `DiagramaPerezoso` nunca pasa por acá.
 *
 * ⚠️ MISMO TOPE DE ANCHO (21cm) DIVIDIENDO O NO. Hubo una variante angosta
 * acá (`dividida` recortando el ANCHO a 15cm) el mismo día que se sacó:
 * dividir la pantalla YA angosta cada mitad, y una hoja más chica todavía
 * encima de eso dejaba MENOS lugar para escribir del que el panel realmente
 * tenía — al revés de lo que se pedía. `.hoja-a4` ya se encoge sola (`width:
 * 100%`) hasta lo que el panel le deje, sin que haga falta un tope aparte.
 *
 * `dividida` (mismo día, otro pedido) SÍ angosta algo — el MARGEN, no el
 * ancho: `.hoja-a4--dividida` en `index.css` baja el padding de 2,5cm a
 * 1,27cm (el preset «Estrecho» de Word). Con dos hojas de por sí más chicas
 * (comparten pantalla), el margen fijo de 2,5cm se comía una tajada más
 * grande del ancho disponible que en la vista simple — achicarlo le
 * devuelve ese espacio al TEXTO sin tocar el tamaño de la hoja.
 */
export function ColumnaDeEscritura({ children, dividida }: { children: React.ReactNode; dividida?: boolean }) {
  return (
    <div className="pb-8">
      <div className={`hoja-a4 mx-auto ${dividida ? 'hoja-a4--dividida' : ''}`}>{children}</div>
    </div>
  );
}

export function EditorPerezoso(props: ComponentProps<typeof EditorDePagina>) {
  return (
    <Suspense fallback={<EsqueletoDeEditor />}>
      <Editor {...props} />
    </Suspense>
  );
}

export function DiagramaPerezoso(props: ComponentProps<typeof DiagramaDePagina>) {
  return (
    <Suspense fallback={<EsqueletoDeDiagrama />}>
      <Diagrama {...props} />
    </Suspense>
  );
}
