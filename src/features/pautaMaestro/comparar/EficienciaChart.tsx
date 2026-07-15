import { useMemo } from 'react';
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { PautaDetalle, FilaAd } from '../types';
import { metricasDerivadas } from '../analisis';
import { colorForId, CHROME } from '../chartPalette';
import { fmtMoney, fmtPct } from '../../../lib/utils';

interface Punto {
  id: string;
  nombre: string;
  x: number; // CPA
  y: number; // resultados
  z: number; // tamaño = gasto
  ctr: number | null;
  gasto: number;
  color: string;
}

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type Props =
  | { modo: 'campanas'; detalles: PautaDetalle[]; moneda: string; hoveredId: string | null; onHover: (id: string | null) => void }
  | { modo: 'anuncios'; ads: FilaAd[]; moneda: string; hoveredId: string | null; onHover: (id: string | null) => void };

/**
 * El único mapa de eficiencia de la página — antes EfficiencyScatter y
 * BubbleCampanas graficaban casi la misma idea (CPA/CTR/gasto) con ejes
 * permutados, uno al lado del otro. Acá: X=CPA (menor=mejor), Y=resultados
 * (mayor=mejor), tamaño=gasto, color=identidad (campaña o anuncio, paleta
 * estable). El CTR se movió al tooltip — coexistía mal como color continuo
 * junto a un color de identidad categórica.
 *
 * Las líneas de mediana parten el cuadro en 4: arriba-izquierda (barato y con
 * resultado = candidato a escalar) vs. abajo-derecha (caro y sin resultado =
 * candidato a revisar).
 */
export default function EficienciaChart(props: Props) {
  const { moneda, hoveredId, onHover } = props;

  const puntos = useMemo<Punto[]>(() => {
    if (props.modo === 'campanas') {
      const ids = props.detalles.map((d) => d.id);
      return props.detalles.map((d) => ({
        id: d.id,
        nombre: d.nombre,
        x: d.costoPorResultado ?? 0,
        y: d.resultados ?? 0,
        z: Math.min(60, Math.max(10, Math.sqrt(Math.max(d.gasto, 1)) / 3)),
        ctr: metricasDerivadas(d).ctr,
        gasto: d.gasto,
        color: colorForId(d.id, ids),
      }));
    }
    const ids = props.ads.map((a) => a.id);
    return props.ads
      .filter((a) => a.gasto > 0)
      .map((a) => ({
        id: a.id,
        nombre: a.nombre,
        x: a.costoPorResultado ?? 0,
        y: a.resultados ?? 0,
        z: Math.min(60, Math.max(10, Math.sqrt(Math.max(a.gasto, 1)) / 3)),
        ctr: a.ctr,
        gasto: a.gasto,
        color: colorForId(a.id, ids),
      }));
  }, [props]);

  const medianaX = useMemo(() => mediana(puntos.filter((p) => p.x > 0).map((p) => p.x)), [puntos]);
  const medianaY = useMemo(() => mediana(puntos.map((p) => p.y)), [puntos]);

  const titulo = props.modo === 'campanas' ? 'Mapa de eficiencia' : 'Mapa de eficiencia · anuncios de esta campaña';

  if (puntos.length === 0)
    return (
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-1 text-sm font-bold text-navy">{titulo}</div>
        <p className="py-10 text-center text-sm text-muted-foreground">Sin datos para graficar.</p>
      </div>
    );

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 text-sm font-bold text-navy">{titulo}</div>
      <div className="mb-3 text-xs text-muted-foreground">
        X = costo/resultado (← más barato) · Y = resultados (↑ más resultados) · tamaño = gasto
      </div>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHROME.grid} />
          <XAxis
            type="number"
            dataKey="x"
            name="CPA"
            fontSize={11}
            stroke={CHROME.axis}
            tickFormatter={(v) => fmtMoney(Number(v), moneda)}
          />
          <YAxis type="number" dataKey="y" name="Resultados" fontSize={11} stroke={CHROME.axis} width={56} />
          <ZAxis type="number" dataKey="z" range={[80, 500]} />
          {medianaX > 0 && <ReferenceLine x={medianaX} stroke={CHROME.axis} strokeDasharray="4 4" />}
          {medianaY > 0 && <ReferenceLine y={medianaY} stroke={CHROME.axis} strokeDasharray="4 4" />}
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as Punto | undefined;
              if (!p) return null;
              return (
                <div className="rounded-lg border border-border bg-card p-2 text-xs shadow-md">
                  <div className="font-semibold text-foreground">{p.nombre}</div>
                  <div className="text-muted-foreground">CPA: {fmtMoney(p.x, moneda)}</div>
                  <div className="text-muted-foreground">Resultados: {p.y.toLocaleString('es')}</div>
                  <div className="text-muted-foreground">CTR: {fmtPct(p.ctr)}</div>
                  <div className="text-muted-foreground">Gasto: {fmtMoney(p.gasto, moneda)}</div>
                </div>
              );
            }}
          />
          <Scatter
            data={puntos}
            onMouseEnter={(e) => e?.payload?.id && onHover(e.payload.id)}
            onMouseLeave={() => onHover(null)}
          >
            {puntos.map((p) => (
              <Cell key={p.id} fill={p.color} fillOpacity={hoveredId && hoveredId !== p.id ? 0.3 : 0.85} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
