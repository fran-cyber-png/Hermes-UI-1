import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Overview } from '../../lib/datos/overview';

/**
 * LA BARRA DE MANDO — el piso más alto de la matriz.
 *
 * La foto que dirección mira sin scrollear: qué FLUYE, qué FALTA, qué SIGUE. A la derecha, los
 * cuatro puntos de conexión del sistema y hace cuánto se actualizó. Es puro estado; el único color
 * "vivo" es el oro del próximo paso accionable —lo demás obedece a la rampa de temperatura—.
 *
 * Sale de /api/overview/salud (que ya calcula el estado y "lo que sigue" desde los gaps abiertos) y
 * del propio overview. Nada inventado: si algo no se midió, no aparece como si fluyera.
 */

type Estado = 'ok' | 'atencion' | 'falta';
type Pieza = { clave: string; titulo: string; estado: Estado; detalle: string; edadMinutos: number | null };
type Salud = { piezas: Pieza[]; loQueSigue: { texto: string; porQue: string }[] };

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const META_BLUE = '#1877F2';
const GOLD = '#FFC800';

/** Nombre corto de cada pieza, para las líneas de estado. */
const CORTO: Record<string, string> = {
  lazo: 'el lazo con Meta',
  cerberus: 'ventas al día',
  meta_ingesta: 'interacciones',
  whatsapp: 'WhatsApp',
  pauta: 'pauta',
};

function humano(min: number | null): string {
  if (min == null) return 'nunca';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} días`;
}

/** Un punto de conexión: relleno si está conectado, hueco si no. Meta es un rombo (la frontera). */
function Punto({
  label,
  on,
  color,
  rombo,
}: {
  label: string;
  on: boolean;
  color: string;
  rombo?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-navy/50">
      <span
        className={'inline-block size-2 ' + (rombo ? 'rotate-45 rounded-[1px]' : 'rounded-full')}
        style={on ? { background: color } : { border: `1.5px solid ${TEMP.helado}` }}
      />
      {label}
    </span>
  );
}

export default function BarraDeMando({ overview }: { overview: Overview }) {
  const { data: salud } = useQuery({
    queryKey: ['salud'],
    queryFn: () => api<Salud>('/api/overview/salud'),
    refetchInterval: 120_000,
  });

  const piezas = salud?.piezas ?? [];
  const estadoDe = (clave: string) => piezas.find((p) => p.clave === clave)?.estado;

  // FLUYE = lo que corre; FALTA = solo lo realmente desconectado (estado 'falta'). Lo que está
  // "a medias" (atención) no se alarma acá: su matiz vive en el riel, encendido en tibio.
  const fluye = piezas.filter((p) => p.estado === 'ok').map((p) => CORTO[p.clave] ?? p.titulo);
  const falta = piezas.filter((p) => p.estado === 'falta').map((p) => CORTO[p.clave] ?? p.titulo);
  const sigue = salud?.loQueSigue?.[0]?.texto;

  // La marca de tiempo: la sincronización más fresca que tengamos.
  const edades = piezas.map((p) => p.edadMinutos).filter((x): x is number => x != null);
  const fresco = edades.length ? Math.min(...edades) : null;

  const interaccionesOn = estadoDe('meta_ingesta') !== 'falta';
  const waOn = estadoDe('whatsapp') !== 'falta';

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-[0_1px_2px_rgba(14,42,82,0.04)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-7">
      {/* Los tres estados del sistema. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-1.5">
        {fluye.length > 0 && (
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: TEMP.fresco }}>
              ● Fluye
            </span>
            <span className="text-foreground">{fluye.join(' · ')}</span>
          </p>
        )}
        {falta.length > 0 && (
          <p className="flex items-baseline gap-2 text-sm">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: TEMP.frio }}>
              ▲ Falta
            </span>
            <span className="text-foreground">{falta.join(' · ')}</span>
          </p>
        )}
        {sigue && (
          <p className="flex items-center gap-1.5 text-sm">
            <span className="flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: '#B58900' }}>
              <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: GOLD }} />
              Sigue
            </span>
            <ChevronRight size={13} className="text-navy/40" />
            <span className="font-semibold text-navy">{sigue}</span>
          </p>
        )}
      </div>

      {/* Los puntos de conexión + la marca de tiempo. */}
      <div className="flex items-center gap-3 border-t border-border pt-3 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
        <Punto label="fb" on={interaccionesOn} color={META_BLUE} />
        <Punto label="ig" on={interaccionesOn} color="#C13584" />
        <Punto label="wa" on={waOn} color={TEMP.fresco} />
        <Punto label="meta" on={overview.lazo.conectado} color={META_BLUE} rombo />
        <span className="ml-1 font-mono text-[10px] uppercase tracking-wide text-navy/40">
          {humano(fresco)}
        </span>
      </div>
    </section>
  );
}
