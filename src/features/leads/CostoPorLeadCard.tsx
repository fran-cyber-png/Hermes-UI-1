import type { CostoFila } from './costoTypes';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  porAnuncio: CostoFila[];
}

/**
 * El costo REAL por lead, anuncio por anuncio.
 *
 * No es el "costo por resultado" de Meta (que puede contar conversiones de
 * landing). Son personas de carne y hueso, con nombre y teléfono, que están en
 * nuestra base. Es la única cifra que después se va a poder contrastar contra
 * ventas reales.
 */
export default function CostoPorLeadCard({ porAnuncio }: Props) {
  if (porAnuncio.length < 2) return null;

  const mejor = porAnuncio[0];
  const peor = porAnuncio[porAnuncio.length - 1];
  const maxCosto = peor.costoPorLead;
  const veces = (peor.costoPorLead / mejor.costoPorLead).toFixed(1);

  // Dónde se fue la plata: el que más gastó, ¿era el más barato?
  const queMasGasto = [...porAnuncio].sort((a, b) => b.gasto - a.gasto)[0];
  const gastoTotal = porAnuncio.reduce((s, a) => s + a.gasto, 0);
  const malRepartido = queMasGasto.costoPorLead > mejor.costoPorLead * 1.5;

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>Cuánto costó cada persona</span>
        <span className="text-xs font-normal text-navy-muted">por anuncio</span>
      </div>

      <div className="flex flex-col gap-2.5 p-5">
        {porAnuncio.map((a) => {
          const esMejor = a.adName === mejor.adName && a.campaignId === mejor.campaignId;
          const esCaro = a.costoPorLead >= mejor.costoPorLead * 1.5;
          return (
            <div key={`${a.campaignId}:${a.adName}`} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 truncate font-semibold text-foreground" title={a.adName ?? ''}>
                {a.adName}
              </span>
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{a.leads} leads</span>

              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${
                    esMejor ? 'bg-temp-fresco' : esCaro ? 'bg-temp-frio' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.max((a.costoPorLead / maxCosto) * 100, 3)}%` }}
                />
              </div>

              <span
                className={`w-16 shrink-0 text-right font-mono text-xs font-bold tabular-nums ${
                  esMejor ? 'text-temp-fresco' : esCaro ? 'text-temp-frio' : 'text-foreground'
                }`}
              >
                ${a.costoPorLead.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>

      {malRepartido && (
        <div className="border-t border-border bg-gold/10 px-5 py-3 text-xs leading-relaxed text-foreground">
          <strong>«{queMasGasto.adName}» se llevó el {Math.round((queMasGasto.gasto / gastoTotal) * 100)}% del
          presupuesto</strong> a ${queMasGasto.costoPorLead.toFixed(2)} por persona, mientras «{mejor.adName}» las
          traía a ${mejor.costoPorLead.toFixed(2)} — {veces}× más barato.
        </div>
      )}
    </div>
  );
}
