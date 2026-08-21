import { colorPuntoImportancia } from '../importancia';
import { horaDe } from '../fechas';
import type { Recordatorio } from '../agenda';

interface EventCardProps {
  recordatorio: Recordatorio;
  vencido: boolean;
  onView: (r: Recordatorio) => void;
  onDragStart?: (e: React.DragEvent, r: Recordatorio) => void;
  draggable?: boolean;
  isDragging?: boolean;
}

export function EventCard({
  recordatorio: r,
  vencido,
  onView,
  onDragStart,
  draggable = false,
  isDragging = false,
}: EventCardProps) {
  const hecho = r.estado === 'hecho';

  return (
    <button
      draggable={draggable}
      onDragStart={(e) => {
        if (onDragStart) onDragStart(e, r);
      }}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onView(r);
      }}
      title={r.importancia ? `Importance: ${r.importancia.toUpperCase()}` : 'No importance set'}
      className={
        'flex w-full flex-col gap-1.5 rounded-md border border-border/40 bg-card px-2 py-1.5 text-left ' +
        'transition-all duration-150 ' +
        (draggable ? 'cursor-move hover:cursor-grabbing' : 'cursor-pointer hover:shadow-sm') +
        (isDragging ? ' opacity-60 scale-95 shadow-none' : ' hover:border-border/60 hover:bg-secondary/5 hover:shadow-sm') +
        (hecho ? ' opacity-50 line-through' : '')
      }
    >
      {/* Time & Importance */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground opacity-80">
          {horaDe(r)}
        </span>
        {r.importancia && (
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${colorPuntoImportancia(r.importancia)}`}
            title={`Importance: ${r.importancia.toUpperCase()}`}
          />
        )}
      </div>

      {/* Title */}
      <span
        className={
          'block truncate text-sm font-semibold ' +
          (hecho
            ? 'text-muted-foreground line-through'
            : vencido
              ? 'text-destructive'
              : 'text-foreground')
        }
      >
        {r.nota}
      </span>

      {/* Status indicator */}
      {r.estado && (
        <div className="h-0.5 rounded-full" aria-hidden hidden={!hecho} />
      )}
    </button>
  );
}
