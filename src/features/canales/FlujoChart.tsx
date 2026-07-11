import { useMemo } from 'react';
import type { DiaCanal, Rango } from './types';


const COLOR: Record<string, string> = {
  facebook: '#1877F2',
  instagram: '#C13584',
  whatsapp: '#25D366',
};

const NOMBRE: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
};

/**
 * En rangos largos hay demasiados días para dibujar uno por barra: "todo" son
 * más de mil. Se agrupa según el rango — el eje deja de ser el día y pasa a ser
 * la semana o el mes, pero la forma de la curva se conserva.
 */
type Grano = 'dia' | 'semana' | 'mes';

const GRANO: Record<Rango, Grano> = {
  '7d': 'dia',
  '30d': 'dia',
  '90d': 'semana',
  '1y': 'mes',
  todo: 'mes',
};

/** Clave del bucket al que cae un día. El lunes de su semana, o su mes. */
function bucketDe(dia: string, grano: Grano): string {
  if (grano === 'mes') return dia.slice(0, 7); // YYYY-MM
  if (grano === 'dia') return dia;
  const d = new Date(dia + 'T00:00:00Z');
  const diaSemana = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - diaSemana);
  return d.toISOString().slice(0, 10);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function etiqueta(bucket: string, grano: Grano): string {
  if (grano === 'mes') {
    const [a, m] = bucket.split('-');
    return `${MESES[Number(m) - 1]} ${a.slice(2)}`;
  }
  const [, m, d] = bucket.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]}`;
}

/**
 * Cuándo entró la gente, y por dónde.
 *
 * Es lo que vuelve útil al filtro de fechas: el número del hero dice cuántos
 * son, esto dice si están llegando o si el canal se apagó. Un canal plano en
 * los últimos 30 días no es un canal sano, aunque su total histórico sea enorme.
 */
export default function FlujoChart({ porDia, rango }: { porDia: DiaCanal[]; rango: Rango }) {
  const grano = GRANO[rango];

  const { barras, canales, maximo } = useMemo(() => {
    const acc = new Map<string, Record<string, number>>();
    const vistos = new Set<string>();

    for (const fila of porDia) {
      const b = bucketDe(fila.dia, grano);
      const actual = acc.get(b) ?? {};
      actual[fila.canal] = (actual[fila.canal] ?? 0) + fila.n;
      acc.set(b, actual);
      vistos.add(fila.canal);
    }

    const barras = [...acc.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, porCanal]) => ({
        bucket,
        porCanal,
        total: Object.values(porCanal).reduce((s, n) => s + n, 0),
      }));

    return {
      barras,
      canales: [...vistos].sort(),
      maximo: Math.max(1, ...barras.map((b) => b.total)),
    };
  }, [porDia, grano]);

  if (barras.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">
          No entró nada por ningún canal en este rango.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-sm font-bold text-navy">Cuándo entró la gente</h2>
        <div className="flex flex-wrap gap-3">
          {canales.map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: COLOR[c] ?? '#94A3B8' }}
              />
              {NOMBRE[c] ?? c}
            </span>
          ))}
        </div>
      </div>

      {/* Barras apiladas: la altura es el total del período, los tramos son los
          canales. Ver los tramos juntos es lo que muestra cuál se apagó. */}
      <div className="flex h-36 items-end gap-[3px]">
        {barras.map((b) => (
          <div
            key={b.bucket}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${etiqueta(b.bucket, grano)} — ${b.total.toLocaleString('es')}`}
          >
            <div
              className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-70"
              style={{ height: `${(b.total / maximo) * 100}%` }}
            >
              {canales.map((c) => {
                const n = b.porCanal[c] ?? 0;
                if (n === 0) return null;
                return (
                  <div
                    key={c}
                    style={{
                      height: `${(n / b.total) * 100}%`,
                      backgroundColor: COLOR[c] ?? '#94A3B8',
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Solo los extremos y el medio: con 60 barras, etiquetar todas es ruido. */}
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>{etiqueta(barras[0].bucket, grano)}</span>
        {barras.length > 2 && (
          <span>{etiqueta(barras[Math.floor(barras.length / 2)].bucket, grano)}</span>
        )}
        <span>{etiqueta(barras[barras.length - 1].bucket, grano)}</span>
      </div>
    </div>
  );
}
