import { useMemo } from 'react';
import type { Rango } from '../canales/types';
import type { DiaFlujo } from '../../lib/datos/overview';

/**
 * LA PUERTA CERRÁNDOSE.
 *
 * ── Qué reemplaza ──
 * El gráfico viejo mostraba "cuándo entró la gente", apilado por canal. Verdadero e inútil:
 * no respondía ninguna pregunta, y el canal —ya lo sabemos— no cambia ninguna decisión.
 *
 * ── Qué muestra ──
 * Cada día, partido por lo ÚNICO que decide si se puede hacer algo: la ventana de Meta.
 *
 *   🟠 Se puede responder  — la ventana sigue abierta. Es EL trabajo.
 *   🟢 Respondida          — la trabajamos.
 *   ⬜ Meta cerró          — no se les puede escribir. Nunca. No es deuda: es archivo.
 *
 * Sobre 30 días la imagen es brutal y es verdadera: una pared gris enorme, y una franja viva de
 * unos pocos días al final. Eso es todo el negocio en una imagen, y ningún contador de
 * pendientes lo puede decir.
 *
 * ── Los colores ──
 * Es una paleta de ESTADO, no categórica. Salen de la propia escala de temperatura del sistema
 * (`temp-fresco` / `temp-frio` / `temp-helado`), y están validados: contraste ≥ 3:1 sobre la
 * superficie y ΔE 22,8 de separación para daltonismo (el piso es 12).
 *
 * El gris "lee como gris" a propósito: lo cerrado tiene que verse inerte.
 */

const ESTADO = {
  abiertas: { color: '#C2410C', nombre: 'Se puede responder' },
  respondidas: { color: '#16A34A', nombre: 'Respondida' },
  cerradas: { color: '#64748B', nombre: 'Meta cerró la puerta' },
} as const;

/** El orden de apilado: lo vivo arriba, lo muerto abajo. Se lee de un vistazo. */
const ORDEN = ['cerradas', 'respondidas', 'abiertas'] as const;

type Grano = 'dia' | 'semana' | 'mes';

const GRANO: Record<Rango, Grano> = {
  '7d': 'dia',
  '30d': 'dia',
  '90d': 'semana',
  '1y': 'mes',
  todo: 'mes',
};

function bucketDe(dia: string, grano: Grano): string {
  if (grano === 'mes') return dia.slice(0, 7);
  if (grano === 'dia') return dia;
  const d = new Date(dia + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // al lunes de su semana
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

export default function FlujoVentana({ flujo, rango }: { flujo: DiaFlujo[]; rango: Rango }) {
  const grano = GRANO[rango];

  const { barras, maximo, totales } = useMemo(() => {
    const acc = new Map<string, { abiertas: number; respondidas: number; cerradas: number }>();

    for (const d of flujo) {
      const b = bucketDe(d.dia, grano);
      const a = acc.get(b) ?? { abiertas: 0, respondidas: 0, cerradas: 0 };
      a.abiertas += d.abiertas;
      a.respondidas += d.respondidas;
      a.cerradas += d.cerradas;
      acc.set(b, a);
    }

    const barras = [...acc.entries()]
      .sort((x, y) => x[0].localeCompare(y[0]))
      .map(([bucket, v]) => ({
        bucket,
        ...v,
        total: v.abiertas + v.respondidas + v.cerradas,
      }));

    const totales = barras.reduce(
      (s, b) => ({
        abiertas: s.abiertas + b.abiertas,
        respondidas: s.respondidas + b.respondidas,
        cerradas: s.cerradas + b.cerradas,
      }),
      { abiertas: 0, respondidas: 0, cerradas: 0 },
    );

    return { barras, maximo: Math.max(1, ...barras.map((b) => b.total)), totales };
  }, [flujo, grano]);

  /**
   * Dónde cae el corte de 7 días — el borde de la ventana de Meta.
   *
   * Es LA línea del negocio: todo lo que quedó a su izquierda es inalcanzable para siempre.
   * Solo se dibuja con grano diario; agrupado por semana o mes, un corte de 7 días cae adentro
   * de una barra y marcarlo mentiría.
   */
  const corteVentana = useMemo(() => {
    if (grano !== 'dia' || barras.length === 0) return null;
    const limite = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const i = barras.findIndex((b) => b.bucket >= limite);
    return i > 0 ? i : null;
  }, [barras, grano]);

  if (barras.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-6 py-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">No entró nadie en este rango.</p>
      </div>
    );
  }

  const total = totales.abiertas + totales.respondidas + totales.cerradas;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-sm font-bold text-navy">La puerta cerrándose</h2>
        <span className="text-xs text-muted-foreground">pico: {maximo.toLocaleString('es')}/día</span>
      </div>

      {/* La frase que el gráfico dibuja. Un gráfico que necesita explicación falló; este la
          trae escrita, y los números vienen de la misma consulta que las barras. */}
      <p className="mb-4 text-xs text-muted-foreground">
        De {total.toLocaleString('es')} personas que escribieron,{' '}
        <strong className="text-foreground">
          Meta ya cerró la puerta a {totales.cerradas.toLocaleString('es')}
        </strong>
        . Quedan {totales.abiertas.toLocaleString('es')} a las que todavía se les puede responder.
      </p>

      {/* Barras apiladas. 2px de separación entre segmentos y entre barras: sin eso, dos colores
          adyacentes se leen como uno solo. */}
      <div className="relative flex h-40 items-end gap-[3px]">
        {/* La ventana de Meta. A la izquierda de esta línea, la puerta ya está cerrada. */}
        {corteVentana != null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-navy/40"
            style={{ left: `${(corteVentana / barras.length) * 100}%` }}
          >
            <span className="absolute -top-4 left-1.5 whitespace-nowrap text-[10px] font-bold text-navy/70">
              ← cerrado · abierto →
            </span>
          </div>
        )}

        {barras.map((b) => (
          <div
            key={b.bucket}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={
              `${etiqueta(b.bucket, grano)} — ${b.total.toLocaleString('es')} en total\n` +
              `Se puede responder: ${b.abiertas}\n` +
              `Respondidas: ${b.respondidas}\n` +
              `Meta cerró: ${b.cerradas}`
            }
          >
            <div
              className="flex w-full flex-col justify-end gap-[2px] transition-opacity group-hover:opacity-70"
              style={{ height: `${(b.total / maximo) * 100}%` }}
            >
              {ORDEN.map((k) => {
                const n = b[k];
                if (n === 0) return null;
                const esArriba = k === 'abiertas' && b.abiertas > 0;
                return (
                  <div
                    key={k}
                    style={{
                      height: `${(n / b.total) * 100}%`,
                      backgroundColor: ESTADO[k].color,
                      // El extremo de la barra se redondea; los tramos internos no.
                      borderRadius: esArriba ? '3px 3px 0 0' : undefined,
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>{etiqueta(barras[0].bucket, grano)}</span>
        {barras.length > 2 && (
          <span>{etiqueta(barras[Math.floor(barras.length / 2)].bucket, grano)}</span>
        )}
        <span>{etiqueta(barras[barras.length - 1].bucket, grano)}</span>
      </div>

      {/* Leyenda con el número al lado: la identidad nunca depende solo del color. */}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
        {ORDEN.slice()
          .reverse()
          .map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-xs">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: ESTADO[k].color }}
              />
              <span className="text-muted-foreground">{ESTADO[k].nombre}</span>
              <strong className="tabular-nums text-foreground">
                {totales[k].toLocaleString('es')}
              </strong>
            </span>
          ))}
      </div>
    </div>
  );
}
