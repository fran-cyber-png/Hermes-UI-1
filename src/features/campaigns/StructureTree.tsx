import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Globe, TrendingUp, UserMinus, Users } from 'lucide-react';
import { API_URL } from '../../config';
import type { Structure, StructAd, StructAdset } from './structureTypes';
import { EFICIENCIA_META, eficienciaDe, money, resultadosPerdidos } from './efficiency';
import { humanizeIndicator } from './constants';
import StatusBadge from './StatusBadge';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  campaignId: string;
  datePreset: string;
}

/** Barra de participación del gasto: cuánta plata se lleva esta fila. */
function ShareBar({ share, bar }: { share: number; bar: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(share * 100, 1)}%` }} />
    </div>
  );
}

/** Las cifras de una fila, iguales en los tres niveles para poder compararlas. */
function Metricas({
  spend,
  results,
  costPerResult,
  indicator,
  promedio,
  share,
}: {
  spend: number;
  results: number | null;
  costPerResult: number | null;
  indicator: string | null;
  promedio: number | null;
  share: number;
}) {
  const ef = eficienciaDe(costPerResult, promedio);
  const meta = EFICIENCIA_META[ef];

  return (
    <div className="flex shrink-0 items-center gap-5 text-right text-xs">
      <div className="w-24">
        <div className="font-mono font-semibold tabular-nums text-foreground">{money(spend)}</div>
        <div className="mt-1">
          <ShareBar share={share} bar={meta.bar} />
        </div>
        <div className="mt-0.5 text-muted-foreground">{Math.round(share * 100)}% del gasto</div>
      </div>

      <div className="w-20">
        <div className="font-mono font-semibold tabular-nums text-foreground">{results ?? '—'}</div>
        <div className="truncate text-muted-foreground">{indicator ? humanizeIndicator(indicator) : 'resultados'}</div>
      </div>

      <div className="w-24">
        <div className={`font-mono font-semibold tabular-nums ${meta.text}`}>{money(costPerResult)}</div>
        <div className={meta.text}>{meta.label}</div>
      </div>
    </div>
  );
}

function AdRow({ ad, promedio, total }: { ad: StructAd; promedio: number | null; total: number }) {
  return (
    <div className="flex items-center gap-3 border-t border-border py-3 pl-14 pr-4">
      {ad.thumbnail ? (
        <img src={ad.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-9 w-9 shrink-0 rounded bg-muted" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{ad.name}</div>
        <div className="text-xs text-muted-foreground">
          {ad.impressions.toLocaleString('es')} impresiones · {ad.clicks.toLocaleString('es')} clics
        </div>
      </div>
      <StatusBadge status={ad.status} />
      <Metricas
        spend={ad.spend}
        results={ad.results}
        costPerResult={ad.costPerResult}
        indicator={ad.resultIndicator}
        promedio={promedio}
        share={total > 0 ? ad.spend / total : 0}
      />
    </div>
  );
}

function AdsetRow({
  adset,
  promedio,
  total,
}: {
  adset: StructAdset;
  promedio: number | null;
  total: number;
}) {
  const [abierto, setAbierto] = useState(false);
  const sinExclusiones = adset.includedAudiences.length > 0 && adset.excludedAudiences.length === 0;

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 pl-8 text-left hover:bg-muted/50"
      >
        {abierto ? (
          <ChevronDown size={15} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
        )}

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground">{adset.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Globe size={11} /> {adset.countries.length} países
            </span>
            <span>
              {adset.ageMin}–{adset.ageMax} años
            </span>
            <span className="inline-flex items-center gap-1">
              <Users size={11} /> {adset.includedAudiences.length} públicos
            </span>
            {sinExclusiones ? (
              <span className="inline-flex items-center gap-1 font-semibold text-warning">
                <UserMinus size={11} /> sin exclusiones
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <UserMinus size={11} /> {adset.excludedAudiences.length} excluidos
              </span>
            )}
            <span>· {adset.ads.length} anuncios</span>
          </div>
        </div>

        <StatusBadge status={adset.status} />
        <Metricas
          spend={adset.spend}
          results={adset.results}
          costPerResult={adset.costPerResult}
          indicator={adset.resultIndicator}
          promedio={promedio}
          share={total > 0 ? adset.spend / total : 0}
        />
      </button>

      {abierto && (
        <div className="bg-muted/30">
          {sinExclusiones && (
            <div className="border-t border-warning/30 bg-warning/10 px-4 py-2 pl-14 text-xs text-warning">
              Este conjunto incluye {adset.includedAudiences.length} públicos y no excluye a nadie. Le estás pagando
              a Meta por mostrarle el anuncio a gente que ya se inscribió.
            </div>
          )}
          {adset.ads.map((ad) => (
            <AdRow key={ad.id} ad={ad} promedio={promedio} total={total} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function StructureTree({ campaignId, datePreset }: Props) {
  const [data, setData] = useState<Structure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/structure/${campaignId}?datePreset=${datePreset}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.type === 'api_error') setError(d.message);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError('No se pudo conectar con el servidor.');
        setLoading(false);
      });
  }, [campaignId, datePreset]);

  if (loading) return <p className="p-5 text-sm text-muted-foreground">Cargando la estructura...</p>;
  if (error) return <p className="p-5 text-sm text-destructive">{error}</p>;
  if (!data) return null;

  const { campaign, adsets } = data;
  const promedio = campaign.costPerResult;
  const total = campaign.spend;
  const fuga = resultadosPerdidos(adsets);

  return (
    <div className="flex flex-col gap-4">
      {/* Lo primero que se lee: la plata que se está dejando en la mesa. */}
      {fuga && (
        <div className="flex items-start gap-3 rounded-2xl border border-gold/40 bg-gold/10 p-4">
          <TrendingUp size={18} className="mt-0.5 shrink-0 text-gold-ink" />
          <div className="text-sm">
            <p className="font-bold text-foreground">
              Estás dejando ~{fuga.extra.toLocaleString('es')} resultados sobre la mesa.
            </p>
            <p className="mt-0.5 text-muted-foreground">
              Tu mejor conjunto trae resultados a <strong className="text-gold-ink">{money(fuga.mejorCpr)}</strong>,
              pero el presupuesto está repartido de otra forma. Si todo rindiera como el mejor, con la misma plata
              tendrías ~{fuga.extra.toLocaleString('es')} resultados más.
            </p>
          </div>
        </div>
      )}

      <div className={cardClass}>
        {/* ETAPA 1 — la campaña */}
        <div className={`${cardHeaderClass} flex items-center justify-between gap-4`}>
          <div className="min-w-0">
            <div className="truncate">{campaign.name}</div>
            <div className="mt-0.5 text-xs font-normal text-navy-muted">
              {adsets.length} conjuntos · {adsets.reduce((s, a) => s + a.ads.length, 0)} anuncios
              {campaign.dailyBudget ? ` · ${money(campaign.dailyBudget)}/día` : ''}
            </div>
          </div>
          <div className="flex shrink-0 gap-5 text-right text-xs">
            <div>
              <div className="font-mono text-base font-bold tabular-nums text-white">{money(campaign.spend)}</div>
              <div className="text-navy-muted">gastado</div>
            </div>
            <div>
              <div className="font-mono text-base font-bold tabular-nums text-white">{campaign.results ?? '—'}</div>
              <div className="text-navy-muted">resultados</div>
            </div>
            <div>
              <div className="font-mono text-base font-bold tabular-nums text-gold">
                {money(campaign.costPerResult)}
              </div>
              <div className="text-navy-muted">c/u</div>
            </div>
          </div>
        </div>

        {/* ETAPAS 2 y 3 — conjuntos, y adentro los anuncios */}
        {adsets.map((adset) => (
          <AdsetRow key={adset.id} adset={adset} promedio={promedio} total={total} />
        ))}

        {adsets.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">
            Esta campaña no tiene conjuntos de anuncios todavía.
          </p>
        )}
      </div>
    </div>
  );
}
