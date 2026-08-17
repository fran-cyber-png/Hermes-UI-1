import Dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';

/**
 * LA MATEMÁTICA DEL DIAGRAMA — aparte de `DiagramaDePagina.tsx` (17-ago-2026)
 * para poder testearla sin un lienzo montado: son dos funciones PURAS, y
 * simular un arrastre de verdad en jsdom (que no mide layout real) sería
 * fingir un resultado en vez de comprobarlo.
 */

/**
 * CONEXIÓN POR PROXIMIDAD — el ejemplo "Proximity Connect" de React Flow.
 * Recibe el nodo que se está arrastrando y el resto, devuelve con quién
 * conectaría si se soltara AHORA (o `null`). El costado con menor `x` es el
 * ORIGEN — así la flecha siempre sale del que está más a la izquierda, sea
 * cual sea el que la persona agarró con el mouse.
 */
export const DISTANCIA_PROXIMIDAD = 150;

export function nodoMasCercano(arrastrado: Node, todos: Node[]): { source: string; target: string } | null {
  let mejor: { distancia: number; nodo: Node } | null = null;
  for (const n of todos) {
    if (n.id === arrastrado.id) continue;
    const dx = n.position.x - arrastrado.position.x;
    const dy = n.position.y - arrastrado.position.y;
    const distancia = Math.sqrt(dx * dx + dy * dy);
    if (distancia < DISTANCIA_PROXIMIDAD && (!mejor || distancia < mejor.distancia)) {
      mejor = { distancia, nodo: n };
    }
  }
  if (!mejor) return null;
  const cercanoEsOrigen = mejor.nodo.position.x < arrastrado.position.x;
  return cercanoEsOrigen ? { source: mejor.nodo.id, target: arrastrado.id } : { source: arrastrado.id, target: mejor.nodo.id };
}

const ANCHO_NODO_POR_DEFECTO = 160;
const ALTO_NODO_POR_DEFECTO = 44;

/**
 * ÁRBOL DE DAGRE — acomoda todo el diagrama; `direccion`: `'TB'` (vertical,
 * de arriba hacia abajo) o `'LR'` (horizontal, de izquierda a derecha).
 *
 * Usa `node.measured` (el tamaño real, medido después de renderizar) cuando
 * existe, y cae a un tamaño por defecto si no —un nodo recién creado en el
 * mismo gesto que dispara el layout todavía no tiene medida—, para que
 * organizar nunca falle por falta de esa medición.
 */
export function organizarConDagre(nodosActuales: Node[], conexionesActuales: Edge[], direccion: 'TB' | 'LR'): Node[] {
  const grafo = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  grafo.setGraph({ rankdir: direccion, nodesep: 56, ranksep: 88 });
  for (const n of nodosActuales) {
    grafo.setNode(n.id, { width: n.measured?.width ?? ANCHO_NODO_POR_DEFECTO, height: n.measured?.height ?? ALTO_NODO_POR_DEFECTO });
  }
  for (const e of conexionesActuales) {
    if (grafo.hasNode(e.source) && grafo.hasNode(e.target)) grafo.setEdge(e.source, e.target);
  }
  Dagre.layout(grafo);
  return nodosActuales.map((n) => {
    const posicion = grafo.node(n.id);
    const ancho = n.measured?.width ?? ANCHO_NODO_POR_DEFECTO;
    const alto = n.measured?.height ?? ALTO_NODO_POR_DEFECTO;
    return { ...n, position: { x: posicion.x - ancho / 2, y: posicion.y - alto / 2 } };
  });
}
