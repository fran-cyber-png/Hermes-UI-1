import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  FileText,
  Megaphone,
  MessageCircle,
  Receipt,
  Send,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Overview } from '../../lib/datos/overview';

/**
 * EL EMBUDO DE GOBERNA — la columna vertebral del home.
 *
 * Una sola historia, de izquierda a derecha: entra → conversa → lead → compra → se lo decimos a
 * Meta. Cinco estaciones. Cada profesional reconoce "su" estación, pero ve el recorrido completo.
 * Cada estación es una puerta a su pantalla de detalle: esto es el mapa, no el volcado de datos.
 *
 * Absorbe el tablero de salud: cada estación lleva su propio semáforo (de /api/overview/salud),
 * y abajo queda "lo que sigue" —los próximos pasos reales, sacados de los gaps abiertos—. Así el
 * estado del sistema no es una lista suelta arriba, sino el color de cada etapa del flujo.
 *
 * Nada miente: una etapa sin dato dice "sin conectar" o "sin revisar", nunca un cero que engañe.
 */

type Estado = 'ok' | 'atencion' | 'falta';
type Pieza = { clave: string; estado: Estado };
type Salud = { piezas: Pieza[]; loQueSigue: { texto: string; porQue: string }[] };

const SEMAFORO: Record<Estado, { Icon: LucideIcon; color: string; titulo: string }> = {
  ok: { Icon: CircleCheck, color: '#16A34A', titulo: 'fluye' },
  atencion: { Icon: CircleAlert, color: '#CAA106', titulo: 'a medias' },
  falta: { Icon: CircleDashed, color: '#C2410C', titulo: 'falta' },
};

type Estacion = {
  id: string;
  etapa: string;
  icono: LucideIcon;
  dueno: string;
  /** Qué pieza de salud da el semáforo de esta etapa. */
  saludClave: string;
  numero: string;
  sub: string;
  link: string;
  destino: string;
};

/** Convierte los datos del overview en las cinco estaciones. Toda la verdad del flujo, en orden. */
function estaciones(d: Overview): Estacion[] {
  const totalVentas = d.ventas.reduce((s, v) => s + v.ventas, 0);
  const totalUsd = d.ventas.reduce((s, v) => s + v.ventasUsd, 0);
  const paises = d.ventas.filter((v) => v.ventasUsd > 0).length;
  const porCanal = d.accionable.porCanal
    .filter((c) => c.n > 0)
    .map((c) => `${c.n} ${c.canal}`)
    .join(' · ');

  return [
    {
      id: 'entra',
      etapa: 'Entra',
      icono: Megaphone,
      dueno: 'Pauta · Creativos',
      saludClave: 'pauta',
      numero: d.pauta ? d.pauta.decisiones.length.toLocaleString('es') : '—',
      sub: d.pauta
        ? d.pauta.decisiones.length > 0
          ? 'decisiones de pauta que esperan'
          : `${d.pauta.campanasAnalizadas} campañas, sin alertas`
        : 'sin revisar todavía',
      link: '/campanas',
      destino: 'Ver la pauta',
    },
    {
      id: 'conversa',
      etapa: 'Conversa',
      icono: MessageCircle,
      dueno: 'Community',
      saludClave: 'meta_ingesta',
      numero: d.accionable.total.toLocaleString('es'),
      sub: porCanal ? `${porCanal} · esperan respuesta` : 'nadie esperando ahora',
      link: '/bandeja',
      destino: 'Abrir la bandeja',
    },
    {
      id: 'lead',
      etapa: 'Lead',
      icono: FileText,
      dueno: 'Ventas',
      saludClave: 'meta_ingesta',
      numero: d.leads.sinContactar.toLocaleString('es'),
      sub: `sin contactar · de ${d.leads.total.toLocaleString('es')} formularios · traen teléfono`,
      link: '/leads',
      destino: 'Ver formularios',
    },
    {
      id: 'compra',
      etapa: 'Compra',
      icono: Receipt,
      dueno: 'Ventas · Dirección',
      saludClave: 'cerberus',
      numero: totalUsd > 0 ? `$${Math.round(totalUsd).toLocaleString('es')}` : '—',
      sub:
        totalVentas > 0
          ? `${totalVentas.toLocaleString('es')} ventas · ${paises} países`
          : 'sin ventas sincronizadas',
      link: '/tesoreria',
      destino: 'Ver Tesorería',
    },
    {
      id: 'meta',
      etapa: 'Se lo decimos a Meta',
      icono: Send,
      dueno: 'Todos',
      saludClave: 'lazo',
      numero: d.lazo.reportadas.toLocaleString('es'),
      sub:
        d.lazo.perdidasPorVentana > 0
          ? `reportadas · ${d.lazo.perdidasPorVentana} perdidas por tiempo`
          : d.lazo.reportadas > 0
            ? 'ventas reportadas a Meta'
            : 'Meta aún no sabe que vendemos',
      link: '/tesoreria',
      destino: 'Ver el lazo',
    },
  ];
}

export default function FlujoEmbudo({ overview }: { overview: Overview }) {
  const { data: salud } = useQuery({
    queryKey: ['salud'],
    queryFn: () => api<Salud>('/api/overview/salud'),
    refetchInterval: 120_000,
  });

  const estadoPorClave = new Map<string, Estado>(
    (salud?.piezas ?? []).map((p) => [p.clave, p.estado]),
  );
  const cols = estaciones(overview);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
        El flujo, de principio a fin
      </h2>

      {/* Las cinco estaciones, izquierda a derecha, con la flecha del recorrido entre ellas. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
        {cols.map((e, i) => {
          const Icono = e.icono;
          const estado = estadoPorClave.get(e.saludClave);
          const sem = estado ? SEMAFORO[estado] : null;

          return (
            <div key={e.id} className="flex items-stretch lg:flex-1">
              <Link
                to={e.link}
                className="group flex flex-1 flex-col rounded-xl p-3 transition-colors hover:bg-muted"
              >
                <div className="flex items-center gap-2">
                  <Icono size={15} className="shrink-0 text-navy" />
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {e.etapa}
                  </span>
                  {sem && (
                    <sem.Icon
                      size={13}
                      className="ml-auto shrink-0"
                      style={{ color: sem.color }}
                      aria-label={sem.titulo}
                    />
                  )}
                </div>

                <p className="mt-2 font-heading text-3xl font-extrabold tabular-nums text-foreground">
                  {e.numero}
                </p>
                <p className="text-xs leading-snug text-muted-foreground">{e.sub}</p>

                <span className="mt-auto flex items-center gap-1 pt-3 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {e.destino}
                  <ArrowRight size={12} />
                </span>
              </Link>

              {/* La flecha del recorrido: solo entre estaciones, y solo en fila (desktop). */}
              {i < cols.length - 1 && (
                <div className="hidden items-center lg:flex">
                  <ChevronRight size={18} className="shrink-0 text-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Lo que sigue: los próximos pasos reales, sacados de los gaps abiertos. */}
      {salud && salud.loQueSigue.length > 0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Lo que sigue
          </p>
          <ol className="flex flex-col gap-2">
            {salud.loQueSigue.map((x, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm">
                <ArrowRight size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  <span className="font-semibold text-foreground">{x.texto}</span>
                  <span className="block text-xs text-muted-foreground">{x.porQue}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
