import { useState } from 'react';
import { AlertTriangle, ChevronDown, Info } from 'lucide-react';
import type { Accion, Evidencia, RoasPais } from '../../lib/datos/overview';

/**
 * EL ROAS REAL POR PAÍS — con el copiloto que explica cada decisión.
 *
 * Gasto por país de la AUDIENCIA (Meta) × ventas por país del CLIENTE (Cerberus), con el cerebro de
 * decisiones. Ordenado por PLATA EN JUEGO, no por el ROAS crudo: un país con ROAS 8 sobre $20 mueve
 * menos que uno con ROAS 3 sobre $5.000.
 *
 * Y cada fila se abre: el COPILOTO responde las cuatro preguntas de quien compra medios —por qué este
 * país, qué evidencia hay, qué hago, qué pasa si lo hago— con un motor de reglas determinista, sin
 * una caja negra en el camino. Los caveats (la proyección es lineal, la muestra es chica) viajan
 * dentro del consejo, no en una nota al pie.
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

const TONO: Record<Evidencia['tipo'], string> = {
  ok: TEMP.fresco,
  warn: TEMP.tibio,
  alert: TEMP.frio,
  info: TEMP.helado,
};

/** El color divergente del ROAS: quema (rojo) ↔ neutro ↔ rinde (verde). */
function colorRoas(roas: number | null): string {
  if (roas == null) return TEMP.helado;
  if (roas >= 4) return TEMP.fresco;
  if (roas < 2) return TEMP.frio;
  return TEMP.tibio;
}

function Copiloto({ r }: { r: RoasPais }) {
  const e = r.explicacion;
  return (
    <div className="border-t border-border bg-muted/30 px-3 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="font-heading text-xs font-bold text-navy">{e.pregunta}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-navy/45">
          score {e.score}/100 · confianza {e.confianza}
        </span>
      </div>

      <p className="text-xs leading-snug text-foreground">{e.veredicto}</p>

      {/* La evidencia: cada señal con su tono. Nadie mueve plata sin ver el porqué. */}
      <ul className="mt-2 flex flex-col gap-1">
        {e.evidencia.map((ev, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <span
              className="mt-1 inline-block size-1.5 shrink-0 rounded-full"
              style={{ background: TONO[ev.tipo] }}
            />
            {ev.texto}
          </li>
        ))}
      </ul>

      <div className="mt-2.5 rounded-lg border border-border bg-card p-2.5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-wide text-navy/45">
          Qué hago
        </p>
        <p className="mt-0.5 text-xs font-semibold text-navy">{e.recomendacion}</p>
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info size={12} className="mt-0.5 shrink-0" />
          {e.quePasaSi}
        </p>
      </div>

      {e.riesgos.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {e.riesgos.map((riesgo, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug" style={{ color: TEMP.frio }}>
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {riesgo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function RoasPorPais({ roasPais, plano = false }: { roasPais: RoasPais[]; plano?: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);

  // ── EL DENOMINADOR TIENE QUE MERECER SU NUMERADOR ──
  //
  // El ROAS global sumaba TODAS las ventas por país arriba y TODO el gasto abajo. Pero hay países
  // que venden SIN que les pongamos un dólar de pauta (demanda orgánica: el sistema hasta los marca
  // con `accion: "sin_gasto"`). Esas ventas entraban al numerador y no tenían nada abajo que las
  // sostuviera — o sea, le atribuíamos a la pauta plata que la pauta no trajo. El retorno global
  // salía estructuralmente inflado, y hacia arriba, que es la dirección en la que un error de
  // marketing nunca se descubre solo.
  //
  // Ahora el ROAS global se calcula SOLO sobre los países donde efectivamente invertimos. Las
  // ventas orgánicas no desaparecen: se dicen aparte, que además es una noticia buena de verdad.
  const conPauta = roasPais.filter((r) => r.gastoUsd > 0);
  const totalGasto = conPauta.reduce((s, r) => s + r.gastoUsd, 0);
  const totalVentas = conPauta.reduce((s, r) => s + r.ventasUsd, 0);
  const roasGlobal = totalGasto > 0 ? totalVentas / totalGasto : null;
  const ventasOrganicas = roasPais
    .filter((r) => r.gastoUsd === 0)
    .reduce((s, r) => s + r.ventasUsd, 0);

  const VISIBLES = 8;
  const cabeza = roasPais.slice(0, VISIBLES);
  const cola = roasPais.slice(VISIBLES);

  const cuerpo = (
    <>
      <p className="mb-4 text-sm text-muted-foreground">
        <span
          className="font-heading text-xl font-extrabold tabular-nums"
          style={{ color: colorRoas(roasGlobal) }}
        >
          {roasGlobal != null ? `${roasGlobal.toFixed(1)}×` : '—'}
        </span>{' '}
        de retorno: ${Math.round(totalVentas).toLocaleString('es')} en ventas por $
        {Math.round(totalGasto).toLocaleString('es')} de pauta, en los {conPauta.length} países donde
        invertimos.
        {ventasOrganicas > 0 && (
          <>
            {' '}
            Otros ${Math.round(ventasOrganicas).toLocaleString('es')} se vendieron en países SIN pauta
            — no cuentan acá, porque no los trajo la pauta.
          </>
        )}{' '}
        Tocá un país para ver por qué.
      </p>

      <div className="flex flex-col divide-y divide-border">
        {cabeza.map((r) => {
          const a = ACCION[r.accion];
          const activo = abierto === r.pais;
          return (
            <div key={r.pais}>
              <button
                type="button"
                onClick={() => setAbierto(activo ? null : r.pais)}
                className="flex w-full items-center gap-3 py-2 text-left hover:bg-muted/50"
              >
                <ChevronDown
                  size={13}
                  className={'shrink-0 text-navy/30 transition-transform ' + (activo ? 'rotate-180' : '')}
                />
                <span className="w-20 shrink-0 truncate text-sm font-semibold text-navy">{r.pais}</span>
                <span
                  className="w-14 shrink-0 text-right font-heading text-base font-extrabold tabular-nums"
                  style={{ color: colorRoas(r.roas) }}
                >
                  {r.roas != null ? `${r.roas.toFixed(1)}×` : '—'}
                </span>
                <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-navy/45">
                  ${Math.round(r.ventasUsd).toLocaleString('es')} vta · $
                  {Math.round(r.gastoUsd).toLocaleString('es')} pauta
                </span>
                <span
                  className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: a.color }}
                >
                  {a.texto}
                </span>
              </button>
              {activo && <Copiloto r={r} />}
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
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(14,42,82,0.04)]">
      {cuerpo}
    </div>
  );
}
