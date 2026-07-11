import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { API_URL } from '../config';
import { useLocalStorage } from '../lib/useLocalStorage';
import type { CanalesResponse, Rango } from '../features/canales/types';
import RangoPicker from '../features/canales/RangoPicker';
import CanalesStrip from '../features/canales/CanalesStrip';
import BandejaResumen from '../features/canales/BandejaResumen';
import FlujoChart from '../features/canales/FlujoChart';
import type { CostoResponse } from '../features/leads/costoTypes';
import CostoPorLeadCard from '../features/leads/CostoPorLeadCard';
import DecisionesPendientesCard from '../features/decisions/DecisionesPendientesCard';

const ETIQUETA: Record<Rango, string> = {
  '7d': 'los últimos 7 días',
  '30d': 'los últimos 30 días',
  '90d': 'los últimos 90 días',
  '1y': 'el último año',
  todo: 'todo el histórico',
};

/**
 * El dashboard.
 *
 * UN rango de fechas, arriba, y manda sobre TODO lo que hay debajo: los canales,
 * el gráfico, y también la plata (el backend filtra los leads por fecha, y la
 * ventana de gasto que le pide a Meta se ajusta sola). Antes el dinero se
 * declaraba exento del filtro, y una sección que anuncia que ignora el control
 * de arriba no es honestidad: es incoherencia.
 *
 * La bandeja va al costado y es un MONITOR, no el trabajo: cuántos esperan, si
 * se están respondiendo, si sigue entrando gente. El trabajo en sí vive en su
 * propia pantalla, donde nada más compite por la atención.
 */
export default function HomePage() {
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');
  const [estado, setEstado] = useState<CanalesResponse | null>(null);

  // "cargando" y "no hay nada" son estados DISTINTOS. Colapsarlos en un null
  // hacía que un hueco en blanco se leyera como "esperá" cuando en realidad ya
  // era la respuesta: no llegó ningún formulario en este período.
  const [costo, setCosto] = useState<CostoResponse | 'cargando' | null>('cargando');

  useEffect(() => {
    let cancelado = false;
    fetch(`${API_URL}/api/interactions/canales?rango=${rango}`)
      .then((r) => r.json())
      .then((d) => !cancelado && setEstado(d))
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [rango]);

  useEffect(() => {
    let cancelado = false;
    setCosto('cargando');
    fetch(`${API_URL}/api/leads/costo?rango=${rango}`)
      .then((r) => r.json())
      .then((d) => !cancelado && setCosto(d.totales ? d : null))
      .catch(() => !cancelado && setCosto(null));
    return () => {
      cancelado = true;
    };
  }, [rango]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      {/* El control de todo. Va arriba porque gobierna la pantalla entera. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Lo que está pasando</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Todo lo de abajo mira {ETIQUETA[rango]}.
          </p>
        </div>
        <RangoPicker valor={rango} onChange={setRango} />
      </div>

      <CanalesStrip estado={estado} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[22rem_1fr]">
        <BandejaResumen estado={estado} />

        <div className="flex flex-col gap-5">
          <FlujoChart porDia={estado?.porDia ?? []} rango={rango} />

          {costo === 'cargando' && (
            <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              Calculando cuánto costó cada persona...
            </p>
          )}

          {/* "No hay formularios en este período" no es un hueco: es un hallazgo.
              Se dice con todas las letras. */}
          {costo === null && (
            <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
              No llegó ningún formulario en {ETIQUETA[rango]}, así que no hay costo por persona que
              calcular.
            </p>
          )}

          {costo !== null && costo !== 'cargando' && (
            <CostoPorLeadCard porAnuncio={costo.porAnuncio} />
          )}

          <DecisionesPendientesCard rango={rango} />

          <Link
            to="/campanas/nueva"
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <Plus size={16} />
            Crear campaña
          </Link>
        </div>
      </div>
    </div>
  );
}
