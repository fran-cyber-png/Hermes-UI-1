import { useContext } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { ContextoDiagrama } from './contextoDiagrama';

/** Las cuatro formas de línea que trae React Flow — ver la barra de herramientas. */
export type FormaDeLinea = 'curva' | 'recta' | 'escalon' | 'escalonSuave';

function calcularTrazado(
  forma: FormaDeLinea,
  params: {
    sourceX: number;
    sourceY: number;
    sourcePosition: EdgeProps['sourcePosition'];
    targetX: number;
    targetY: number;
    targetPosition: EdgeProps['targetPosition'];
  },
) {
  switch (forma) {
    case 'recta':
      return getStraightPath(params);
    case 'escalon':
      return getSmoothStepPath({ ...params, borderRadius: 0 });
    case 'escalonSuave':
      return getSmoothStepPath(params);
    case 'curva':
    default:
      return getBezierPath(params);
  }
}

/**
 * EL BORDE — un componente para las cuatro formas de línea, no cuatro tipos
 * registrados. `data.forma` decide el trazado; el resto —el botón de borrar,
 * la etiqueta, el degradado Turbo— es igual para las cuatro.
 *
 * ══ QUÉ TRAE, DE LOS EJEMPLOS DE React Flow ═════════════════════════════════
 *
 *   · **Edge with button**: al SELECCIONAR el borde (clic sobre la línea)
 *     aparece una `×` en el medio, vía `EdgeLabelRenderer` — no por hover:
 *     un hover que solo prende sobre el trazo de 1-2 px es casi imposible de
 *     acertar con el mouse, y `selected` ya existe gratis (React Flow lo
 *     calcula solo al clickear el borde).
 *   · **Editable edge label**: `data.label` se pinta SIEMPRE que existe —no
 *     solo al seleccionar—, porque una etiqueta es información del diagrama,
 *     no un control de edición. El renombrado (doble clic) vive en
 *     `DiagramaDePagina`, igual que con los nodos: acá solo se dibuja.
 *   · **Animated edges**: el `animated: true` del borde (no de `data`) ya
 *     activa la animación de rayado que trae el CSS de la librería — no hace
 *     falta reinventarla acá.
 *   · **Marcadores**: `markerStart`/`markerEnd` los decide quien crea el
 *     borde (`DiagramaDePagina`, con el selector de la barra) — este
 *     componente solo los reenvía a `BaseEdge`, no elige un estilo fijo.
 *   · **Turbo**: el trazo se pinta con el gradiente `#gradiente-turbo`
 *     (definido una vez en `DiagramaDePagina`) en vez del color plano.
 */
export function BordeDiagrama({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerStart,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const { turbo, borrador } = useContext(ContextoDiagrama);
  const { setEdges } = useReactFlow();
  const forma = ((data as { forma?: FormaDeLinea })?.forma ?? 'curva') as FormaDeLinea;
  const etiqueta = (data as { label?: string })?.label;
  const [trazado, labelX, labelY] = calcularTrazado(forma, {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={trazado}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: turbo ? 'url(#gradiente-turbo)' : style?.stroke,
          strokeWidth: selected ? 2.5 : 1.5,
        }}
        className={borrador ? 'cursor-crosshair hover:!stroke-destructive' : undefined}
      />
      {!borrador && (etiqueta || selected) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="flex items-center gap-1"
          >
            {etiqueta && (
              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-foreground shadow-sm">
                {etiqueta}
              </span>
            )}
            {selected && (
              <button
                type="button"
                title="Eliminar esta conexión"
                onClick={() => setEdges((es) => es.filter((e) => e.id !== id))}
                className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow hover:bg-destructive hover:text-white"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
