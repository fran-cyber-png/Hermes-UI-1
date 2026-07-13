import { Receipt } from 'lucide-react';
import type { VentaPais } from '../../lib/datos/overview';

/**
 * LA ESTACIÓN COMPRA — ventas reales por país del cliente, en USD.
 *
 * Sale del espejo de Cerberus, convertido con la tasa CONGELADA de cada venta (no la de hoy), y
 * atribuido al país del CLIENTE, no al de la sede que registró la venta. Es la mitad de ventas del
 * cruce geográfico; la otra mitad —el gasto por país de la audiencia— llega con el breakdown de
 * Meta y recién ahí se puede mostrar el ROAS real por país.
 *
 * Barras ordenadas por plata, un solo tono para la magnitud, etiqueta directa. "Sin país" (ventas
 * viejas migradas sin país de cliente) aparece igual: para verlo, no para esconderlo en un promedio.
 */
export default function VentasPorPais({ ventas }: { ventas: VentaPais[] }) {
  const conPlata = ventas.filter((v) => v.ventasUsd > 0);
  if (conPlata.length === 0) return null;

  const totalUsd = conPlata.reduce((s, v) => s + v.ventasUsd, 0);
  const totalVentas = conPlata.reduce((s, v) => s + v.ventas, 0);
  const tope = Math.max(...conPlata.map((v) => v.ventasUsd));

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Receipt size={16} className="shrink-0 text-navy" />
        <h2 className="font-heading text-base font-bold text-navy">Ventas por país</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="font-bold text-foreground">${Math.round(totalUsd).toLocaleString('es')}</span>{' '}
        en {totalVentas.toLocaleString('es')} ventas reales, en dólares. Es el país de quien compró,
        no el de la sede.
      </p>

      <div className="flex flex-col gap-2.5">
        {conPlata.map((v) => {
          const ancho = Math.max(2, Math.round((v.ventasUsd / tope) * 100));
          return (
            <div key={v.pais} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-right text-sm font-semibold text-foreground">
                {v.pais}
              </span>
              <div className="flex h-7 flex-1 items-center">
                <div
                  className="flex h-full items-center rounded-md bg-navy"
                  style={{ width: `${ancho}%` }}
                />
                <span className="ml-2 whitespace-nowrap text-sm font-bold tabular-nums text-foreground">
                  ${Math.round(v.ventasUsd).toLocaleString('es')}
                </span>
                <span className="ml-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  {v.ventas.toLocaleString('es')} ventas
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        El ROAS real por país —cuánto volvió por cada dólar de pauta— llega cuando conectemos el
        gasto por país de la audiencia desde Meta.
      </p>
    </div>
  );
}
