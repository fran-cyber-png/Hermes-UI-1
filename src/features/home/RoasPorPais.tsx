import type { Accion, RoasPais } from '../../lib/datos/overview';

/**
 * EL ROAS REAL POR PAÍS — lo que el dashboard nunca tuvo junto.
 *
 * Gasto por país de la AUDIENCIA (Meta) × ventas por país del CLIENTE (Cerberus), con el cerebro de
 * decisiones ya probado. Ordenado por PLATA EN JUEGO, no por el ROAS crudo: un país con ROAS 8 y $20
 * mueve menos que uno con ROAS 3 y $5.000.
 *
 * El color del ROAS es DIVERGENTE (quema ↔ rinde), no una rampa: rojo cuando quema (< 2), verde
 * cuando rinde (≥ 4), gris neutro en el medio. Un ROAS "—" es no medible (sin gasto), no cero.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;

const ACCION: Record<Accion, { texto: string; color: string }> = {
  escalar: { texto: 'escalar', color: TEMP.fresco },
  recortar: { texto: 'recortar', color: TEMP.frio },
  mantener: { texto: 'mantener', color: TEMP.helado },
  observar: { texto: 'observar', color: TEMP.helado },
  sin_ventas: { texto: 'sin ventas', color: TEMP.frio },
  sin_gasto: { texto: 'orgánico', color: TEMP.tibio },
};

/** El color divergente del ROAS: quema (rojo) ↔ neutro ↔ rinde (verde). */
function colorRoas(roas: number | null): string {
  if (roas == null) return TEMP.helado;
  if (roas >= 4) return TEMP.fresco;
  if (roas < 2) return TEMP.frio;
  return TEMP.tibio;
}

export default function RoasPorPais({ roasPais, plano = false }: { roasPais: RoasPais[]; plano?: boolean }) {
  const totalGasto = roasPais.reduce((s, r) => s + r.gastoUsd, 0);
  const totalVentas = roasPais.reduce((s, r) => s + r.ventasUsd, 0);
  const roasGlobal = totalGasto > 0 ? totalVentas / totalGasto : null;

  const VISIBLES = 8;
  const cabeza = roasPais.slice(0, VISIBLES);
  const cola = roasPais.slice(VISIBLES);

  const cuerpo = (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        <span className="font-heading text-xl font-extrabold tabular-nums" style={{ color: colorRoas(roasGlobal) }}>
          {roasGlobal != null ? `${roasGlobal.toFixed(1)}×` : '—'}
        </span>{' '}
        de retorno: ${Math.round(totalVentas).toLocaleString('es')} en ventas por $
        {Math.round(totalGasto).toLocaleString('es')} de pauta.
      </p>

      <div className="flex flex-col divide-y divide-border">
        {cabeza.map((r) => {
          const a = ACCION[r.accion];
          return (
            <div key={r.pais} className="flex items-center gap-3 py-2">
              <span className="w-24 shrink-0 truncate text-sm font-semibold text-navy">{r.pais}</span>
              <span
                className="w-14 shrink-0 text-right font-heading text-base font-extrabold tabular-nums"
                style={{ color: colorRoas(r.roas) }}
              >
                {r.roas != null ? `${r.roas.toFixed(1)}×` : '—'}
              </span>
              <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-navy/45">
                ${Math.round(r.ventasUsd).toLocaleString('es')} vta · ${Math.round(r.gastoUsd).toLocaleString('es')} pauta
              </span>
              <span
                className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: a.color }}
              >
                {a.texto}
              </span>
            </div>
          );
        })}
      </div>

      {cola.length > 0 && (
        <p className="mt-2.5 font-mono text-[10px] uppercase tracking-wide text-navy/45">
          + {cola.length} países más
        </p>
      )}
    </>
  );

  if (plano) return cuerpo;
  return <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(14,42,82,0.04)]">{cuerpo}</div>;
}
