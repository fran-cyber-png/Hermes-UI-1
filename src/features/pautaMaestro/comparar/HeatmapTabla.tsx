import type { ReactNode } from 'react';

export interface ColumnaHeat {
  key: string;
  label: string;
  mejorEsMenor?: boolean;
  extraer: (fila: any) => number | null;
  render?: (fila: any) => ReactNode;
  moneda?: boolean;
  fmt?: (v: number) => string;
  /** false para columnas que ya llevan su propio color (badge de veredicto, sparkline) — sin fondo de heatmap detrás. Default true. */
  heat?: boolean;
}

function heatClass(valor: number | null, vals: (number | null)[], mejorEsMenor: boolean) {
  if (valor == null) return '';
  const finitos = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (finitos.length < 2) return '';
  const min = Math.min(...finitos);
  const max = Math.max(...finitos);
  if (max === min) return '';
  const t = (valor - min) / (max - min);
  const n = mejorEsMenor ? 1 - t : t;
  if (n > 0.78) return 'bg-success/15 text-success-foreground';
  if (n > 0.55) return 'bg-success/5';
  if (n < 0.22) return 'bg-destructive/15 text-destructive-foreground';
  if (n < 0.45) return 'bg-destructive/5';
  return '';
}

/**
 * Tabla con heatmap de fondo por celda: verde = mejor valor del set, rojo = peor.
 * Sirve para detectar de inmediato creativos sobresalientes o críticos.
 */
export default function HeatmapTabla({
  columnas,
  filas,
  nombreFila,
  subtitulo,
}: {
  columnas: ColumnaHeat[];
  filas: any[];
  nombreFila: (fila: any) => ReactNode;
  subtitulo?: (fila: any) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Elemento
            </th>
            {columnas.map((c) => (
              <th key={c.key} className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="sticky left-0 z-10 bg-card px-3 py-2.5">
                <div className="font-semibold text-foreground">{nombreFila(f)}</div>
                {subtitulo && <div className="mt-0.5 text-xs text-muted-foreground">{subtitulo(f)}</div>}
              </td>
              {columnas.map((c) => {
                const valor = c.extraer(f);
                const vals = filas.map((x) => c.extraer(x));
                const txt = c.render
                  ? c.render(f)
                  : valor == null
                    ? '—'
                    : c.fmt
                      ? c.fmt(valor)
                      : valor.toLocaleString('es');
                return (
                  <td
                    key={c.key}
                    className={
                      'px-3 py-2.5 text-right tabular-nums ' +
                      (c.heat === false ? '' : heatClass(valor, vals, c.mejorEsMenor ?? false))
                    }
                  >
                    {txt}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
