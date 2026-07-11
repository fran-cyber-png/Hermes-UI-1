import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  titulo: string;
  filas: { etiqueta: string; valor: number }[];
  formatoEtiqueta?: (s: string) => string;
}

export default function DesgloseBars({ titulo, filas, formatoEtiqueta }: Props) {
  if (filas.length === 0) return null;
  const max = Math.max(...filas.map((f) => f.valor));

  return (
    <div className={cardClass}>
      <div className={cardHeaderClass}>{titulo}</div>
      <div className="flex flex-col gap-2.5 p-5">
        {filas.map((f) => (
          <div key={f.etiqueta} className="flex items-center gap-3 text-sm">
            <span className="w-40 shrink-0 truncate text-muted-foreground" title={f.etiqueta}>
              {formatoEtiqueta ? formatoEtiqueta(f.etiqueta) : f.etiqueta}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max((f.valor / max) * 100, 2)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
              {f.valor}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
