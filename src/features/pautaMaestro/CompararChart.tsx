import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { PautaDetalle, PuntoSnapshotPauta } from './types';
import { type MetricaComparar, metricaLabel } from './MetricToggle';
import { colorForId, CHROME } from './chartPalette';

const fmtFecha = (iso: string) => new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short' });

function money(n: number, moneda: string) {
  return `${n.toLocaleString('es', { maximumFractionDigits: 0 })} ${moneda}`;
}

interface Props {
  snapshots: PuntoSnapshotPauta[];
  detalles: PautaDetalle[];
  metrica: MetricaComparar;
  moneda: string;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

export default function CompararChart({ snapshots, detalles, metrica, moneda, hoveredId, onHover }: Props) {
  const datos = useMemo(() => {
    const fechas = Array.from(new Set(snapshots.map((p) => p.fecha))).sort();
    return fechas.map((f) => {
      const punto = snapshots.find((p) => p.fecha === f);
      const fila: Record<string, string | number | null> = { fecha: f };
      for (const d of detalles) {
        const c = punto?.campanas.find((x) => x.id === d.id);
        fila[d.id] = c ? ((c as unknown as Record<string, number | null>)[metrica] ?? null) : null;
      }
      return fila;
    });
  }, [snapshots, detalles, metrica]);

  const esMoneda = metrica === 'gasto' || metrica === 'costoPorResultado';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-bold text-navy">Evolución · {metricaLabel(metrica)}</span>
      </div>
      {datos.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No hay suficientes snapshots en este rango todavía. El reloj acumula uno cada 6 h.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={datos} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHROME.grid} vertical={false} />
            <XAxis dataKey="fecha" tickFormatter={fmtFecha} fontSize={11} minTickGap={24} stroke={CHROME.axis} />
            <YAxis
              fontSize={11}
              width={64}
              stroke={CHROME.axis}
              tickFormatter={(v) =>
                esMoneda ? `${Math.round(Number(v)).toLocaleString('es')}` : `${Number(v).toLocaleString('es')}`
              }
            />
            <Tooltip
              labelFormatter={(l) => fmtFecha(String(l))}
              formatter={(value, name) => {
                const num = Number(value ?? 0);
                const texto = esMoneda ? money(num, moneda) : num.toLocaleString('es');
                return [texto, String(name)];
              }}
            />
            <Legend
              onMouseEnter={(e) => {
                const id = detalles.find((d) => d.nombre === e.value)?.id;
                if (id) onHover(id);
              }}
              onMouseLeave={() => onHover(null)}
            />
            {detalles.map((d) => (
              <Line
                key={d.id}
                type="monotone"
                dataKey={d.id}
                name={d.nombre}
                stroke={colorForId(d.id, detalles.map((x) => x.id))}
                strokeWidth={hoveredId && hoveredId !== d.id ? 1 : 2.5}
                strokeOpacity={hoveredId && hoveredId !== d.id ? 0.35 : 1}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
