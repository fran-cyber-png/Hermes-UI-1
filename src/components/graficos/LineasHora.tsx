import { useState } from 'react';

/**
 * COBERTURA HORARIA — el gráfico que muestra el agujero de la noche (#126).
 *
 * LA PREGUNTA: ¿a qué horas nos escriben y a qué horas contestamos? Dos series
 * en la MISMA unidad (mensajes) sobre 24 horas ⇒ **dos líneas, un solo eje**.
 * Nunca dos escalas: la alineación entre dos ejes es arbitraria e inventa una
 * correlación que no está en los datos. Acá no hace falta — mensajes y mensajes
 * se miden igual, y la DISTANCIA entre las dos líneas ES la historia.
 *
 * Decisiones que no son cosméticas:
 * · Las 24 horas se dibujan siempre, vengan o no con datos: el hueco es el dato.
 * · La franja fuera de horario va sombreada en gris, no en oro. El oro de la
 *   marca significa «se le acaba el tiempo a ESTA persona»; un rango de horas es
 *   contexto, no urgencia. Gastarlo acá lo devalúa donde sí importa.
 * · Rótulo directo SOLO en el pico de cada serie. Un número sobre las 24 horas
 *   es ruido que nadie lee; el eje, el pico y el hover alcanzan.
 * · Leyenda siempre (son dos series): la identidad nunca depende del color solo.
 * · El hover no flota un tooltip que se recorte adentro de una tarjeta: mueve la
 *   línea viva de arriba, el mismo patrón que `Columnas`. Con teclado, las
 *   flechas hacen exactamente lo mismo que el puntero.
 * · Tabla gemela a un click: ningún valor queda detrás de un hover.
 *
 * TÉCNICA: el SVG escala con `preserveAspectRatio="none"` (así el ancho sigue a
 * la tarjeta sin medir el DOM) y los trazos se defienden con
 * `vector-effect="non-scaling-stroke"`, que los mantiene en 2px reales. Todo lo
 * que se deformaría con ese estirado —texto, puntos, franjas— es HTML posicionado
 * en porcentaje, no SVG.
 */

export interface PuntoHora {
  hora: number;
  entran: number;
  salen: number;
}

const SERIES = [
  { id: 'entran', label: 'Entran', ayuda: 'mensajes de la gente', color: 'var(--primary)' },
  { id: 'salen', label: 'Salen', ayuda: 'nuestras respuestas', color: 'var(--cat-naranja)' },
] as const;

type IdSerie = (typeof SERIES)[number]['id'];

const hh = (h: number) => `${String(h).padStart(2, '0')}h`;

/** El centro de la banda de esa hora, en % del ancho. */
const x = (hora: number) => ((hora + 0.5) / 24) * 100;

export function LineasHora({
  puntos,
  apertura,
  cierre,
  alto = 128,
}: {
  puntos: PuntoHora[];
  /** Primera hora del turno (inclusive) — la franja anterior va sombreada. */
  apertura: number;
  /** Primera hora ya fuera del turno (exclusiva). */
  cierre: number;
  alto?: number;
}) {
  const [activa, setActiva] = useState<number | null>(null);
  const [tabla, setTabla] = useState(false);

  const max = Math.max(1, ...puntos.map((p) => Math.max(p.entran, p.salen)));
  const y = (v: number) => (1 - v / max) * 100;
  const linea = (serie: IdSerie) => puntos.map((p) => `${x(p.hora).toFixed(2)},${y(p[serie]).toFixed(2)}`).join(' ');

  const picos: Record<IdSerie, PuntoHora | null> = {
    entran: pico(puntos, 'entran'),
    salen: pico(puntos, 'salen'),
  };
  const p = activa !== null ? (puntos.find((q) => q.hora === activa) ?? null) : null;

  const resumen =
    `Mensajes por hora del día (${puntos.reduce((n, q) => n + q.entran, 0)} entrantes, ` +
    `${puntos.reduce((n, q) => n + q.salen, 0)} salientes). Pico de entrada a las ` +
    `${picos.entran ? hh(picos.entran.hora) : '—'}.`;

  return (
    <figure className="m-0 flex min-h-0 min-w-0 flex-1 flex-col">
      {/* La línea viva: el resumen por defecto, el valor de la hora bajo el puntero. */}
      <figcaption className="mb-1 flex min-h-4 items-baseline gap-2 text-[11px] text-muted-foreground">
        {p ? (
          <span className="truncate">
            <span className="font-mono tabular-nums text-foreground">{hh(p.hora)}</span> ·{' '}
            <span className="font-mono font-semibold tabular-nums text-foreground">{p.entran}</span> entran ·{' '}
            <span className="font-mono font-semibold tabular-nums text-foreground">{p.salen}</span> salen
          </span>
        ) : (
          <span className="truncate">
            De {hh(cierre)} a {hh(apertura)} no hay nadie atendiendo — el hueco entre las dos líneas es eso.
          </span>
        )}
        <button
          type="button"
          onClick={() => setTabla((v) => !v)}
          className="ml-auto shrink-0 rounded px-1 font-semibold text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {tabla ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      </figcaption>

      {tabla ? (
        // Misma altura EXACTA que el gráfico: conmutar a la tabla no puede
        // empujar el resto de la pantalla hacia abajo (eso es un salto de layout,
        // no una vista alternativa). La tabla scrollea adentro.
        <div className="overflow-y-auto rounded-lg border border-border" style={{ height: alto + 16 }}>
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-2 py-1 text-left font-medium">Hora</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Entran</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Salen</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {puntos.map((q) => (
                <tr key={q.hora} className={q.hora < apertura || q.hora >= cierre ? 'bg-muted/60' : undefined}>
                  <td className="px-2 py-0.5 text-muted-foreground">{hh(q.hora)}</td>
                  <td className="px-2 py-0.5 text-right text-foreground">{q.entran}</td>
                  <td className="px-2 py-0.5 text-right text-foreground">{q.salen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="img"
          aria-label={resumen}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const paso = e.key === 'ArrowRight' ? 1 : -1;
            setActiva((h) => Math.min(23, Math.max(0, (h === null ? (paso > 0 ? -1 : 24) : h) + paso)));
          }}
          onBlur={() => setActiva(null)}
          onMouseLeave={() => setActiva(null)}
          className="relative w-full rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          style={{ height: alto }}
        >
          {/* Fuera de horario: contexto en gris, nunca en oro. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 bg-muted-foreground/[0.07]" style={{ width: `${(apertura / 24) * 100}%` }} />
          <div className="pointer-events-none absolute inset-y-0 right-0 bg-muted-foreground/[0.07]" style={{ width: `${((24 - cierre) / 24) * 100}%` }} />

          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
            {/* Grilla: hairline sólida, un paso por debajo de la superficie. */}
            {[0, 50, 100].map((v) => (
              <line key={v} x1="0" x2="100" y1={v} y2={v} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {activa !== null && (
              <line
                x1={x(activa)}
                x2={x(activa)}
                y1="0"
                y2="100"
                stroke="var(--muted-foreground)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {SERIES.map((s) => (
              <polyline
                key={s.id}
                points={linea(s.id)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          {/* Marcas y rótulos: HTML, para que el estirado del SVG no los deforme. */}
          {SERIES.map((s) => {
            const pk = picos[s.id];
            if (!pk) return null;
            return (
              <span
                key={s.id}
                className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums text-foreground"
                style={{
                  left: `${x(pk.hora)}%`,
                  top: `calc(${y(pk[s.id])}% ${s.id === 'entran' ? '- 15px' : '+ 4px'})`,
                }}
              >
                {pk[s.id]}
              </span>
            );
          })}
          {p &&
            SERIES.map((s) => (
              <span
                key={s.id}
                className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                style={{ left: `${x(p.hora)}%`, top: `${y(p[s.id])}%`, backgroundColor: s.color }}
              />
            ))}

          {/* Zona sensible: una banda por hora, del alto completo — nadie tiene que
              apuntarle a una línea de 2px. A 640px de ancho son 26px por banda. */}
          <div className="absolute inset-0 flex">
            {puntos.map((q) => (
              <span key={q.hora} onMouseEnter={() => setActiva(q.hora)} className="h-full flex-1" />
            ))}
          </div>
        </div>
      )}

      {!tabla && (
        <div className="mt-0.5 flex">
          {puntos.map((q) => (
            <span key={q.hora} className="min-w-0 flex-1 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
              {q.hora % 6 === 0 ? String(q.hora).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
      )}

      {/* Leyenda: siempre, porque son dos series. Llave de LÍNEA, no cuadrito. */}
      <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-foreground">{s.label}</span>
            <span>{s.ayuda}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-muted-foreground/20" />
          fuera de horario
        </span>
      </div>
    </figure>
  );
}

function pico(puntos: PuntoHora[], serie: IdSerie): PuntoHora | null {
  let mejor: PuntoHora | null = null;
  for (const p of puntos) if (p[serie] > 0 && (mejor === null || p[serie] > mejor[serie])) mejor = p;
  return mejor;
}
