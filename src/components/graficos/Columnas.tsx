import { useState } from 'react';

/**
 * COLUMNAS — la serie diaria en voz de imprenta (spec-charts.md).
 *
 * Una sola serie (el desglose vive en la línea viva, no en colores apilados):
 * columnas finas azul --primary, hoy al 100%, el pasado atenuado. Sin grilla,
 * sin animación: la gráfica informa quieta. El hover no flota un tooltip que
 * se recorte en el riel — reemplaza la línea de resumen de arriba (línea viva).
 */

export interface PuntoDia {
  /** 'YYYY-MM-DD' */
  dia: string;
  total: number;
  /** Desglose humano para la línea viva: '9 chats · 3 comentarios · 2 formularios' */
  detalle?: string;
}

function etiquetaDia(dia: string): string {
  const d = new Date(dia + 'T12:00:00');
  return d.toLocaleDateString('es', { day: 'numeric' });
}

function etiquetaLarga(dia: string): string {
  const d = new Date(dia + 'T12:00:00');
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function Columnas({
  puntos,
  resumen,
  unidad,
  alto = 64,
}: {
  puntos: PuntoDia[];
  /** El resumen humano por defecto de la línea viva ("Esta semana cayeron 89; la pasada, 61."). */
  resumen: string;
  /** Sustantivo del total en la línea viva: 'leads', 'mensajes'… */
  unidad: string;
  alto?: number;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(1, ...puntos.map((p) => p.total));
  const p = activo != null ? puntos[activo] : null;

  return (
    <figure role="img" aria-label={resumen} className="m-0">
      <figcaption className="mb-1.5 min-h-4 text-xs text-muted-foreground">
        {p ? (
          <>
            <span className="font-mono tabular-nums text-foreground">
              {etiquetaLarga(p.dia)} · {p.total} {unidad}
            </span>
            {p.detalle && <span> — {p.detalle}</span>}
          </>
        ) : (
          resumen
        )}
      </figcaption>
      <div className="flex items-end gap-[2px] border-b border-border pb-px" style={{ height: alto }} onMouseLeave={() => setActivo(null)}>
        {puntos.map((punto, i) => {
          const esHoy = i === puntos.length - 1;
          return (
            <div
              key={punto.dia}
              onMouseEnter={() => setActivo(i)}
              title={`${etiquetaLarga(punto.dia)} · ${punto.total} ${unidad}${punto.detalle ? ` — ${punto.detalle}` : ''}`}
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
            >
              <div
                className={
                  'w-full rounded-t-[2px] transition-opacity ' +
                  (punto.total === 0
                    ? 'h-px bg-border'
                    : (esHoy ? 'bg-primary' : 'bg-primary/60') + (activo === i ? ' opacity-100' : activo != null ? ' opacity-50' : ''))
                }
                style={punto.total > 0 ? { height: `${Math.max(6, (punto.total / max) * 100)}%` } : undefined}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {puntos.map((punto, i) => (
          <span key={punto.dia} className="min-w-0 flex-1 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
            {i % 3 === 0 || i === puntos.length - 1 ? etiquetaDia(punto.dia) : ''}
          </span>
        ))}
      </div>
    </figure>
  );
}
