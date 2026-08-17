import { useContext } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { Copy, Trash2 } from 'lucide-react';
import { ContextoDiagrama } from './contextoDiagrama';

/**
 * EL NODO — un solo componente para los tres tipos (17-ago-2026), no tres
 * copias. `type` (`'inicio' | 'paso' | 'fin'`) decide qué manijas lleva y
 * cómo se ve; el resto —la barra al seleccionar, el estilo Turbo, el resalte
 * de proximidad— es igual para los tres.
 *
 * 🔴 **EL CUARTO TIPO, «grupo», SE RETIRÓ (17-ago-2026, mismo día que
 * nació).** Era un rectángulo redimensionable sin nodos hijos de verdad —ni
 * `parentId` ni `extent`—, así que "agrupar" no agrupaba nada: solo dibujaba
 * un marco atrás de otros nodos, que igual se podían arrastrar afuera sin
 * que pasara nada. Un contenedor que no contiene es peor que no tenerlo:
 * promete una relación que el dato no tiene. El día que haga falta agrupar
 * de verdad, es un frente aparte —con `parentId`/`extent: 'parent'`—, no
 * este mismo nodo con más CSS.
 *
 * ══ QUÉ TRAE, DE LOS EJEMPLOS DE React Flow ═════════════════════════════════
 *
 *   · **Node Toolbar**: duplicar/eliminar aparecen ARRIBA del nodo al
 *     seleccionarlo — no ocupan lugar en el lienzo el resto del tiempo.
 *   · **Manijas según el tipo**: `inicio` no lleva manija de ENTRADA (nada
 *     puede apuntarle) y `fin` no lleva de SALIDA — al revés de `paso`, que
 *     lleva las dos. Es la validación más simple que hay: ni siquiera se
 *     puede intentar el conector que no corresponde.
 *   · **Flujo horizontal**: con `direccionFlujo === 'horizontal'` las
 *     manijas van izquierda/derecha en vez de arriba/abajo — para que el
 *     árbol de Dagre en modo `LR` se lea de corrido.
 *   · **Proximity Connect**: `data.cercano` (lo pone `DiagramaDePagina` al
 *     arrastrar) pinta el nodo con un resalte propio — es el aviso visual de
 *     «soltá acá y se conecta sola», antes de que exista ningún borde.
 */

const ETIQUETA_POR_TIPO: Record<string, string> = { inicio: 'Inicio', paso: 'Paso', fin: 'Fin' };

export function NodoDiagrama({ id, type, data, selected }: NodeProps) {
  const { turbo, borrador, direccionFlujo, duplicarNodo, eliminarNodo } = useContext(ContextoDiagrama);
  const etiqueta = String((data as { label?: unknown })?.label ?? ETIQUETA_POR_TIPO[type ?? 'paso'] ?? 'Paso');
  const cercano = Boolean((data as { cercano?: unknown })?.cercano);
  const sinEntrada = type === 'inicio';
  const sinSalida = type === 'fin';
  const horizontal = direccionFlujo === 'horizontal';

  const posicionEntrada = horizontal ? Position.Left : Position.Top;
  const posicionSalida = horizontal ? Position.Right : Position.Bottom;

  return (
    <>
      <NodeToolbar
        isVisible={selected && !borrador}
        position={Position.Top}
        className="flex gap-0.5 rounded-lg border border-border bg-card p-1 shadow-md"
      >
        <button
          type="button"
          title="Duplicar este nodo"
          onClick={() => duplicarNodo(id)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          title="Eliminar este nodo"
          onClick={() => eliminarNodo(id)}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </NodeToolbar>

      <div
        title={borrador ? 'Modo borrador: un clic lo elimina' : etiqueta}
        className={`flex min-w-[6rem] items-center justify-center rounded-lg border bg-card px-4 py-2 text-center text-sm font-medium text-foreground transition ${
          turbo
            ? 'border-transparent bg-gradient-to-br from-fuchsia-500/15 via-sky-500/15 to-emerald-500/15 shadow-[0_0_14px_-2px_rgba(217,70,239,0.55)]'
            : 'border-border'
        } ${selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''} ${
          // El resalte de proximidad GANA sobre el de selección: es la señal
          // más urgente en ese instante («soltá y se conecta»).
          cercano ? '!border-amber-400 !bg-amber-400/15 !ring-2 !ring-amber-400' : ''
        } ${borrador ? 'cursor-crosshair hover:border-destructive hover:text-destructive' : ''}`}
      >
        {etiqueta}
      </div>

      {!sinEntrada && <Handle type="target" position={posicionEntrada} className={turbo ? '!border-fuchsia-400 !bg-fuchsia-500' : undefined} />}
      {!sinSalida && <Handle type="source" position={posicionSalida} className={turbo ? '!border-sky-400 !bg-sky-500' : undefined} />}
    </>
  );
}
