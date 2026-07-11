import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { fetchDecisiones } from './api';
import type { Decision } from './types';
import DecisionCard from './DecisionCard';
import DateRangePicker from '../campaigns/DateRangePicker';
import type { DatePreset } from '../campaigns/types';

interface Props {
  accountIds: string[];
}

export default function DecisionFeed({ accountIds }: Props) {
  const [datePreset, setDatePreset] = useLocalStorage<DatePreset>('meta-escuela.feedRango', 'last_30d');
  const [ignoradas, setIgnoradas] = useLocalStorage<string[]>('meta-escuela.decisionesIgnoradas', []);

  const [decisiones, setDecisiones] = useState<Decision[]>([]);
  const [modo, setModo] = useState<'simulacion' | 'ejecucion'>('simulacion');
  const [analizadas, setAnalizadas] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accountIds.length === 0) return;
    let cancelado = false;
    setLoading(true);
    fetchDecisiones(accountIds, datePreset).then((d) => {
      if (cancelado) return;
      setDecisiones(d.decisiones ?? []);
      setModo(d.modo);
      setAnalizadas(d.campanasAnalizadas ?? 0);
      setLoading(false);
    });
    return () => {
      cancelado = true;
    };
  }, [accountIds, datePreset]);

  const visibles = decisiones.filter((d) => !ignoradas.includes(d.id));
  const plataTotal = visibles.reduce((s, d) => s + d.plataEnJuego, 0);
  const moneda = visibles[0]?.moneda ?? '';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker value={datePreset} onChange={setDatePreset} />

        {modo === 'simulacion' && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
            <ShieldCheck size={13} className="text-temp-fresco" />
            Simulación — nada se escribe en Meta
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Analizando tus campañas activas...</p>
      ) : visibles.length === 0 ? (
        // El vacío también es información: significa que la pauta está sana.
        <div className="rounded-2xl border border-temp-fresco/40 bg-temp-fresco/5 p-8 text-center">
          <CheckCircle2 size={28} className="mx-auto mb-3 text-temp-fresco" />
          <h3 className="font-heading text-lg font-bold text-foreground">No hay nada que decidir</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisé {analizadas} campañas activas y no encontré plata mal repartida ni anuncios quemando presupuesto.
            {ignoradas.length > 0 && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => setIgnoradas([])}
                  className="font-semibold text-primary underline"
                >
                  Ver las {ignoradas.length} que ignoraste
                </button>
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          {/* La suma primero: cuánta plata hay en juego en total. */}
          <div className="rounded-2xl border border-border bg-navy p-5 text-white">
            <div className="font-heading text-3xl font-extrabold tabular-nums text-gold">
              {moneda} {plataTotal.toFixed(0)}
            </div>
            <p className="mt-1 text-sm text-navy-muted">
              en juego, repartidos en {visibles.length} decisión{visibles.length === 1 ? '' : 'es'} sobre{' '}
              {analizadas} campañas activas. Ordenadas por lo que más te cuesta.
            </p>
          </div>

          {visibles.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              modo={modo}
              onIgnorar={(id) => setIgnoradas([...ignoradas, id])}
            />
          ))}

          {ignoradas.length > 0 && (
            <button
              type="button"
              onClick={() => setIgnoradas([])}
              className="self-start text-sm font-semibold text-muted-foreground underline hover:text-foreground"
            >
              Volver a mostrar {ignoradas.length} ignorada{ignoradas.length === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
