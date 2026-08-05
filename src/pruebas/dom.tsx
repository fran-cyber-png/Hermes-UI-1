import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * MONTAR UN COMPONENTE DE VERDAD, EN UN DOM DE VERDAD.
 *
 * ── Por qué existe ──
 * El runner del front corría con `environment: 'node'` y solo módulos puros, y eso dejaba
 * un agujero con forma exacta: **una regresión de TECLADO no la puede ver ningún test
 * puro**. `escapeDePopover.ts` está testeado hasta el hueso y aun así la app perdió el
 * Escape global, porque el defecto no estaba en la decisión sino en el CABLEADO — un
 * `useEscape` que se registra en `window` desde un componente que está montado cerrado.
 * Eso solo se ve montando: hay que haber un `window`, un listener y un evento que viaje.
 *
 * No hay librería de testing acá a propósito. Lo que hace falta es `createRoot` + `act`,
 * que vienen con React, y `document.dispatchEvent`, que viene con el DOM. Una capa más
 * arriba (queries por rol, `userEvent`) sería útil el día que se testee una interacción
 * larga; hoy sería una dependencia para escribir `dispatchEvent` con otro nombre.
 *
 * ── Cómo se usa ──
 * El archivo de test tiene que declarar el entorno en su primera línea:
 *
 *     // @vitest-environment jsdom
 *
 * Por archivo y no global: el resto de la suite son módulos puros y correrlos en jsdom
 * los haría más lentos sin ganar nada. `vitest.config.ts` lo explica del otro lado.
 */

/**
 * LOS REMIENDOS DE LA PLATAFORMA — lo que jsdom no trae y la app da por sentado.
 *
 * Se aplican al importar este módulo, una sola vez, y no en cada test: son ruido del
 * entorno, no del componente, y repartirlos por los archivos de test los llenaría de
 * andamio que no dice nada sobre lo que se está probando.
 *
 * · `scrollIntoView`: jsdom no lo implementa y varios componentes lo llaman al montar.
 * · `localStorage`: vitest no lo copia de la ventana de jsdom a los globales, y `token.ts`
 *   lo usa sin guarda — sin esto, TODA request muere con «reading 'getItem'» y un test que
 *   mira si salió la request lee un falso negativo.
 * · `ResizeObserver`: jsdom tampoco lo trae, y lo usa toda barra que mide su propio ancho
 *   (`BarraFiltros` decide con eso si dibuja el degradado de «hay más chips a la derecha»).
 *   El stub NO simula nada: jsdom no hace layout, así que cualquier medida sería mentira.
 *   Solo evita que un componente que mide se caiga al montar — lo que se testea acá es qué
 *   chips existen, no cuántos entran.
 */
function remendarJsdom() {
  if (typeof document === 'undefined') return;
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
  const conObserver = globalThis as { ResizeObserver?: unknown };
  if (!conObserver.ResizeObserver) {
    conObserver.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  const g = globalThis as { localStorage?: Storage };
  if (!g.localStorage) {
    const caja = new Map<string, string>();
    g.localStorage = {
      get length() {
        return caja.size;
      },
      key: (i: number) => [...caja.keys()][i] ?? null,
      getItem: (k: string) => caja.get(k) ?? null,
      setItem: (k: string, v: string) => void caja.set(k, String(v)),
      removeItem: (k: string) => void caja.delete(k),
      clear: () => caja.clear(),
    } satisfies Storage;
  }
}
remendarJsdom();

/** El `QueryClient` de un test: sin reintentos ni caché entre casos. */
function clienteDePrueba() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

export interface Montado {
  contenedor: HTMLElement;
  /** Vuelve a pintar con otras props, dentro de `act`. */
  repintar(nodo: ReactNode): void;
  desmontar(): void;
}

/**
 * Monta `nodo` en un `<div>` colgado del `document` real.
 *
 * **Colgado del documento y no suelto**: un nodo huérfano no propaga eventos hasta
 * `window`, que es justo lo que estos tests miden.
 */
export function montar(nodo: ReactNode): Montado {
  // React exige esta bandera para no gritar por cada `act`.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  const cliente = clienteDePrueba();
  let raiz: Root | null = createRoot(contenedor);

  const pintar = (n: ReactNode) => {
    act(() => {
      raiz?.render(<QueryClientProvider client={cliente}>{n}</QueryClientProvider>);
    });
  };
  pintar(nodo);

  return {
    contenedor,
    repintar: pintar,
    desmontar() {
      act(() => {
        raiz?.unmount();
        raiz = null;
      });
      contenedor.remove();
      cliente.clear();
    },
  };
}

/**
 * Deja correr lo asíncrono que quedó pendiente (mutaciones de TanStack Query, `fetch`,
 * los efectos que disparan) y vuelve con el DOM ya repintado.
 *
 * Hace falta porque `mutate()` no llama a su `mutationFn` en el mismo tick: sin esto,
 * un test que mira si salió la request la ve siempre sin salir — y un test que espera
 * que NO salga pasa por el motivo equivocado.
 */
export async function reposar() {
  await act(async () => {
    // Un turno del event loop, no un microtask: `mutate()` no llama a su `mutationFn`
    // en el mismo tick y el reintentador de TanStack mete varios `await` en el medio.
    await new Promise((listo) => setTimeout(listo, 0));
  });
}

/**
 * Un clic que VIAJA. Mismo motivo que `teclear`: React escucha en la raíz, así que un
 * evento sin `bubbles` no llega a ningún `onClick` y el test daría siempre que no pasó nada.
 *
 * Existe para lo que un test puro no puede ver: que un `stopPropagation` esté puesto donde
 * hace falta (un botón adentro de una fila clickeable) y que un arrastre no termine
 * contando como clic.
 */
export function tocar(elemento: Element): void {
  act(() => {
    elemento.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * Un `dragstart` de verdad sobre `elemento`, con el `dataTransfer` que el handler toca.
 *
 * jsdom no implementa `DragEvent`, así que el objeto se arma a mano: lo único que la app
 * hace con él es escribir `effectAllowed`, y sin la propiedad el handler revienta antes de
 * llegar a lo que se está probando.
 */
export function arrastrar(elemento: Element): void {
  act(() => {
    const evento = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'dataTransfer', { value: { effectAllowed: '' } });
    elemento.dispatchEvent(evento);
    elemento.dispatchEvent(new Event('dragend', { bubbles: true, cancelable: true }));
  });
}

/**
 * Un `keydown` que VIAJA: nace en `target` (o en el `body`), sube y se puede cancelar.
 *
 * `bubbles: true` no es decoración — sin eso el evento nunca llega a los listeners de
 * burbuja de `window`, y un test de «¿el shell recibió el Escape?» daría siempre que no.
 */
export function teclear(
  tecla: string,
  opciones: { target?: Element; meta?: boolean; ctrl?: boolean } = {},
): KeyboardEvent {
  const evento = new KeyboardEvent('keydown', {
    key: tecla,
    bubbles: true,
    cancelable: true,
    metaKey: opciones.meta ?? false,
    ctrlKey: opciones.ctrl ?? false,
  });
  act(() => {
    (opciones.target ?? document.body).dispatchEvent(evento);
  });
  return evento;
}
