import { useState } from 'react';
import type { FilaAd, FilaAdset } from '../types';
import HeatmapTabla, { type ColumnaHeat } from './HeatmapTabla';
import { fmtMoney, fmtNum, fmtPct } from '../../../lib/utils';

type Tab = 'creativos' | 'conjuntos';

const COLS_CREATIVO: ColumnaHeat[] = [
  { key: 'gasto', label: 'Gasto', extraer: (a: FilaAd) => a.gasto, mejorEsMenor: false, fmt: (v) => fmtMoney(v, '') },
  { key: 'res', label: 'Resultados', extraer: (a: FilaAd) => a.resultados, mejorEsMenor: false, fmt: (v) => fmtNum(v) },
  { key: 'cpa', label: 'CPA', extraer: (a: FilaAd) => a.costoPorResultado, mejorEsMenor: true, fmt: (v) => fmtMoney(v, '') },
  { key: 'ctr', label: 'CTR', extraer: (a: FilaAd) => a.ctr, mejorEsMenor: false, fmt: (v) => fmtPct(v) },
  { key: 'cpc', label: 'CPC', extraer: (a: FilaAd) => a.cpc, mejorEsMenor: true, fmt: (v) => fmtMoney(v, '') },
  { key: 'cpm', label: 'CPM', extraer: (a: FilaAd) => a.cpm, mejorEsMenor: true, fmt: (v) => fmtMoney(v, '') },
  { key: 'freq', label: 'Frec.', extraer: (a: FilaAd) => a.frecuencia, mejorEsMenor: false, fmt: (v) => v.toFixed(2) },
  { key: 'fat', label: 'Fatiga', extraer: (a: FilaAd) => (a.fatiga ? 1 : 0), mejorEsMenor: true, render: (a: FilaAd) => (a.fatiga ? <span className="font-semibold text-destructive">sí</span> : '—') },
];

const COLS_ADSET: ColumnaHeat[] = [
  { key: 'gasto', label: 'Gasto', extraer: (a: FilaAdset) => a.gasto, mejorEsMenor: false, fmt: (v) => fmtMoney(v, '') },
  { key: 'res', label: 'Resultados', extraer: (a: FilaAdset) => a.resultados, mejorEsMenor: false, fmt: (v) => fmtNum(v) },
  { key: 'cpa', label: 'CPA', extraer: (a: FilaAdset) => a.costoPorResultado, mejorEsMenor: true, fmt: (v) => fmtMoney(v, '') },
  { key: 'ctr', label: 'CTR', extraer: (a: FilaAdset) => a.ctr, mejorEsMenor: false, fmt: (v) => fmtPct(v) },
];

const TABS: { id: Tab; label: string }[] = [
  { id: 'creativos', label: 'Creativos' },
  { id: 'conjuntos', label: 'Conjuntos' },
];

/**
 * Rankings de creativos, anuncios y conjuntos con heatmap de fondo. Permite al
 * estratega responder en segundos: qué creativo convierte más, cuál tiene el
 * mejor CTR y cuál consume presupuesto sin resultados.
 */
export default function Rankings({
  ads,
  adsets,
}: {
  ads: FilaAd[];
  adsets: FilaAdset[];
}) {
  const [tab, setTab] = useState<Tab>('creativos');

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-bold text-navy">Rankings</span>
        <div className="inline-flex overflow-hidden rounded-lg border border-border">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                'px-3 py-1.5 text-xs font-semibold ' +
                (tab === t.id ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'creativos' && (
        <HeatmapTabla
          columnas={COLS_CREATIVO}
          filas={ads}
          nombreFila={(a: FilaAd) => (
            <span className="inline-flex items-center gap-1.5">
              {a.thumbnailUrl ? (
                <img src={a.thumbnailUrl} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
              ) : (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">—</span>
              )}
              <span className="truncate" title={a.nombre}>{a.nombre}</span>
            </span>
          )}
          subtitulo={(a: FilaAd) => a.campanaNombre}
        />
      )}

      {tab === 'conjuntos' && (
        <HeatmapTabla
          columnas={COLS_ADSET}
          filas={adsets}
          nombreFila={(a: FilaAdset) => <span className="truncate" title={a.nombre}>{a.nombre}</span>}
          subtitulo={(a: FilaAdset) => a.campanaNombre}
        />
      )}
    </div>
  );
}
