import { AlertTriangle, Flame, PauseCircle, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FilaAd } from '../types';
import StatusBadge from '../../campaigns/StatusBadge';
import { fmtMoney, fmtNum, fmtPct } from '../../../lib/utils';

function veredictoCreativo(ad: FilaAd): { label: string; clase: string; icono: ReactNode } {
  if (ad.fatiga && (ad.gasto ?? 0) > 0)
    return { label: 'Fatigado', clase: 'bg-destructive/10 text-destructive', icono: <AlertTriangle size={12} /> };
  if ((ad.resultados ?? 0) > 0 && (ad.costoPorResultado ?? Infinity) < Infinity && (ad.ctr ?? 0) >= 1)
    return { label: 'Escalar', clase: 'bg-success/10 text-success', icono: <TrendingUp size={12} /> };
  if ((ad.gasto ?? 0) > 0 && (ad.resultados ?? 0) === 0)
    return { label: 'Sin resultados', clase: 'bg-warning/10 text-warning', icono: <PauseCircle size={12} /> };
  return { label: 'OK', clase: 'bg-primary/10 text-primary', icono: null };
}

const METRAS = [
  { label: 'CTR', get: (a: FilaAd) => fmtPct(a.ctr) },
  { label: 'CPC', get: (a: FilaAd) => (a.cpc == null ? '—' : fmtMoney(a.cpc, a.moneda)) },
  { label: 'CPA', get: (a: FilaAd) => (a.costoPorResultado == null ? '—' : fmtMoney(a.costoPorResultado, a.moneda)) },
  { label: 'Resultados', get: (a: FilaAd) => fmtNum(a.resultados) },
  { label: 'CPM', get: (a: FilaAd) => (a.cpm == null ? '—' : fmtMoney(a.cpm, a.moneda)) },
  { label: 'Freq.', get: (a: FilaAd) => (a.frecuencia == null ? '—' : a.frecuencia.toFixed(2)) },
  { label: 'Gasto', get: (a: FilaAd) => fmtMoney(a.gasto, a.moneda) },
  { label: 'Alcance', get: (a: FilaAd) => fmtNum(a.alcance) },
  { label: 'Impres.', get: (a: FilaAd) => fmtNum(a.impresiones) },
  { label: 'Leads', get: (a: FilaAd) => fmtNum(a.leads) },
  { label: 'Reacciones', get: (a: FilaAd) => fmtNum(a.reacciones) },
  { label: 'Comentarios', get: (a: FilaAd) => fmtNum(a.comentarios) },
  { label: 'Compartidos', get: (a: FilaAd) => fmtNum(a.compartidos) },
  { label: 'Guardados', get: (a: FilaAd) => fmtNum(a.guardados) },
];

/**
 * Tarjetas de creativo con miniatura. Cada tarjeta responde de inmediato a las
 * preguntas del estratega: qué creativo convierte, cuál tiene el mejor CTR y
 * cuál está quemando presupuesto sin resultados.
 */
export default function CreativeCards({ ads }: { ads: FilaAd[] }) {
  if (ads.length === 0)
    return <p className="py-8 text-center text-sm text-muted-foreground">No hay creativos con datos en este set.</p>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {ads.map((ad) => {
        const v = veredictoCreativo(ad);
        return (
          <div key={ad.id} className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="relative aspect-video w-full overflow-hidden bg-muted">
              {ad.thumbnailUrl ? (
                <img src={ad.thumbnailUrl} alt={ad.nombre} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                  Sin miniatura
                </div>
              )}
              <span className={'absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ' + v.clase}>
                {v.icono}
                {v.label}
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-foreground" title={ad.nombre}>{ad.nombre}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge status={ad.estado} />
                  <span className="truncate text-xs text-muted-foreground" title={ad.campanaNombre}>{ad.campanaNombre}</span>
                </div>
              </div>

              {ad.fatiga && (ad.fatigaDeltaCtr != null || ad.fatigaDeltaFrecuencia != null) && (
                <div className="flex items-center gap-1.5 rounded-lg bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
                  <Flame size={13} />
                  <span>
                    CTR {(ad.fatigaDeltaCtr ?? 0) >= 0 ? '+' : ''}
                    {(ad.fatigaDeltaCtr ?? 0) * 100 >= 0 ? '+' : ''}
                    {((ad.fatigaDeltaCtr ?? 0) * 100).toFixed(0)}% · Freq{' '}
                    {((ad.fatigaDeltaFrecuencia ?? 0) * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 border-t border-border pt-2">
                {METRAS.map((m) => (
                  <div key={m.label}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{m.label}</div>
                    <div className="text-sm font-semibold tabular-nums text-foreground">{m.get(ad)}</div>
                  </div>
                ))}
              </div>

              {(ad.title || ad.body) && (
                <p className="line-clamp-2 text-xs text-muted-foreground">{ad.title ?? ad.body}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
