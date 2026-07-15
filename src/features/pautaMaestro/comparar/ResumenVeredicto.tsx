import { useMemo } from 'react';
import { AlertTriangle, Banknote, Trophy, TrendingUp } from 'lucide-react';
import type { PautaDetalle } from '../types';
import { aplanarAds, resumenInsights, resumenAlertas } from '../analisis';
import StatusBadge from '../../campaigns/StatusBadge';
import { sectionLabel } from '../../../lib/styles';
import { fmtMoney, fmtNum, fmtPct } from '../../../lib/utils';

function Kpi({ label, valor, alerta }: { label: string; valor: string; alerta?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={'mt-1 font-mono text-lg font-bold tabular-nums ' + (alerta ? 'text-destructive' : 'text-foreground')}>
        {valor}
      </div>
    </div>
  );
}

/**
 * La banda de resumen — reemplaza a InsightCards + los tiles de campaña de
 * DashboardInteligente + AutoInsights (los tres respondían "quién gana" con
 * los mismos 4 datos, en 3 formatos distintos). Con 2+ campañas selecciona-
 * das, el encabezado es "quién gana"; con 1 sola, se reenmarca a un resumen
 * de esa campaña (mismo patrón de tiles que `PautaDetallePage`) — no tiene
 * sentido decir "ganadora" cuando no hay nadie más con quien competir.
 */
export default function ResumenVeredicto({ detalles }: { detalles: PautaDetalle[] }) {
  const ads = useMemo(() => aplanarAds(detalles), [detalles]);
  const alertas = useMemo(() => resumenAlertas(ads), [ads]);
  const totalAlertas = alertas ? alertas.quemados + alertas.desperdicioCount : 0;

  if (detalles.length === 0) return null;

  if (detalles.length === 1) {
    const d = detalles[0];
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="font-heading text-lg font-bold text-navy">{d.nombre}</span>
          <StatusBadge status={d.estado} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Kpi label="Gasto" valor={fmtMoney(d.gasto, d.moneda)} />
          <Kpi label="Resultados" valor={fmtNum(d.resultados)} />
          <Kpi label="Costo / resultado" valor={d.costoPorResultado == null ? '—' : fmtMoney(d.costoPorResultado, d.moneda)} />
          <Kpi label="Alertas" valor={String(totalAlertas)} alerta={totalAlertas > 0} />
        </div>
      </div>
    );
  }

  const r = resumenInsights(detalles);

  const frase =
    r.masLeads && r.mejorCpa && r.masLeads.id === r.mejorCpa.id
      ? `${r.masLeads.nombre} lidera en volumen y además tiene el mejor CPA.`
      : r.masLeads && r.mejorCpa
        ? `${r.masLeads.nombre} lidera en volumen · ${r.mejorCpa.nombre} tiene el CPA más bajo.`
        : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={sectionLabel}>Ganadora</div>
          <div className="mt-1 flex items-center gap-2">
            <Trophy size={18} className="text-gold-ink" />
            <span className="font-heading text-2xl font-bold text-navy" title={r.mejorCampana?.nombre}>
              {r.mejorCampana?.nombre ?? '—'}
            </span>
          </div>
          <div className="mt-0.5 text-sm text-muted-foreground">
            {fmtNum(r.mejorCampana?.resultados)} resultados
          </div>
        </div>

        <div className="grid grid-cols-3 gap-5">
          <div className="flex items-center gap-2">
            <Banknote size={15} className="text-success" />
            <Kpi label="Mejor CPA" valor={r.mejorCpa ? fmtMoney(r.mejorCpa.costoPorResultado ?? 0, r.mejorCpa.moneda) : '—'} />
          </div>
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-primary" />
            <Kpi label="Mejor CTR" valor={r.mejorCtr ? fmtPct(r.mejorCtr.ctr) : '—'} />
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className={totalAlertas > 0 ? 'text-destructive' : 'text-muted-foreground'} />
            <Kpi label="Alertas" valor={String(totalAlertas)} alerta={totalAlertas > 0} />
          </div>
        </div>
      </div>

      {frase && <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">{frase}</p>}
    </div>
  );
}
