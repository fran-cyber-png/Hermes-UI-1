import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * PANEL DE FAENA — el contenedor de una estación grande del bento (CONVERSA, COMPRA).
 *
 * Un solo borde, un solo radio, una sombra mínima. Lleva el RIEL de wayfinding a la izquierda —el
 * hue de temperatura de su estación— y un encabezado con índice 01-05, para que el bento (que rompe
 * el orden del embudo por "el espacio sigue al dato") no pierda el hilo del relato. Adentro NO van
 * sub-cards: van secciones separadas por divisores finos.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;
const META_BLUE = '#1877F2';

export default function PanelFaena({
  id,
  indice,
  etapa,
  dueno,
  tono,
  metaFrontera,
  link,
  className = '',
  children,
}: {
  id: string;
  indice: string;
  etapa: string;
  dueno: string;
  tono: keyof typeof TEMP;
  metaFrontera?: boolean;
  link?: { label: string; href: string };
  className?: string;
  children: ReactNode;
}) {
  const rail = metaFrontera ? META_BLUE : TEMP[tono];
  return (
    <section
      id={`panel-${id}`}
      className={'flex scroll-mt-4 flex-col rounded-xl border bg-card p-5 ' + className}
      style={{
        borderColor: metaFrontera ? `${META_BLUE}55` : 'var(--border)',
        boxShadow: `inset 3px 0 0 ${rail}, 0 1px 2px rgba(14,42,82,0.04)`,
      }}
    >
      <header className="mb-4 flex items-baseline gap-2">
        <span className="font-mono text-[10px] font-medium tabular-nums text-navy/40">{indice}</span>
        <h2 className="font-heading text-sm font-bold uppercase tracking-[0.03em] text-navy">{etapa}</h2>
        <span className="font-mono text-[10px] uppercase tracking-wide text-navy/40">· {dueno}</span>
        {link && (
          <Link
            to={link.href}
            className="group ml-auto flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-navy/60 hover:text-navy"
          >
            {link.label}
            <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}
