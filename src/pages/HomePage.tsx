import { useLocalStorage } from '../lib/useLocalStorage';
import { useOverview, useCuentasPauta } from '../lib/datos/overview';
import type { Rango } from '../features/canales/types';
import RangoPicker from '../features/canales/RangoPicker';
import BarraDeMando from '../features/home/BarraDeMando';
import FlujoEmbudo from '../features/home/FlujoEmbudo';
import FlujoVentana from '../features/home/FlujoVentana';
import VentasPorPais from '../features/home/VentasPorPais';
import RoasPorPais from '../features/home/RoasPorPais';
import Creativos from '../features/home/Creativos';
import PanelFaena from '../features/home/PanelFaena';
import FichaEstado from '../features/home/FichaEstado';
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

/**
 * EL HOME — la matriz de Goberna como un puente de mando en tres pisos.
 *
 *   PISO 1 · BARRA DE MANDO — qué fluye, qué falta, qué sigue. La foto de dirección sin scrollear.
 *   PISO 2 · EL RIEL        — el embudo de principio a fin, la firma. Estado + navegación + relato.
 *   PISO 3 · BANCO DE FAENA — el bento donde el espacio sigue al dato: los dueños con dato vivo
 *                             (CONVERSA, la ventana que se cierra; COMPRA, la plata) se llevan los
 *                             paneles grandes; las etapas de una cifra bajan a fichas finas.
 *
 * El color está racionado: casi todo vive en el riel; el resto es navy sobre blanco con dos acentos
 * reservados —oro para el dinero, meta-blue para la frontera con Meta—. Un clic en el riel ancla a
 * la estación de abajo. Todo sale de GET /api/overview: una llamada, solo Postgres.
 */
export default function HomePage() {
  // PREFERENCIA de UI: qué rango elegiste no le importa a nadie más. localStorage es correcto acá.
  const [rango, setRango] = useLocalStorage<Rango>('meta-escuela.rango', '90d');

  // ESTADO DEL SERVIDOR: una sola llamada, cacheada, cancelable. Nunca en localStorage.
  const { data, isPending } = useOverview(rango);
  const { data: cfg } = useCuentasPauta();
  const costo = data?.pauta?.costo ?? null;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-navy/45">
            Goberna · la matriz
          </p>
          <h1 className="mt-1 font-heading text-2xl font-bold text-navy">Lo que está pasando</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            El gráfico y la pauta miran {ETIQUETA[rango]}. Las ventas y lo pendiente son el total real.
          </p>
        </div>
        <RangoPicker valor={rango} onChange={setRango} />
      </div>

      {isPending && (
        <p className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}

      {data && (
        <>
          {/* PISO 1 — la foto de dirección. */}
          <BarraDeMando overview={data} />

          {/* PISO 2 — la firma: el embudo de principio a fin. */}
          <FlujoEmbudo overview={data} />

          {/* PISO 3 — el bento: el espacio sigue al dato. Cada panel toma su altura natural. */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
            {/* CONVERSA (grande): todo lo que trabaja el community, en un panel. */}
            <PanelFaena
              id="conversa"
              indice="02"
              etapa="Conversa"
              dueno="community"
              tono="tibio"
              link={{ label: 'abrir bandeja', href: '/bandeja' }}
              className="lg:col-span-8"
            >
              <BandejaCanales canales={data.canales} accionable={data.accionable} plano />

              <div className="mt-5 border-t border-border pt-5">
                <FlujoVentana flujo={data.flujo} rango={rango} plano />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 border-t border-border pt-5 sm:grid-cols-2 sm:gap-0 sm:divide-x sm:divide-border">
                <div className="sm:pr-5">
                  <CardPreguntas p={data.preguntas} plano />
                </div>
                <div className="sm:pl-5">
                  <CardCerrado c={data.cerrado} plano />
                </div>
              </div>
            </PanelFaena>

            {/* COMPRA (grande): la plata, por país. */}
            <PanelFaena
              id="compra"
              indice="04"
              etapa="Compra"
              dueno="ventas · dirección"
              tono="fresco"
              link={{ label: 'ver tesorería', href: '/tesoreria' }}
              className="lg:col-span-4"
            >
              {/* Con gasto por país (pauta revisada) → el ROAS real; si no, las ventas por país. */}
              {data.roasPais ? (
                <RoasPorPais roasPais={data.roasPais} plano />
              ) : (
                <VentasPorPais ventas={data.ventas} plano />
              )}
            </PanelFaena>
          </div>

          {/* PISO 3 — las estaciones de una cifra: fichas finas, en orden de embudo. */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <FichaEstado
              id="entra"
              indice="01"
              etapa="Entra"
              dueno="pauta · creativos"
              tono={data.pauta ? 'fresco' : 'helado'}
              numero={data.pauta ? data.pauta.decisiones.length.toLocaleString('es') : undefined}
              vacio={data.pauta ? undefined : 'Sin revisar'}
              caption={
                data.pauta
                  ? `${data.pauta.campanasAnalizadas} campañas activas · revisado hace ${data.pauta.edadMinutos} min`
                  : 'Conecta las cuentas de pauta para ver qué escalar y qué recortar.'
              }
              cta={
                data.pauta
                  ? { label: 'ver la pauta', href: '/campanas' }
                  : { label: 'crear campaña', href: '/campanas/nueva', meta: true }
              }
            />

            <FichaEstado
              id="lead"
              indice="03"
              etapa="Lead"
              dueno="ventas"
              tono={data.leads.sinContactar > 0 ? 'frio' : 'fresco'}
              numero={data.leads.sinContactar.toLocaleString('es')}
              caption={`sin contactar · de ${data.leads.total.toLocaleString('es')} formularios · traen teléfono`}
              cta={{ label: 'ver formularios', href: '/leads' }}
            />

            <FichaEstado
              id="meta"
              indice="05"
              etapa="A Meta"
              dueno="el lazo"
              tono="fresco"
              metaFrontera
              numero={data.lazo.reportadas.toLocaleString('es')}
              caption={
                data.lazo.perdidasPorVentana > 0
                  ? `reportadas · ${data.lazo.perdidasPorVentana.toLocaleString('es')} perdidas por la ventana de 7 días`
                  : 'ventas reportadas a Meta'
              }
              cta={{ label: 'ver el lazo', href: '/tesoreria', meta: true }}
            />
          </div>

          {/* ENTRA a fondo: solo cuando hay pauta revisada. Los creativos primero (qué funciona),
              y debajo las decisiones de pauta y el costo por lead. */}
          {data.pauta && (
            <>
              <PanelFaena id="entra-detalle" indice="01" etapa="Entra · los creativos" dueno="creativos" tono="fresco">
                <Creativos creativos={data.pauta.creativos} />
              </PanelFaena>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <DecisionesPendientesCard pauta={data.pauta} cuentas={cfg?.cuentas ?? []} />
                {costo != null && (
                  <CostoPorLeadCard porAnuncio={(costo as { porAnuncio: never[] }).porAnuncio} />
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
