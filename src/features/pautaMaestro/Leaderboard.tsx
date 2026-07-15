import { veredicto } from './analisis';
import StatusBadge from '../campaigns/StatusBadge';
import { sectionLabel } from '../../lib/styles';

/**
 * Fila genérica de ranking: no sabe si representa una campaña o un anuncio —
 * eso lo decide quien arma `filas` (`PautaCompararPage`). Así el mismo
 * componente sirve para el ranking de campañas (n≥2) y para el pivote a
 * ranking de anuncios cuando hay una sola campaña seleccionada.
 */
export interface FilaRanking {
  id: string;
  nombre: string;
  estado: string;
  score: number;
  quemados: number;
}

interface Props {
  titulo: string;
  filas: FilaRanking[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}

export default function Leaderboard({ titulo, filas, hoveredId, onHover, onSelect }: Props) {
  if (filas.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className={sectionLabel + ' mb-3'}>{titulo}</div>
        <p className="py-6 text-center text-sm text-muted-foreground">Sin datos para rankear todavía.</p>
      </div>
    );

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className={sectionLabel + ' mb-3'}>{titulo}</div>
      <div className="flex flex-col">
        {filas.map((f, i) => {
          const v = veredicto(f);
          const activo = hoveredId === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onMouseEnter={() => onHover(f.id)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onSelect(f.id)}
              className={
                'flex items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors ' +
                (activo ? 'bg-secondary' : 'hover:bg-muted')
              }
            >
              <span
                className={
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ' +
                  (i === 0 ? 'bg-gold/15 text-gold-ink' : 'bg-muted text-muted-foreground')
                }
              >
                {i + 1}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-foreground" title={f.nombre}>
                    {f.nombre}
                  </span>
                  <StatusBadge status={f.estado} />
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(6, f.score)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">{f.score}</span>
                </div>
              </div>

              <span className={'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ' + v.clase}>
                {v.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
