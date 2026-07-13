import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * FICHA DE ESTADO — la card fina de una estación del embudo (ENTRA, LEAD, A META).
 *
 * Es el detalle de las etapas que hoy tienen poco dato o cuya foto se cuenta en un número. Lleva
 * un RIEL de color a la izquierda —el hue de temperatura de su estación en el riel— como tejido
 * que ata el bento (que rompe el orden 01→05) con el relato. Y un ID para que un clic en el riel
 * ancle hasta acá.
 *
 * Los vacíos son HONESTOS: "sin revisar" en helado, nunca un 0 que parezca un logro.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const META_BLUE = '#1877F2';

type Tono = keyof typeof TEMP;

export default function FichaEstado({
  id,
  indice,
  etapa,
  dueno,
  tono,
  numero,
  oro,
  caption,
  vacio,
  metaFrontera,
  extra,
  cta,
}: {
  id: string;
  indice: string;
  etapa: string;
  dueno: string;
  tono: Tono;
  numero?: string;
  oro?: boolean;
  caption?: string;
  /** Estado vacío honesto: el texto se muestra en helado, sin fingir un dato. */
  vacio?: string;
  /** La frontera con Meta: borde meta-blue. */
  metaFrontera?: boolean;
  extra?: ReactNode;
  cta?: { label: string; href: string; meta?: boolean };
}) {
  const rail = metaFrontera ? META_BLUE : TEMP[tono];
  return (
    <div
      id={`panel-${id}`}
      className="flex scroll-mt-4 flex-col rounded-xl border bg-card p-4"
      style={{
        borderColor: metaFrontera ? `${META_BLUE}55` : 'var(--border)',
        boxShadow: `inset 3px 0 0 ${rail}, 0 1px 2px rgba(14,42,82,0.04)`,
      }}
    >
      <div className="mb-2 flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] font-medium tabular-nums text-navy/40">{indice}</span>
        <span className="font-heading text-xs font-bold uppercase tracking-[0.03em] text-navy">{etapa}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-navy/40">{dueno}</span>
      </div>

      {vacio ? (
        <p className="flex items-center gap-2 py-1 font-heading text-lg font-bold" style={{ color: TEMP.helado }}>
          <span className="inline-block size-2.5 rounded-full border-2" style={{ borderColor: TEMP.helado }} />
          {vacio}
        </p>
      ) : (
        <p
          className="font-heading text-3xl font-extrabold leading-none tabular-nums"
          style={{ color: oro ? '#B58900' : 'var(--navy)' }}
        >
          {numero}
        </p>
      )}

      {caption && <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{caption}</p>}
      {extra}

      {cta && (
        <Link
          to={cta.href}
          className="group mt-auto flex items-center gap-1.5 pt-3 font-mono text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: cta.meta ? META_BLUE : 'var(--navy)' }}
        >
          {cta.label}
          <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
