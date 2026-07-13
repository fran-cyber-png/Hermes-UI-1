import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useLocalStorage } from '../lib/useLocalStorage';
import { useOverview } from '../lib/datos/overview';
import type { Rango } from '../features/canales/types';
import RangoPicker from '../features/canales/RangoPicker';
import FlujoVentana from '../features/home/FlujoVentana';
import CostoPorLeadCard from '../features/leads/CostoPorLeadCard';
import DecisionesPendientesCard from '../features/decisions/DecisionesPendientesCard';
import { CardAccionable, CardCerrado, CardPreguntas } from '../features/home/Verdad';
import TableroSalud from '../features/home/TableroSalud';
import { useCuentasPauta } from '../lib/datos/overview';

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
 * ── Qué cambió, y por qué ──
 * La home vieja contaba VOLUMEN: "946 sin atender en Facebook". Ese número es verdadero y es
 * inútil — de esos 946, a 928 Meta les cerró la puerta y no se les puede escribir NUNCA MÁS.
 *
 * Un contador gigante de pendientes no es un sistema de trabajo: es una acusación. Y cuando la
 * mayoría de esos pendientes son inalcanzables, es una acusación falsa.
 *
 * Ahora cuenta CUATRO COSAS, en orden de importancia real:
 *
 *   1. EL LAZO      — ¿Meta sabe que vendimos? Es la razón de ser del sistema. Va arriba de todo.
 *   2. ACCIONABLE   — lo que una persona puede trabajar HOY. Decenas, no 94.371.
 *   3. CERRADO      — lo que Meta cerró. No es deuda: es audiencia.
 *   4. PREGUNTAS    — qué escribe la gente. El dato que le sirve al creativo, y nadie lo miraba.
 *
 * Ningún número está escrito a mano. Todos salen de una consulta.
 *
 * ── Y una sola llamada ──
 * Antes eran cuatro `fetch` desde cuatro componentes distintos, una de ellas de 2 a 4 minutos
 * porque hablaba con Meta en vivo, al montar. Ahora: `GET /api/overview`, solo Postgres.
 */
export default function HomePage() {
  // PREFERENCIA de UI: qué rango elegiste no le importa a nadie más. localStorage es correcto acá.
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');

  // ESTADO DEL SERVIDOR: una sola llamada, cacheada, cancelable. Nunca en localStorage.
  const { data, isPending } = useOverview(rango);
  // Las cuentas de pauta viven en el SERVIDOR, no en el localStorage de un navegador: el job de
  // fondo también las necesita, y un job no tiene localStorage.
  const { data: cfg } = useCuentasPauta();
  const costo = data?.pauta?.costo ?? null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-navy">Lo que está pasando</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            El gráfico y la plata miran {ETIQUETA[rango]}. Lo de arriba es ahora.
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
          {/* Lo primero de todo: el estado del sistema, para que cualquiera entienda de un
              vistazo qué fluye, qué falta y qué sigue. */}
          <TableroSalud />

          {/* 2 y 3. Lo que se puede hacer, y lo que Meta cerró. Juntos porque son la misma
              pregunta vista de los dos lados: ¿dónde está la puerta abierta? */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <CardAccionable a={data.accionable} />
            <CardCerrado c={data.cerrado} />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[22rem_1fr]">
            {/* 4. Para el creativo. */}
            <CardPreguntas p={data.preguntas} />

            <div className="flex flex-col gap-5">
              <FlujoVentana flujo={data.flujo} rango={rango} />

              {/* Dos cosas DISTINTAS que antes se veían igual: "no revisamos" lo dice la
                  tarjeta de decisiones; acá solo "revisamos y no hubo formularios". */}
              {data.pauta && !costo && (
                <p className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
                  No llegó ningún formulario en {ETIQUETA[rango]}, así que no hay costo por persona
                  que calcular.
                </p>
              )}

              {costo != null && (
                <CostoPorLeadCard porAnuncio={(costo as { porAnuncio: never[] }).porAnuncio} />
              )}

              <DecisionesPendientesCard pauta={data.pauta} cuentas={cfg?.cuentas ?? []} />

              <Link
                to="/campanas/nueva"
                className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
              >
                <Plus size={16} />
                Crear campaña
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
