import { createContext } from 'react';

/**
 * LO QUE UN NODO/BORDE PERSONALIZADO NECESITA DEL LIENZO, SIN QUE `data` LO
 * CARGUE (17-ago-2026).
 *
 * `NodoDiagrama`/`BordeDiagrama` son componentes que React Flow instancia por
 * su cuenta — no reciben props del padre más que `id`/`data`/`selected`. Meter
 * `duplicarNodo`/`eliminarNodo` adentro de `data` de CADA nodo habría exigido
 * reescribir esa función en todos los nodos cada vez que cambia (closures
 * viejas). Un contexto es una sola función, siempre la última.
 */
export interface ContextoDiagramaValor {
  /** Modo Turbo: nodos con glow/gradiente y bordes animados con degradado. */
  turbo: boolean;
  duplicarNodo: (id: string) => void;
  eliminarNodo: (id: string) => void;
  /**
   * Modo borrador: un clic sobre un nodo/borde lo borra en vez de
   * seleccionarlo. Los componentes lo leen para cambiar el cursor y el
   * `title` que explica qué va a pasar al tocarlos.
   */
  borrador: boolean;
  /**
   * FLUJO HORIZONTAL (17-ago-2026): decide en qué costado va cada manija.
   * `'vertical'` = entra arriba, sale abajo (de siempre); `'horizontal'` =
   * entra a la izquierda, sale a la derecha — para que un árbol de Dagre en
   * `LR` se lea de izquierda a derecha y no con las líneas cruzadas contra
   * manijas pensadas para caer en columna.
   */
  direccionFlujo: 'vertical' | 'horizontal';
}

export const ContextoDiagrama = createContext<ContextoDiagramaValor>({
  turbo: false,
  duplicarNodo: () => {},
  eliminarNodo: () => {},
  borrador: false,
  direccionFlujo: 'vertical',
});
