import type { VentaPais } from '../../lib/datos/overview';

/**
 * VENTAS POR PAÍS — la estación COMPRA a fondo.
 *
 * Barras horizontales ordenadas por plata, del espejo de Cerberus, en USD con la tasa CONGELADA de
 * cada venta y atribuidas al país del CLIENTE (no al de la sede).
 *
 * ── Por qué barras y no un mapa ──
 * El trabajo del dato es COMPARAR MAGNITUD, y la magnitud se lee mejor por LONGITUD que por área o
 * color. Un mapa pintaría 3 manchas grandes y 12 motas invisibles (95% en 3 países), y borraría que
 * México y Perú van cabeza a cabeza ($175.936 vs $155.535). El mapa da patrón geográfico, no
 * comparación — no es el trabajo acá.
 *
 * Compactación honesta: el líder en oro (el dinero), el podio en navy sólido, la cola atenuada, un
 * marcador donde se acumula el 95%, y el resto plegado en "+N países" —la concentración se VE, el
 * ruido se pliega—.
 */

const NAVY = '#0E2A52';
const NAVY_MUTED = '#CDDCF2';
const GOLD = '#FFC800';
const GOLD_INK = '#B58900';

export default function VentasPorPais({ ventas, plano = false }: { ventas: VentaPais[]; plano?: boolean }) {
  const conPlata = ventas.filter((v) => v.ventasUsd > 0);
  if (conPlata.length === 0) return null;

  const totalUsd = conPlata.reduce((s, v) => s + v.ventasUsd, 0);
  const totalVentas = conPlata.reduce((s, v) => s + v.ventas, 0);
  const tope = Math.max(...conPlata.map((v) => v.ventasUsd));

  // Se muestran las primeras 6; el resto se pliega en una línea. La concentración (3 = 95%) se ve.
  const VISIBLES = 6;
  const cabeza = conPlata.slice(0, VISIBLES);
  const cola = conPlata.slice(VISIBLES);
  const colaUsd = cola.reduce((s, v) => s + v.ventasUsd, 0);

  const cuerpo = (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="font-heading text-xl font-extrabold tabular-nums" style={{ color: GOLD_INK }}>
          ${Math.round(totalUsd).toLocaleString('es')}
        </span>{' '}
        en {totalVentas.toLocaleString('es')} ventas reales. Es el país de quien compró.
      </p>

      <div className="flex flex-col gap-2">
        {cabeza.map((v, i) => {
          const ancho = Math.max(3, Math.round((v.ventasUsd / tope) * 100));
          const color = i === 0 ? GOLD : i < 3 ? NAVY : NAVY_MUTED;
          return (
            <div key={v.pais}>
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 truncate text-right text-xs font-semibold text-navy">
                  {v.pais}
                </span>
                <div className="flex flex-1 items-center">
                  <div className="h-6 rounded-md" style={{ width: `${ancho}%`, background: color }} />
                  <span className="ml-2 whitespace-nowrap font-heading text-sm font-bold tabular-nums text-navy">
                    ${Math.round(v.ventasUsd).toLocaleString('es')}
                  </span>
                  <span className="ml-1.5 whitespace-nowrap font-mono text-[10px] tabular-nums text-navy/40">
                    {v.ventas.toLocaleString('es')}
                  </span>
                </div>
              </div>
              {/* El podio se lleva el 95%: se marca DENTRO del gráfico, no en una nota al pie. */}
              {i === 2 && (
                <div className="ml-[5.75rem] mt-2 flex items-center gap-2">
                  <span className="h-0 flex-1 border-t border-dashed border-navy/25" />
                  <span className="font-mono text-[9px] uppercase tracking-wide text-navy/40">95% hasta acá</span>
                  <span className="h-0 flex-1 border-t border-dashed border-navy/25" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cola.length > 0 && (
        <p className="mt-2.5 pl-[5.75rem] font-mono text-[10px] uppercase tracking-wide text-navy/45">
          + {cola.length} países · ${Math.round(colaUsd).toLocaleString('es')}
        </p>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        El ROAS real por país llega cuando conectemos el gasto por país de la audiencia desde Meta.
      </p>
    </>
  );

  if (plano) return cuerpo;

  return <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(14,42,82,0.04)]">{cuerpo}</div>;
}
