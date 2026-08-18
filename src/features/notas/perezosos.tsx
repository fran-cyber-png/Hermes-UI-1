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
 */
function EsqueletoDeEditor() {
  return (
    <div className="px-6 py-4" aria-hidden>
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-9 animate-pulse rounded-lg bg-muted" />
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      </div>
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
