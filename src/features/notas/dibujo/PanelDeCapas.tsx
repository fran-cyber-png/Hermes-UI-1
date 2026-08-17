import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, Eye, EyeOff, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import type { Capa } from './capas';
import type { Reordenamiento } from './figuras';

/**
 * EL PANEL DE CAPAS — qué se ve, qué se puede tocar y en qué orden se pinta.
 *
 * ══ SON DOS EJES DISTINTOS Y CONVIENE NO MEZCLARLOS ═════════════════════════
 *
 * Arriba, el ORDEN de lo que está seleccionado dentro de su lista: traer al
 * frente, enviar al fondo, subir y bajar un paso. Es una permutación del array
 * de figuras, y el array ES el orden de pintado (`reordenar` en `figuras.ts`).
 *
 * Abajo, las CAPAS: una etiqueta sobre un grupo de figuras con dos
 * interruptores, visible y bloqueada. No cambian el orden de nada.
 *
 * Mezclarlos —«mandar a la capa de arriba»— parece natural y es la fuente
 * clásica de confusión: una figura puede estar en la capa de arriba y aun así
 * quedar tapada por otra de la misma capa.
 *
 * ══ POR QUÉ VIVE EN UN POPUP Y NO EN LA BARRA ═══════════════════════════════
 *
 * La barra tiene 48 px de ancho. Una lista de capas con nombre, ojo y candado no
 * entra; y meterla achicaría los botones que se usan todo el tiempo para dejar
 * lugar a los que se usan una vez por página.
 */

const ORDENES: { id: Reordenamiento; rotulo: string; Icono: typeof ArrowUp }[] = [
  { id: 'frente', rotulo: 'Traer al frente', Icono: ChevronsUp },
  { id: 'subir', rotulo: 'Subir una posición', Icono: ArrowUp },
  { id: 'bajar', rotulo: 'Bajar una posición', Icono: ArrowDown },
  { id: 'fondo', rotulo: 'Enviar al fondo', Icono: ChevronsDown },
];

export function PanelDeCapas({
  capas,
  capaActiva,
  haySeleccion,
  cuantasPorCapa,
  onCapaActiva,
  onCambiarCapa,
  onAgregar,
  onBorrar,
  onOrdenar,
}: {
  capas: Capa[];
  capaActiva: string;
  haySeleccion: boolean;
  /** Cuántas figuras tiene cada capa, para poder decirlo sin recalcular acá. */
  cuantasPorCapa: Record<string, number>;
  onCapaActiva(id: string): void;
  onCambiarCapa(id: string, cambios: Partial<Omit<Capa, 'id'>>): void;
  onAgregar(): void;
  onBorrar(id: string): void;
  onOrdenar(a: Reordenamiento): void;
}) {
  return (
    <div
      className="w-56 rounded-lg border border-border bg-card p-2 shadow-lg"
      role="dialog"
      aria-label="Capas"
      // El panel vive adentro de la barra; sin esto, cada clic acá dentro
      // también cuenta como un clic en la barra.
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── El orden DENTRO de la capa ── */}
      <p className="px-1 pb-1 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
        Orden
      </p>
      <div className="flex gap-1">
        {ORDENES.map(({ id, rotulo, Icono }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOrdenar(id)}
            // Sin nada elegido no hay qué reordenar: apagado antes que sin efecto.
            disabled={!haySeleccion}
            title={rotulo}
            aria-label={rotulo}
            className="flex flex-1 items-center justify-center rounded border border-border py-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Icono className="size-3.5" />
          </button>
        ))}
      </div>

      <hr className="my-2 border-t border-border" />

      <div className="flex items-center justify-between px-1 pb-1">
        <p className="text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">Capas</p>
        <button
          type="button"
          onClick={onAgregar}
          aria-label="Agregar capa"
          title="Agregar capa"
          className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <ul className="space-y-0.5">
        {capas.map((capa) => (
          <li
            key={capa.id}
            className={
              'flex items-center gap-1 rounded px-1 py-1 ' +
              (capa.id === capaActiva ? 'bg-secondary' : 'hover:bg-muted')
            }
          >
            <button
              type="button"
              onClick={() => onCambiarCapa(capa.id, { visible: !capa.visible })}
              aria-label={`${capa.visible ? 'Ocultar' : 'Mostrar'} ${capa.nombre}`}
              aria-pressed={!capa.visible}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
            >
              {capa.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>

            <button
              type="button"
              onClick={() => onCambiarCapa(capa.id, { bloqueada: !capa.bloqueada })}
              aria-label={`${capa.bloqueada ? 'Desbloquear' : 'Bloquear'} ${capa.nombre}`}
              aria-pressed={capa.bloqueada}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-foreground"
            >
              {capa.bloqueada ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
            </button>

            {/* Tocar el nombre la vuelve la capa ACTIVA: es donde caen las
                figuras nuevas. `aria-current` y no `aria-pressed`: no es un
                interruptor, es «dónde estoy». */}
            <button
              type="button"
              onClick={() => onCapaActiva(capa.id)}
              aria-current={capa.id === capaActiva}
              className="min-w-0 flex-1 truncate text-left text-xs text-foreground"
            >
              {capa.nombre}
              <span className="ml-1 text-[0.625rem] text-muted-foreground">{cuantasPorCapa[capa.id] ?? 0}</span>
            </button>

            {/* La última no se puede borrar: sin ninguna capa, las figuras
                nuevas no tendrían dónde caer. Lo que tenía se muda, no se
                pierde — ver `borrarCapa`. */}
            <button
              type="button"
              onClick={() => onBorrar(capa.id)}
              disabled={capas.length <= 1}
              aria-label={`Borrar ${capa.nombre}`}
              title={capas.length <= 1 ? 'No se puede borrar la última capa' : `Borrar ${capa.nombre}`}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <p className="px-1 pt-2 text-[0.625rem] leading-tight text-muted-foreground">
        Una capa bloqueada se ve pero no se puede seleccionar ni borrar.
      </p>
    </div>
  );
}
