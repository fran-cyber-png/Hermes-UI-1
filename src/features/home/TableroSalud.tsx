import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { api } from '../../lib/datos/cliente';

/**
 * EL TABLERO DE SALUD — lo primero que se ve al abrir.
 *
 * Que cualquiera entienda, sin saber nada, en qué anda el sistema: qué fluye, qué falta, qué
 * sigue. Cada pieza con su semáforo y su edad; "lo que sigue" son los próximos pasos reales,
 * no una lista de deseos.
 *
 * Nada miente: una pieza que nunca se sincronizó dice "nunca", no un 0 que parece un dato.
 */

type Estado = 'ok' | 'atencion' | 'falta';
type Pieza = { clave: string; titulo: string; estado: Estado; detalle: string };
type Salud = { piezas: Pieza[]; loQueSigue: { texto: string; porQue: string }[] };

const ICONO: Record<Estado, { Icon: typeof CircleCheck; color: string }> = {
  ok: { Icon: CircleCheck, color: '#16A34A' },
  atencion: { Icon: CircleAlert, color: '#CAA106' },
  falta: { Icon: CircleDashed, color: '#C2410C' },
};

export default function TableroSalud() {
  const { data } = useQuery({
    queryKey: ['salud'],
    queryFn: () => api<Salud>('/api/overview/salud'),
    // El estado del sistema cambia lento; refrescar cada 2 min alcanza.
    refetchInterval: 120_000,
  });

  if (!data) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-3 font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Estado del sistema
      </h2>

      {/* Las piezas: semáforo + qué está pasando. */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.piezas.map((p) => {
          const { Icon, color } = ICONO[p.estado];
          return (
            <div key={p.clave} className="flex items-start gap-2">
              <Icon size={16} className="mt-0.5 shrink-0" style={{ color }} />
              <div className="min-w-0">
                <p className="text-sm font-bold text-navy">{p.titulo}</p>
                <p className="text-xs text-muted-foreground">{p.detalle}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Lo que sigue: los próximos pasos, en orden, con el porqué. */}
      {data.loQueSigue.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Lo que sigue
          </p>
          <ol className="flex flex-col gap-2">
            {data.loQueSigue.map((x, idx) => (
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
