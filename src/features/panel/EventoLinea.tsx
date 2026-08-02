import { Pencil, Trash2 } from 'lucide-react';
import { COLOR, type EventoLinea as EventoTL } from './timeline';

function formatearHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function Punto({ estado }: { estado: EventoTL['estado'] }) {
  return (
    <span
      aria-hidden
      className={
        'relative z-10 mt-1 size-2.5 shrink-0 rounded-full ' +
        (estado === 'pendiente'
          ? 'border-2 border-dashed border-muted-foreground/40 bg-card'
          : COLOR[estado].punto)
      }
    />
  );
}

/**
 * Un evento es una fila de texto sobre un rail, no una caja: punto (10 px,
 * color por estado) + rótulo + hora quieta a la derecha. La línea conectora se
 * corta en el último (`data-ultimo`), no se estira más allá del punto.
 */
export function EventoLinea({ e, esUltimo }: { e: EventoTL; esUltimo: boolean }) {
  const c = COLOR[e.estado];
  const esIa = e.estado === 'ia';
  const esManual = e.estado === 'manual' || e.editable;

  return (
    <li className="group/ev relative flex gap-3 py-1.5 pl-1">
      <Punto estado={e.estado} />
      <span
        aria-hidden
        data-ultimo={esUltimo || undefined}
        className="absolute bottom-[-0.375rem] left-2 top-4 w-px bg-border data-[ultimo]:hidden"
      />
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-foreground">{e.rotulo}</span>
          {c.tag && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-warning">{c.tag}</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover/ev:opacity-100 group-focus-within/ev:opacity-100">
            {esIa && (
              <button
                type="button"
                aria-label="Corregir lo que la IA detectó"
                className="grid min-h-6 min-w-6 place-items-center rounded-md bg-warning/10 text-warning transition-colors hover:bg-warning/20"
              >
                <Pencil size={12} aria-hidden />
              </button>
            )}
            {esManual && (
              <>
                <button
                  type="button"
                  aria-label="Editar evento"
                  className="grid min-h-6 min-w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil size={12} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Borrar del timeline"
                  className="grid min-h-6 min-w-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 size={12} aria-hidden />
                </button>
              </>
            )}
          </span>
          <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {e.timestamp ? formatearHora(e.timestamp) : ''}
          </time>
        </div>
        {e.valor && <p className="mt-0.5 truncate text-xs text-muted-foreground">{e.valor}</p>}
      </div>
    </li>
  );
}
