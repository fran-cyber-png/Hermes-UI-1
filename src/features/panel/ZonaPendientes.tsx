import { Plus } from 'lucide-react';
import type { CampoPendiente } from './timeline';

/**
 * Lo que falta no es un evento: es una tarea. Separada de la actividad, sin
 * caja y sin pill «Pendiente» — el título de la zona ya lo dice.
 */
export function ZonaPendientes({
  pendientes,
  progreso,
  onAgregar,
}: {
  pendientes: CampoPendiente[];
  progreso: number;
  onAgregar?: (campo: string) => void;
}) {
  if (pendientes.length === 0) return null;

  return (
    <section aria-label="Por completar" className="mb-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Por completar
        </h3>
        <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{progreso}%</span>
      </div>
      <ul className="mt-1.5">
        {pendientes.map((p) => (
          <li key={p.campo} className="flex items-center gap-2 py-0.5">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{p.campo}</span>
            {onAgregar && (
              <button
                type="button"
                aria-label={`Agregar ${p.campo}`}
                onClick={() => onAgregar(p.campo)}
                className="grid min-h-6 min-w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
