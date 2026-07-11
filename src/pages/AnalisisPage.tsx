import { useEffect, useState } from 'react';
import { API_URL } from '../config';
import { useLocalStorage } from '../lib/useLocalStorage';
import type { CanalesResponse, Rango } from '../features/canales/types';
import RangoPicker from '../features/canales/RangoPicker';
import FlujoChart from '../features/canales/FlujoChart';
import type { CostoResponse } from '../features/leads/costoTypes';
import CostoPorLeadCard from '../features/leads/CostoPorLeadCard';
import DecisionesPendientesCard from '../features/decisions/DecisionesPendientesCard';

const NOMBRE: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
};

/**
 * Entender, no actuar. Es la contraparte de la bandeja.
 *
 * Aquí el rango de fechas manda sobre todo lo que puede depender de él, y lo
 * que NO puede (la plata, que Meta reporta sobre toda la vida del anuncio) vive
 * separado y lo dice. Mezclarlos en una sola pantalla era lo que hacía que los
 * números se contradijeran.
 */
export default function AnalisisPage() {
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');
  const [estado, setEstado] = useState<CanalesResponse | null>(null);
  const [costo, setCosto] = useState<CostoResponse | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch(`${API_URL}/api/interactions/canales?rango=${rango}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelado) setEstado(d);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [rango]);

  useEffect(() => {
    fetch(`${API_URL}/api/leads/costo`)
      .then((r) => r.json())
      .then((d) => setCosto(d.totales ? d : null))
      .catch(() => setCosto(null));
  }, []);

  const canales = estado?.interacciones ?? [];
  const total = canales.reduce((s, c) => s + c.total, 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading mb-1 text-2xl font-bold text-navy">Análisis</h1>
          <p className="text-sm text-muted-foreground">
            Qué entró, por dónde, y cuánto costó traerlo.
          </p>
        </div>
        <RangoPicker valor={rango} onChange={setRango} />
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-heading text-sm font-bold text-navy">Qué entró en este período</h2>

        {/* Los totales por canal, que antes eran los números gigantes de cada
            columna. Aquí son lo que siempre fueron: contexto, no una tarea. */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="font-heading text-2xl font-extrabold tabular-nums text-navy">
              {total.toLocaleString('es')}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-muted-foreground">interacciones</p>
          </div>

          {canales.map((c) => (
            <div key={c.canal} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="font-heading text-2xl font-extrabold tabular-nums text-foreground">
                {c.total.toLocaleString('es')}
              </p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                {NOMBRE[c.canal] ?? c.canal} · {c.pide_info.toLocaleString('es')} piden info
              </p>
            </div>
          ))}
        </div>

        <FlujoChart porDia={estado?.porDia ?? []} rango={rango} />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <div>
          <h2 className="font-heading text-sm font-bold text-navy">Lo que costó traerlos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Meta reporta el gasto sobre toda la vida de cada anuncio, así que esto no depende del
            rango de arriba.
          </p>
        </div>

        <DecisionesPendientesCard />
        {costo && <CostoPorLeadCard porAnuncio={costo.porAnuncio} />}
      </section>
    </div>
  );
}
