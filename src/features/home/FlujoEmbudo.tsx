import { useQuery } from '@tanstack/react-query';
import { CornerRightDown } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Overview } from '../../lib/datos/overview';

/**
 * EL RIEL — la firma de la matriz.
 *
 * El embudo de Goberna en una sola banda, de izquierda a derecha: 01 entra → 02 conversa →
 * 03 lead → 04 compra → 05 a Meta. Y hace tres trabajos a la vez: ESTADO (cada estación encendida
 * por la temperatura de su dato), NAVEGACIÓN (un clic ancla al panel de esa estación) y RELATO.
 *
 * ── Por qué NO es un embudo que se estrecha ──
 * Los números vienen de ventanas y sistemas distintos: 27 en ventana ahora, 680 leads acumulados,
 * 4.142 ventas históricas, 107 del lazo de 7 días. Dibujarlos angostándose fingiría una conversión
 * que no existe. Nodos IGUALES, y la verdad contada por la FORMA:
 *   · nodo HUECO (◌) donde falta el dato — la pauta sin revisar.
 *   · CORTE en la vía donde falta el cable — WhatsApp sin conectar, el 77% de la inversión.
 *   · el FORK de Meta — 107 entran sólidas, 309 caen como fuga (la ventana de 7 días que se venció).
 *
 * Todo el color del producto vive acá. Lo de afuera es navy sobre blanco. Si borras el riel, se
 * cae la identidad: esa es la prueba de que es la firma.
 */

type Estado = 'ok' | 'atencion' | 'falta';
type Pieza = { clave: string; estado: Estado };
type Salud = { piezas: Pieza[]; loQueSigue: { texto: string; porQue: string }[] };

/** La rampa de temperatura del dato — el motor semántico de toda la matriz. */
const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const META_BLUE = '#1877F2';
const RIEL = '#CDDCF2'; // navy-muted: la vía apagada

type Tono = keyof typeof TEMP;

type Estacion = {
  id: string;
  indice: string;
  etapa: string;
  dueno: string;
  numero: string;
  /** El número va en oro (momento-dinero) en vez de navy. */
  oro?: boolean;
  estado: string;
  tono: Tono;
  /** Nodo hueco: hay etapa pero todavía no hay dato (p. ej. pauta sin revisar). */
  hueco?: boolean;
  /** La vía que SALE de esta estación está cortada (falta el cable). */
  corte?: string;
};

function estaciones(d: Overview, salud: Map<string, Estado>): Estacion[] {
  const totalVentas = d.ventas.reduce((s, v) => s + v.ventas, 0);
  const totalUsd = d.ventas.reduce((s, v) => s + v.ventasUsd, 0);
  const ABREV: Record<string, string> = { facebook: 'fb', instagram: 'ig', whatsapp: 'wa' };
  const porCanal = d.accionable.porCanal
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${ABREV[c.canal] ?? c.canal}`)
    .join(' · ');
  const waCortado = salud.get('whatsapp') === 'falta';

  return [
    {
      id: 'entra',
      indice: '01',
      etapa: 'Entra',
      dueno: 'pauta',
      numero: d.pauta ? d.pauta.decisiones.length.toLocaleString('es') : '—',
      estado: d.pauta ? `${d.pauta.campanasAnalizadas} campañas` : 'sin revisar',
      tono: d.pauta ? 'fresco' : 'helado',
      hueco: !d.pauta,
    },
    {
      id: 'conversa',
      indice: '02',
      etapa: 'Conversa',
      dueno: 'community',
      numero: d.accionable.total.toLocaleString('es'),
      estado: porCanal || 'nadie esperando',
      tono: d.accionable.total > 0 ? 'tibio' : 'fresco',
      // El corte de la vía: WhatsApp, el canal que más vende, sin conectar.
      corte: waCortado ? 'WhatsApp sin conectar' : undefined,
    },
    {
      id: 'lead',
      indice: '03',
      etapa: 'Lead',
      dueno: 'ventas',
      numero: d.leads.sinContactar.toLocaleString('es'),
      estado: 'sin contactar',
      tono: d.leads.sinContactar > 0 ? 'frio' : 'fresco',
    },
    {
      id: 'compra',
      indice: '04',
      etapa: 'Compra',
      dueno: 'ventas · dirección',
      numero: totalUsd > 0 ? `$${Math.round(totalUsd).toLocaleString('es')}` : '—',
      oro: totalUsd > 0,
      estado: totalVentas > 0 ? `${totalVentas.toLocaleString('es')} ventas` : 'sin ventas',
      tono: 'fresco',
    },
    {
      id: 'meta',
      indice: '05',
      etapa: 'A Meta',
      dueno: 'el lazo',
      numero: d.lazo.reportadas.toLocaleString('es'),
      estado: 'reportadas',
      tono: 'fresco',
    },
  ];
}

const EYEBROW = 'font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-navy/45';

/** El nodo de una estación: relleno con brillo, o hueco si el dato todavía no está. */
function Nodo({ tono, hueco, meta }: { tono: Tono; hueco?: boolean; meta?: boolean }) {
  const c = meta ? META_BLUE : TEMP[tono];
  if (meta) {
    // El rombo de Meta: la frontera del sistema, distinta de toda estación interna.
    return (
      <span
        className="z-10 size-3 shrink-0 rotate-45 rounded-[3px]"
        style={{ background: c, boxShadow: `0 0 0 4px ${c}22` }}
      />
    );
  }
  if (hueco) {
    return <span className="z-10 size-3.5 shrink-0 rounded-full border-2 bg-card" style={{ borderColor: c }} />;
  }
  return (
    <span
      className="z-10 size-3.5 shrink-0 rounded-full"
      style={{ background: c, boxShadow: `0 0 0 4px ${c}22` }}
    />
  );
}

export default function FlujoEmbudo({ overview }: { overview: Overview }) {
  const { data: salud } = useQuery({
    queryKey: ['salud'],
    queryFn: () => api<Salud>('/api/overview/salud'),
    refetchInterval: 120_000,
  });

  const est = new Map<string, Estado>((salud?.piezas ?? []).map((p) => [p.clave, p.estado]));
  const cols = estaciones(overview, est);

  return (
    <section className="rounded-xl border border-border bg-card px-5 py-5 shadow-[0_1px_2px_rgba(14,42,82,0.04)] sm:px-7 sm:py-6">
      <p className={EYEBROW + ' mb-5'}>El riel · el embudo, de principio a fin</p>

      {/* ── LA VÍA HORIZONTAL (desktop) ── */}
      <div className="hidden lg:flex">
        {cols.map((e, i) => {
          const ultima = i === cols.length - 1;
          const meta = e.id === 'meta';
          return (
            <a key={e.id} href={`#panel-${e.id}`} className="group flex flex-1 flex-col">
              {/* Fila de la vía: medio tramo entra, el nodo, medio tramo sale. */}
              <div className="flex items-center">
                <span className="h-[3px] flex-1 rounded-full" style={{ background: i > 0 ? RIEL : 'transparent' }} />
                <span className="px-2">
                  <Nodo tono={e.tono} hueco={e.hueco} meta={meta} />
                </span>
                {/* El tramo que sale: cortado (dashed) si falta el cable; sólido meta-blue si va a Meta. */}
                {!ultima ? (
                  e.corte ? (
                    <span
                      className="h-0 flex-1 border-t-[3px] border-dashed"
                      style={{ borderColor: TEMP.helado }}
                    />
                  ) : (
                    <span
                      className="h-[3px] flex-1 rounded-full"
                      style={{ background: cols[i + 1].id === 'meta' ? META_BLUE : RIEL }}
                    />
                  )
                ) : (
                  <span className="flex-1" />
                )}
              </div>

              {/* Micro-anotación honesta de fuga/corte, sobre la vía. */}
              <span className="mt-1.5 block h-3 text-center font-mono text-[9px] uppercase tracking-wide text-navy/40">
                {e.corte ? `✕ ${e.corte}` : ''}
              </span>

              {/* Contenido de la estación. */}
              <div className="mt-1.5 px-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] font-medium tabular-nums text-navy/40">{e.indice}</span>
                  <span className="font-heading text-[13px] font-bold uppercase tracking-[0.02em] text-navy">
                    {e.etapa}
                  </span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wide text-navy/40">{e.dueno}</span>
                <p
                  className="mt-1 font-heading text-[26px] font-extrabold leading-none tabular-nums"
                  style={{ color: e.oro ? '#B58900' : 'var(--navy)' }}
                >
                  {e.numero}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{e.estado}</p>

                {/* El FORK de Meta: lo que entra y lo que cae. Honesto: es la ventana de 7 días. */}
                {meta && overview.lazo.perdidasPorVentana > 0 && (
                  <p
                    className="mt-1 flex items-center gap-1 font-mono text-[10px] tabular-nums"
                    style={{ color: TEMP.helado }}
                  >
                    <CornerRightDown size={11} className="shrink-0" />
                    {overview.lazo.perdidasPorVentana.toLocaleString('es')} caen · ventana 7 días
                  </p>
                )}
              </div>
            </a>
          );
        })}
      </div>

      {/* ── LA VÍA VERTICAL (móvil) ── */}
      <div className="flex flex-col lg:hidden">
        {cols.map((e, i) => {
          const ultima = i === cols.length - 1;
          const meta = e.id === 'meta';
          return (
            <a key={e.id} href={`#panel-${e.id}`} className="flex gap-3">
              <div className="flex flex-col items-center self-stretch pt-1">
                <Nodo tono={e.tono} hueco={e.hueco} meta={meta} />
                {!ultima && (
                  <span
                    className={'my-1 w-[3px] flex-1 rounded-full ' + (e.corte ? 'border-l-[3px] border-dashed' : '')}
                    style={e.corte ? { borderColor: TEMP.helado } : { background: RIEL }}
                  />
                )}
              </div>
              <div className={ultima ? 'pb-1' : 'pb-5'}>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] tabular-nums text-navy/40">{e.indice}</span>
                  <span className="font-heading text-xs font-bold uppercase tracking-wide text-navy">{e.etapa}</span>
                  <span className="font-mono text-[10px] uppercase text-navy/40">· {e.dueno}</span>
                </div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span
                    className="font-heading text-2xl font-extrabold tabular-nums"
                    style={{ color: e.oro ? '#B58900' : 'var(--navy)' }}
                  >
                    {e.numero}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.estado}</span>
                </div>
                {e.corte && (
                  <span className="font-mono text-[10px] uppercase" style={{ color: TEMP.helado }}>
                    ✕ {e.corte}
                  </span>
                )}
                {meta && overview.lazo.perdidasPorVentana > 0 && (
                  <span className="font-mono text-[10px] tabular-nums" style={{ color: TEMP.helado }}>
                    ↓ {overview.lazo.perdidasPorVentana.toLocaleString('es')} caen · ventana 7 días
                  </span>
                )}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
