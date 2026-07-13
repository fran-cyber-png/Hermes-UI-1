import type { CostoFila } from './costoTypes';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  porAnuncio: CostoFila[];
  /** Campañas que quedaron fuera por no tener tasa de cambio. Se dicen. */
  sinTasa?: number;
}

/**
 * El costo REAL por lead, anuncio por anuncio. TODO EN DÓLARES.
 *
 * No es el "costo por resultado" de Meta (que puede contar conversiones de
 * landing). Son personas de carne y hueso, con nombre y teléfono, que están en
 * nuestra base. Es la única cifra que después se va a poder contrastar contra
 * ventas reales.
 *
 * El «{veces}× más barato» de abajo es la razón por la que el gasto se convierte a USD en el
 * backend antes de llegar acá: comparaba el gasto crudo de cuentas en monedas distintas, y ese
 * múltiplo podía ser el tipo de cambio disfrazado de hallazgo.
 */
export default function CostoPorLeadCard({ porAnuncio, sinTasa = 0 }: Props) {
  if (porAnuncio.length < 2) return null;

  const mejor = porAnuncio[0];
  const peor = porAnuncio[porAnuncio.length - 1];
  const maxCosto = peor.costoPorLead;
  const veces = (peor.costoPorLead / mejor.costoPorLead).toFixed(1);

  // Dónde se fue la plata: el que más gastó, ¿era el más barato?
  const queMasGasto = [...porAnuncio].sort((a, b) => b.gasto - a.gasto)[0];
  const gastoTotal = porAnuncio.reduce((s, a) => s + a.gasto, 0);
  const malRepartido = queMasGasto.costoPorLead > mejor.costoPorLead * 1.5;

  /**
   * El nombre del anuncio NO es único: los mismos rótulos («flyer», «Temario») se repiten en
   * campañas distintas. La conclusión de abajo llegaba a leerse «"flyer" costaba $1,83 mientras
   * "flyer" las traía a $0,42», que parece un error del sistema y no un hallazgo. Cuando dos
   * anuncios comparten nombre, se los distingue por su campaña.
   */
  const nombrar = (a: CostoFila) =>
    porAnuncio.filter((x) => x.adName === a.adName).length > 1
      ? `${a.adName} · ${a.campaignName}`
      : (a.adName ?? 'sin nombre');

  return (
    <div className={cardClass}>
      <div className={`${cardHeaderClass} flex items-center justify-between`}>
        <span>Cuánto costó cada persona</span>
        <span className="text-xs font-normal text-navy-muted">por anuncio · en USD</span>
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
          <strong>«{nombrar(queMasGasto)}» se llevó el {Math.round((queMasGasto.gasto / gastoTotal) * 100)}% del
          presupuesto</strong> a ${queMasGasto.costoPorLead.toFixed(2)} por persona, mientras «{nombrar(mejor)}» las
          traía a ${mejor.costoPorLead.toFixed(2)} — {veces}× más barato.
        </div>
      )}

      {sinTasa > 0 && (
        <div className="border-t border-border px-5 py-2 text-xs text-muted-foreground">
          {sinTasa} {sinTasa === 1 ? 'campaña quedó fuera' : 'campañas quedaron fuera'}: no tenemos tasa
          de cambio para su moneda.
        </div>
      )}
    </div>
  );
}
