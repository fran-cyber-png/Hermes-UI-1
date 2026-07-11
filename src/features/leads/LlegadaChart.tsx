import type { LeadStats } from './types';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  porDia: LeadStats['porDia'];
}

/**
 * Cuándo llegaron. Las barras cuentan una historia incómoda: hubo días de 90
 * leads. Ese día alguien pagó por 90 personas interesadas, y ninguna fue
 * contactada.
 */
export default function LlegadaChart({ porDia }: Props) {
  if (porDia.length === 0) return null;
  const max = Math.max(...porDia.map((d) => d.leads));
  const total = porDia.reduce((s, d) => s + d.leads, 0);
  const pico = porDia.reduce((a, b) => (b.leads > a.leads ? b : a));

  const fmt = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' });

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>Cuándo llegaron</span>
        <span className="text-xs font-normal text-navy-muted">{total.toLocaleString('es')} leads</span>
      </div>
      <div className="p-5">
        <div className="flex items-end gap-[3px] h-32" role="img" aria-label="Leads recibidos por día">
          {porDia.map((d) => {
            const h = Math.max((d.leads / max) * 100, 3);
            const esPico = d.dia === pico.dia;
            return (
              <div
                key={d.dia}
                title={`${fmt(d.dia)}: ${d.leads} leads`}
                style={{ height: `${h}%` }}
                className={`flex-1 rounded-t transition-colors ${
                  esPico ? 'bg-gold' : 'bg-temp-helado/50 hover:bg-temp-helado'
                }`}
              />
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{fmt(porDia[0].dia)}</span>
          <span>{fmt(porDia[porDia.length - 1].dia)}</span>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          El pico fue el <strong className="text-foreground">{fmt(pico.dia)}</strong>:{' '}
          <strong className="text-gold-ink">{pico.leads} personas</strong> en un solo día. Ninguna fue
          contactada.
        </p>
      </div>
    </div>
  );
}
