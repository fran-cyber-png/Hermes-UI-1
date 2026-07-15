/**
 * Solo las 3 métricas que el snapshot histórico (`PuntoSnapshotPauta.campanas[]`)
 * realmente trae. `ctr`/`frecuencia`/`cpm`/`roas` no existen ahí — ofrecerlas acá
 * dibujaba una línea siempre en null, un toggle que mentía.
 */
export type MetricaComparar = 'gasto' | 'resultados' | 'costoPorResultado';

export const METRICAS: { valor: MetricaComparar; label: string }[] = [
  { valor: 'gasto', label: 'Gasto' },
  { valor: 'resultados', label: 'Resultados' },
  { valor: 'costoPorResultado', label: 'CPA' },
];

export function metricaLabel(m: MetricaComparar) {
  return METRICAS.find((x) => x.valor === m)?.label ?? m;
}

export function MetricToggle({
  valor,
  onChange,
}: {
  valor: MetricaComparar;
  onChange: (m: MetricaComparar) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-border">
      {METRICAS.map((mt) => (
        <button
          key={mt.valor}
          type="button"
          onClick={() => onChange(mt.valor)}
          className={
            'px-3 py-1.5 text-xs font-semibold ' +
            (valor === mt.valor
              ? 'bg-navy text-white'
              : 'bg-muted text-muted-foreground hover:bg-muted/70')
          }
        >
          {mt.label}
        </button>
      ))}
    </div>
  );
}
