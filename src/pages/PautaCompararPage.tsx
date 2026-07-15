import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Flame, PauseCircle, SlidersHorizontal } from 'lucide-react';
import { fetchPautaMaestro, fetchPautaComparar, fetchPautaSnapshots } from '../features/pautaMaestro/api';
import CampaignMultiSelect from '../features/pautaMaestro/CampaignMultiSelect';
import Leaderboard, { type FilaRanking } from '../features/pautaMaestro/Leaderboard';
import CompararChart from '../features/pautaMaestro/CompararChart';
import CompararTabla from '../features/pautaMaestro/CompararTabla';
import { MetricToggle, type MetricaComparar } from '../features/pautaMaestro/MetricToggle';
import Volver from '../layout/Volver';
import { sectionLabel } from '../lib/styles';
import { fmtMoney } from '../lib/utils';
import type { RangoFiltro } from '../features/pautaMaestro/types';
import { aplanarAds, aplanarAdsets, analizarCampanas, analizarAds, resumenAlertas } from '../features/pautaMaestro/analisis';
import CreativeCards from '../features/pautaMaestro/comparar/CreativeCards';
import Rankings from '../features/pautaMaestro/comparar/Rankings';
import EficienciaChart from '../features/pautaMaestro/comparar/EficienciaChart';
import ResumenVeredicto from '../features/pautaMaestro/comparar/ResumenVeredicto';

const RANGOS_COMPARAR: { valor: RangoFiltro; label: string }[] = [
  { valor: 'hoy', label: 'Hoy' },
  { valor: '7d', label: '7 días' },
  { valor: '30d', label: '30 días' },
  { valor: 'mes', label: 'Este mes' },
  { valor: 'mesPasado', label: 'Mes pasado' },
  { valor: 'todo', label: 'Todo' },
];

type Vista = 'campanas' | 'creativos';
const VISTAS: { valor: Vista; label: string }[] = [
  { valor: 'campanas', label: 'Campañas' },
  { valor: 'creativos', label: 'Creativos' },
];

function EstadoVacio({ texto }: { texto: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
      {texto}
    </div>
  );
}

export default function PautaCompararPage() {
  const maestro = useQuery({ queryKey: ['pauta-maestro'], queryFn: () => fetchPautaMaestro('todo') });
  const [params, setParams] = useSearchParams();

  const iniciales = (params.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const vista: Vista = params.get('vista') === 'creativos' ? 'creativos' : 'campanas';

  const [seleccionados, setSeleccionados] = useState<string[]>(iniciales);
  const [metrica, setMetrica] = useState<MetricaComparar>('gasto');
  const [rango, setRango] = useState<RangoFiltro>('30d');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);

  const campanas = maestro.data?.campanas ?? [];

  const comparar = useQuery({
    queryKey: ['pauta-comparar', seleccionados.join(','), rango],
    queryFn: () => fetchPautaComparar(seleccionados, rango),
    enabled: seleccionados.length > 0,
  });

  const snapshots = useQuery({
    queryKey: ['pauta-snapshots', rango],
    queryFn: () => fetchPautaSnapshots(rango),
    enabled: seleccionados.length > 0,
  });

  const moneda = comparar.data?.detalles[0]?.moneda ?? '';
  const detalles = comparar.data?.detalles ?? [];
  const puntos = snapshots.data?.puntos ?? [];
  const n = detalles.length;

  const ads = useMemo(() => aplanarAds(detalles), [detalles]);
  const adsets = useMemo(() => aplanarAdsets(detalles), [detalles]);
  const alertas = useMemo(() => resumenAlertas(ads), [ads]);

  // El pivote: con 2+ campañas se rankean campañas; con 1 sola ya no hay nadie
  // más con quien comparar a ESE nivel, así que se rankean sus anuncios entre sí.
  const filasRanking: FilaRanking[] = useMemo(() => {
    if (n >= 2) {
      return analizarCampanas(detalles).map((a) => ({
        id: a.detalle.id,
        nombre: a.detalle.nombre,
        estado: a.detalle.estado,
        score: a.score,
        quemados: a.quemados,
      }));
    }
    return analizarAds(ads).map((a) => ({
      id: a.fila.id,
      nombre: a.fila.nombre,
      estado: a.fila.estado,
      score: a.score,
      quemados: a.quemados,
    }));
  }, [n, detalles, ads]);

  const haySeleccion = seleccionados.length > 0;
  const cargando = comparar.isPending;

  const irAVista = (v: Vista) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set('vista', v);
        return p;
      },
      { replace: true },
    );
  };

  let cuerpo;
  if (!haySeleccion) {
    cuerpo = <EstadoVacio texto="Seleccioná una o más campañas de la lista para ver la comparación." />;
  } else if (cargando) {
    cuerpo = <EstadoVacio texto="Cargando comparación…" />;
  } else if (vista === 'campanas') {
    cuerpo = (
      <>
        <ResumenVeredicto detalles={detalles} />

        <Leaderboard
          titulo={n >= 2 ? 'Ranking de campañas' : 'Ranking de anuncios de esta campaña'}
          filas={filasRanking}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          onSelect={setHoveredId}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={sectionLabel}>Evolución en el tiempo</span>
          <MetricToggle valor={metrica} onChange={setMetrica} />
        </div>
        <CompararChart
          snapshots={puntos}
          detalles={detalles}
          metrica={metrica}
          moneda={moneda}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />

        {n >= 2 ? (
          <EficienciaChart modo="campanas" detalles={detalles} moneda={moneda} hoveredId={hoveredId} onHover={setHoveredId} />
        ) : (
          <EficienciaChart modo="anuncios" ads={ads} moneda={moneda} hoveredId={hoveredId} onHover={setHoveredId} />
        )}

        <details className="rounded-2xl border border-border bg-card shadow-sm">
          <summary className="cursor-pointer select-none px-5 py-3 text-sm font-bold text-navy">
            Ver detalle completo
          </summary>
          <div className="px-5 pb-5">
            {n >= 2 ? (
              <CompararTabla modo="campanas" detalles={detalles} snapshots={puntos} />
            ) : (
              <CompararTabla modo="anuncios" ads={ads} />
            )}
          </div>
        </details>
      </>
    );
  } else {
    cuerpo = (
      <>
        {alertas && (
          <div className="flex flex-wrap gap-2">
            {alertas.quemados > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive">
                <Flame size={13} />
                {alertas.quemados} {alertas.quemados === 1 ? 'creativo fatigado' : 'creativos fatigados'}
              </span>
            )}
            {alertas.desperdicioCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning">
                <PauseCircle size={13} />
                {alertas.desperdicioCount} sin resultados · {fmtMoney(alertas.desperdicioGasto, alertas.moneda)}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={sectionLabel}>Creativos</span>
        </div>
        <CreativeCards ads={ads} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={sectionLabel}>Rankings detallados</span>
        </div>
        <Rankings ads={ads} adsets={adsets} />
      </>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <Volver a="/pauta-maestro" texto="Volver al maestro" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading mb-1 text-2xl font-bold text-navy">Comparar campañas</h1>
          <p className="text-sm text-muted-foreground">
            El estado de tus campañas en menos de 5 segundos: quién gana, qué escalar y qué revisar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-border">
            {RANGOS_COMPARAR.map((r) => (
              <button
                key={r.valor}
                type="button"
                onClick={() => setRango(r.valor)}
                className={
                  'px-2.5 py-1.5 text-xs font-semibold ' +
                  (rango === r.valor ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFiltrosAbiertos(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/70 lg:hidden"
          >
            <SlidersHorizontal size={14} />
            Campañas ({seleccionados.length})
          </button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <aside className="hidden lg:block">
          <div className="sticky top-4">
            <CampaignMultiSelect campanas={campanas} seleccionados={seleccionados} onChange={setSeleccionados} />
          </div>
        </aside>

        <div className="flex flex-col gap-5">
          {haySeleccion && !cargando && (
            <div className="inline-flex w-fit overflow-hidden rounded-lg border border-border">
              {VISTAS.map((v) => (
                <button
                  key={v.valor}
                  type="button"
                  onClick={() => irAVista(v.valor)}
                  className={
                    'px-4 py-1.5 text-sm font-semibold ' +
                    (vista === v.valor ? 'bg-navy text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')
                  }
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}
          {cuerpo}
        </div>
      </div>

      {filtrosAbiertos && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setFiltrosAbiertos(false)} />
          <div className="relative ml-auto h-full w-[88%] max-w-sm overflow-y-auto bg-background p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-navy">Campañas</span>
              <button
                type="button"
                onClick={() => setFiltrosAbiertos(false)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
              >
                Cerrar
              </button>
            </div>
            <CampaignMultiSelect campanas={campanas} seleccionados={seleccionados} onChange={setSeleccionados} />
          </div>
        </div>
      )}
    </div>
  );
}
