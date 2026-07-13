import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useLocalStorage } from '../lib/useLocalStorage';
import { useOverview, useCuentasPauta } from '../lib/datos/overview';
import type { Rango } from '../features/canales/types';
import RangoPicker from '../features/canales/RangoPicker';
import FlujoEmbudo from '../features/home/FlujoEmbudo';
import FlujoVentana from '../features/home/FlujoVentana';
import VentasPorPais from '../features/home/VentasPorPais';
import BandejaCanales from '../features/canales/BandejaCanales';
import CostoPorLeadCard from '../features/leads/CostoPorLeadCard';
import DecisionesPendientesCard from '../features/decisions/DecisionesPendientesCard';
import { CardCerrado, CardPreguntas } from '../features/home/Verdad';

const ETIQUETA: Record<Rango, string> = {
  '7d': 'los últimos 7 días',
  '30d': 'los últimos 30 días',
  '90d': 'los últimos 90 días',
  '1y': 'el último año',
  todo: 'todo el histórico',
};

/** Un encabezado de estación: hace legible que bajar por el home es caminar el embudo. */
function Estacion({ etapa, quien }: { etapa: string; quien: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h2 className="font-heading text-lg font-bold text-navy">{etapa}</h2>
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {quien}
      </span>
    </div>
  );
}

/**
 * El home: el embudo de Goberna, de principio a fin.
 *
 * ── La idea ──
 * Una sola historia de izquierda a derecha —entra → conversa → lead → compra → se lo decimos a
 * Meta—, para que cada profesional (community, ventas, pauta, creativos, dirección) reconozca su
 * etapa sin traducir nuestros conceptos internos.
 *
 * Arriba, EL FLUJO: las cinco estaciones con su semáforo (el tablero de salud, ahora vuelto la
 * barra de estado del recorrido). Abajo, el detalle de cada estación, en orden de uso diario: la
 * bandeja por canal (lo que se trabaja todos los días), las ventas por país, y la pauta.
 *
 * ── Una sola llamada ──
 * Todo sale de `GET /api/overview`, solo Postgres. Ninguna pantalla habla con Meta al renderizar.
 */
export default function HomePage() {
  // PREFERENCIA de UI: qué rango elegiste no le importa a nadie más. localStorage es correcto acá.
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');

  // ESTADO DEL SERVIDOR: una sola llamada, cacheada, cancelable. Nunca en localStorage.
  const { data, isPending } = useOverview(rango);
  const { data: cfg } = useCuentasPauta();
  const costo = data?.pauta?.costo ?? null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Lo que está pasando</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            El gráfico y la pauta miran {ETIQUETA[rango]}. Las ventas y lo pendiente son el total real.
          </p>
        </div>
        <RangoPicker valor={rango} onChange={setRango} />
      </div>

      {isPending && (
        <p className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}

      {data && (
        <>
          {/* LA COLUMNA VERTEBRAL: las cinco estaciones con su semáforo, y lo que sigue. */}
          <FlujoEmbudo overview={data} />

          {/* CONVERSA — lo que se trabaja todos los días. Los canales no son intercambiables. */}
          <section className="flex flex-col gap-3">
            <Estacion etapa="Conversa" quien="Community" />
            <BandejaCanales canales={data.canales} accionable={data.accionable} compacto />
          </section>

          {/* La puerta cerrándose, y lo que ya cerró (audiencia) + qué escribe la gente. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_22rem]">
            <FlujoVentana flujo={data.flujo} rango={rango} />
            <div className="flex flex-col gap-5">
              <CardCerrado c={data.cerrado} />
              <CardPreguntas p={data.preguntas} />
            </div>
          </div>

          {/* COMPRA — las ventas reales, por país, en dólares. */}
          <section className="flex flex-col gap-3">
            <Estacion etapa="Compra" quien="Ventas · Dirección" />
            <VentasPorPais ventas={data.ventas} />
          </section>

          {/* ENTRA — la pauta: qué escalar, qué recortar, y cuánto cuesta traer a cada persona. */}
          <section className="flex flex-col gap-3">
            <Estacion etapa="Entra" quien="Pauta · Creativos" />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <DecisionesPendientesCard pauta={data.pauta} cuentas={cfg?.cuentas ?? []} />
              <div className="flex flex-col gap-5">
                {data.pauta && !costo && (
                  <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                    No llegó ningún formulario en {ETIQUETA[rango]}, así que no hay costo por persona
                    que calcular.
                  </p>
                )}
                {costo != null && (
                  <CostoPorLeadCard porAnuncio={(costo as { porAnuncio: never[] }).porAnuncio} />
                )}
                <Link
                  to="/campanas/nueva"
                  className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                >
                  <Plus size={16} />
                  Crear campaña
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
