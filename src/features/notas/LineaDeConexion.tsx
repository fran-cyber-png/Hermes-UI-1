import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react';

/**
 * LA LÍNEA DE CONEXIÓN — lo que se ve MIENTRAS se arrastra desde una manija,
 * antes de soltarla (17-ago-2026). Es un componente aparte de `BordeDiagrama`
 * a propósito: todavía no hay un borde —ni `id`, ni `source`, ni `target`—,
 * solo un punto de origen y la posición del mouse.
 *
 * Se pinta distinto según `connectionStatus`: verde si soltarla ahí formaría
 * una conexión válida, roja si no (por ejemplo, sobre un `Handle` del mismo
 * tipo) — la misma pregunta que ya contesta `isValidConnection`, mostrada
 * ANTES de soltar el mouse, no después con un error.
 */
export function LineaDeConexion({ fromX, fromY, toX, toY, fromPosition, toPosition, connectionStatus }: ConnectionLineComponentProps) {
  const [trazado] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  const color = connectionStatus === 'invalid' ? '#ef4444' : '#0ea5e9';

  return (
    <g>
      <path fill="none" stroke={color} strokeWidth={2} strokeDasharray="6 4" className="animated" d={trazado} />
      <circle cx={toX} cy={toY} r={4} fill={color} stroke="white" strokeWidth={1.5} />
    </g>
  );
}
