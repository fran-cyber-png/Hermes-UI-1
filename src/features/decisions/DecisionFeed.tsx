import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useLocalStorage } from '../../lib/useLocalStorage';
import { fetchDecisiones } from './api';
import type { Decision } from './types';
import DecisionCard from './DecisionCard';
import RangoPicker from '../canales/RangoPicker';
import type { Rango } from '../canales/types';

interface Props {
  accountIds: string[];
}

export default function DecisionFeed({ accountIds }: Props) {
  // El MISMO rango que el dashboard, y la misma clave: si en el home miras 90
  // días, aquí también. Tener dos rangos distintos con dos vocabularios distintos
  // ('90d' vs 'last_90d') era pedirle al usuario que tradujera.
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');
  const [ignoradas, setIgnoradas] = useLocalStorage<string[]>('meta-escuela.decisionesIgnoradas', []);

  const [decisiones, setDecisiones] = useState<Decision[]>([]);
  const [modo, setModo] = useState<'simulacion' | 'ejecucion'>('simulacion');
  const [analizadas, setAnalizadas] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accountIds.length === 0) return;
    let cancelado = false;
    setLoading(true);
    fetchDecisiones(accountIds, rango)
      .then((d) => {
        if (cancelado) return;
        setDecisiones(d.decisiones ?? []);
        setModo(d.modo);
        setAnalizadas(d.campanasAnalizadas ?? 0);
        setLoading(false);
      })
      .catch(() => !cancelado && setLoading(false));
    return () => {
      cancelado = true;
    };
  }, [accountIds, rango]);

  const visibles = decisiones.filter((d) => !ignoradas.includes(d.id));
  // El total va SIEMPRE en dólares. Sumar el gasto crudo mezclaba USD, COP y BOB en un mismo
  // número y le ponía la etiqueta de la primera moneda que apareciera. Las decisiones cuya moneda
  // no tiene tasa no se suman con un cero: se dicen aparte.
  const convertidas = visibles.filter((d) => d.plataEnJuegoUsd != null);
  const plataTotal = convertidas.reduce((s, d) => s + (d.plataEnJuegoUsd ?? 0), 0);
  const sinTasa = visibles.length - convertidas.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangoPicker valor={rango} onChange={setRango} />

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
              USD {plataTotal.toFixed(0)}
            </div>
            <p className="mt-1 text-sm text-navy-muted">
              en juego, repartidos en {visibles.length} decisión{visibles.length === 1 ? '' : 'es'} sobre{' '}
              {analizadas} campañas activas. Ordenadas por lo que más te cuesta.
              {sinTasa > 0 && (
                <>
                  {' '}
                  {sinTasa} {sinTasa === 1 ? 'queda' : 'quedan'} fuera del total: no tenemos tasa de
                  cambio para su moneda.
                </>
              )}
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
