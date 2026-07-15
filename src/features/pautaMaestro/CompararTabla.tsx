import type { PautaDetalle, PuntoSnapshotPauta, FilaAd } from './types';
import { analizarCampanas, analizarAds, veredicto, type AnalisisCampana, type AnalisisAd } from './analisis';
import { serieDesdeSnapshots, TrendSpark } from './spark';
import { colorForId } from './chartPalette';
import HeatmapTabla, { type ColumnaHeat } from './comparar/HeatmapTabla';
import StatusBadge from '../campaigns/StatusBadge';
import { fmtMoney, fmtNum, fmtPct } from '../../lib/utils';

function badge(a: { score: number; quemados: number }) {
  const v = veredicto(a);
  return <span className={'rounded-full px-2 py-0.5 text-xs font-semibold ' + v.clase}>{v.label}</span>;
}

type Props =
  | {
      modo: 'campanas';
      detalles: PautaDetalle[];
      snapshots: PuntoSnapshotPauta[];
    }
  | {
      modo: 'anuncios';
      ads: FilaAd[];
    };

/**
 * El detalle exhaustivo, en el cajón "Avanzado": una fila por campaña (n≥2) o,
 * en el pivote de 1 sola campaña, una fila por anuncio de esa campaña. Único
 * motor de heatmap de la página — antes esta tabla reimplementaba su propia
 * función `heat()` con umbrales ligeramente distintos a `HeatmapTabla`.
 */
export default function CompararTabla(props: Props) {
  if (props.modo === 'campanas') {
    const { detalles, snapshots } = props;
    const analizadas = analizarCampanas(detalles);
    const ids = detalles.map((d) => d.id);

    const columnas: ColumnaHeat[] = [
      { key: 'gasto', label: 'Gasto', mejorEsMenor: false, extraer: (a: AnalisisCampana) => a.detalle.gasto, render: (a: AnalisisCampana) => fmtMoney(a.detalle.gasto, a.detalle.moneda) },
      { key: 'res', label: 'Resultados', mejorEsMenor: false, extraer: (a: AnalisisCampana) => a.detalle.resultados, fmt: (v) => fmtNum(v) },
      { key: 'cpa', label: 'CPA', mejorEsMenor: true, extraer: (a: AnalisisCampana) => a.detalle.costoPorResultado, render: (a: AnalisisCampana) => a.detalle.costoPorResultado == null ? '—' : fmtMoney(a.detalle.costoPorResultado, a.detalle.moneda) },
      { key: 'ctr', label: 'CTR', mejorEsMenor: false, extraer: (a: AnalisisCampana) => a.ctr, fmt: (v) => fmtPct(v) },
      { key: 'freq', label: 'Frec.', mejorEsMenor: false, extraer: (a: AnalisisCampana) => a.frecuencia, fmt: (v) => v.toFixed(2) },
      { key: 'score', label: 'Score', heat: false, extraer: (a: AnalisisCampana) => a.score, render: (a: AnalisisCampana) => <span className="font-bold text-navy">{a.score}</span> },
      { key: 'quemados', label: 'Creativos quemados', mejorEsMenor: true, extraer: (a: AnalisisCampana) => a.quemados, render: (a: AnalisisCampana) => a.quemados > 0 ? <span className="font-semibold text-destructive">{a.quemados}</span> : '0' },
      { key: 'tendencia', label: 'Tendencia', heat: false, extraer: () => null, render: (a: AnalisisCampana) => <TrendSpark datos={serieDesdeSnapshots(snapshots, a.detalle.id, 'resultados')} color={colorForId(a.detalle.id, ids)} /> },
      { key: 'accion', label: 'Acción', heat: false, extraer: () => null, render: badge },
    ];

    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 text-sm font-bold text-navy">Detalle comparado</div>
        <HeatmapTabla
          columnas={columnas}
          filas={analizadas}
          nombreFila={(a: AnalisisCampana) => (
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForId(a.detalle.id, ids) }} />
              <span className="max-w-[180px] truncate" title={a.detalle.nombre}>{a.detalle.nombre}</span>
            </span>
          )}
          subtitulo={(a: AnalisisCampana) => <StatusBadge status={a.detalle.estado} />}
        />
      </div>
    );
  }

  const { ads } = props;
  const analizadas = analizarAds(ads);
  const adIds = ads.map((a) => a.id);

  const columnas: ColumnaHeat[] = [
    { key: 'gasto', label: 'Gasto', mejorEsMenor: false, extraer: (a: AnalisisAd) => a.fila.gasto, render: (a: AnalisisAd) => fmtMoney(a.fila.gasto, a.fila.moneda) },
    { key: 'res', label: 'Resultados', mejorEsMenor: false, extraer: (a: AnalisisAd) => a.fila.resultados, fmt: (v) => fmtNum(v) },
    { key: 'cpa', label: 'CPA', mejorEsMenor: true, extraer: (a: AnalisisAd) => a.fila.costoPorResultado, render: (a: AnalisisAd) => a.fila.costoPorResultado == null ? '—' : fmtMoney(a.fila.costoPorResultado, a.fila.moneda) },
    { key: 'ctr', label: 'CTR', mejorEsMenor: false, extraer: (a: AnalisisAd) => a.fila.ctr, fmt: (v) => fmtPct(v) },
    { key: 'score', label: 'Score', heat: false, extraer: (a: AnalisisAd) => a.score, render: (a: AnalisisAd) => <span className="font-bold text-navy">{a.score}</span> },
    { key: 'fatiga', label: 'Fatiga', heat: false, extraer: (a: AnalisisAd) => a.quemados, render: (a: AnalisisAd) => a.quemados ? <span className="font-semibold text-destructive">sí</span> : '—' },
    { key: 'accion', label: 'Acción', heat: false, extraer: () => null, render: badge },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 text-sm font-bold text-navy">Detalle por anuncio</div>
      <HeatmapTabla
        columnas={columnas}
        filas={analizadas}
        nombreFila={(a: AnalisisAd) => (
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForId(a.fila.id, adIds) }} />
            <span className="max-w-[180px] truncate" title={a.fila.nombre}>{a.fila.nombre}</span>
          </span>
        )}
        subtitulo={(a: AnalisisAd) => <StatusBadge status={a.fila.estado} />}
      />
    </div>
  );
}
