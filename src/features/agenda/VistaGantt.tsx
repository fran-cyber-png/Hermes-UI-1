import { useMemo } from 'react';
import type { Recordatorio } from './agenda';
import { armarGantt, diasEntre, type BarraGantt } from './gantt';
import { formatoTelefono } from '../../lib/formato';
import { mismaFecha } from './fechas';
import { tipoDeActividad, type TipoNota } from './tipoDeNota';
import { colorPuntoImportancia } from './importancia';

/**
 * EL GANTT — la agenda leída como duración, no como casillero.
 *
 * Una fila por promesa: a la izquierda qué es y de quién, a la derecha la barra
 * sobre el eje de días. El largo de la barra **es el margen que queda** (o la
 * deuda acumulada, si ya venció) — la regla vive pura en `gantt.ts`.
 *
 * **Sin oro salvo la columna de hoy.** En Hermes el dorado significa una sola
 * cosa, tiempo que se acaba (`src/index.css`), y acá eso es exactamente la
 * línea del día de hoy; el tipo de acción se pinta con su color de siempre.
 */

/**
 * Ancho FIJO de cada día. No es `1fr`: con la grilla estirándose, tres semanas
 * entraban a la fuerza en el ancho de la pantalla y se veían tres días —el eje
 * dejaba de ser un eje. Con un ancho fijo el tramo se recorre con scroll, que
 * es como se lee un Gantt.
 */
const ANCHO_DIA = '3.5rem';

/**
 * El color de una barra, **con su color de texto**.
 *
 * 🔴 Cada par sale de un token y su `-foreground` hermano, nunca de un color de
 * marca suelto: `--navy` no se redefine en el tema oscuro y `bg-navy/30` con
 * texto blanco encima daba una barra ilegible (el mismo defecto que tenía el
 * chip `otro`, ver `tipoDeNota.ts`).
 */
const COLOR_TIPO: Record<TipoNota, string> = {
  llamada: 'bg-primary text-primary-foreground',
  wsp: 'bg-success text-success-foreground',
  correo: 'bg-secondary text-secondary-foreground',
  reunion: 'bg-navy text-white',
  seguimiento: 'bg-navy-muted text-white',
  recordatorio: 'bg-muted text-foreground',
  otro: 'bg-muted text-foreground',
};

function colorDeBarra(b: BarraGantt): string {
  if (b.estado === 'hecha') return 'bg-muted text-muted-foreground line-through';
  if (b.estado === 'vencida') return 'bg-destructive text-white';
  return COLOR_TIPO[tipoDeActividad(b.r)];
}

/** Lo que la barra dice de sí misma al pasar el mouse: por qué mide lo que mide. */
function tituloDeBarra(b: BarraGantt, hoy: Date): string {
  const dias = Math.abs(diasEntre(hoy, new Date(b.r.cuando)));
  if (b.estado === 'hecha') return `${b.r.nota} · hecho`;
  if (b.estado === 'vencida') return `${b.r.nota} · vencida hace ${dias === 0 ? 'menos de un día' : `${dias} día${dias === 1 ? '' : 's'}`}`;
  return `${b.r.nota} · ${dias === 0 ? 'vence hoy' : `quedan ${dias} día${dias === 1 ? '' : 's'}`}`;
}

function EtiquetaFila({ r }: { r: Recordatorio }) {
  const quien =
    r.personaNombre ?? (r.personaId ? formatoTelefono(r.personaId) : 'sin conversación atada');
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-secondary font-heading text-[11px] font-bold text-secondary-foreground">
        {(r.personaNombre ?? r.personaId ?? '·').replace(/^@/, '').slice(0, 2).toUpperCase()}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          {r.importancia && <span className={`size-1.5 shrink-0 rounded-full ${colorPuntoImportancia(r.importancia)}`} />}
          <span className={'block truncate text-xs font-semibold ' + (r.estado === 'hecho' ? 'text-muted-foreground line-through' : 'text-foreground')}>
            {r.nota}
          </span>
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{quien}</span>
      </span>
    </div>
  );
}

export function VistaGantt({
  dias,
  hoy,
  recordatorios,
  onVer,
}: {
  dias: Date[];
  hoy: Date;
  recordatorios: Recordatorio[];
  onVer: (r: Recordatorio) => void;
}) {
  const barras = useMemo(() => armarGantt(recordatorios, dias, hoy), [recordatorios, dias, hoy]);
  const grilla = { gridTemplateColumns: `repeat(${dias.length}, ${ANCHO_DIA})` };

  if (barras.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="max-w-sm rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          Nada que mostrar en este tramo. El Gantt dibuja el tiempo que le queda a cada promesa — movete con ‹ › o
          tocá <span className="font-semibold">Hoy</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-w-max">
        {/* ── Columna de las promesas: qué es y de quién ── */}
        <div className="sticky left-0 z-20 w-64 shrink-0 border-r border-border bg-card">
          <div className="h-11 border-b border-border px-3 py-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Seguimiento
            </span>
          </div>
          {barras.map((b) => (
            <button
              key={b.r.id}
              type="button"
              onClick={() => onVer(b.r)}
              className="flex h-14 w-full items-center border-b border-border/60 px-3 text-left transition-colors hover:bg-secondary/30"
            >
              <EtiquetaFila r={b.r} />
            </button>
          ))}
        </div>

        {/* ── El eje del tiempo y las barras ── */}
        <div className="relative w-max">
          {/* Cabecera: día y letra de la semana, como en un Gantt de verdad */}
          <div className="grid h-11 border-b border-border" style={grilla}>
            {dias.map((d) => {
              const esHoy = mismaFecha(d, hoy);
              const finde = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={d.toISOString()}
                  className={
                    'flex flex-col items-center justify-center border-r border-border/40 last:border-r-0 ' +
                    (finde ? 'bg-muted/30 ' : '')
                  }
                >
                  <span className={'font-mono text-[11px] tabular-nums ' + (esHoy ? 'font-bold text-gold-ink' : 'text-muted-foreground')}>
                    {d.toLocaleDateString('es', { day: 'numeric', month: 'short' })}
                  </span>
                  <span className={'font-mono text-[11px] uppercase ' + (esHoy ? 'font-bold text-gold-ink' : 'text-muted-foreground/60')}>
                    {d.toLocaleDateString('es', { weekday: 'short' })}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Fondo: la grilla punteada de días y la columna de hoy */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 top-11 grid" style={grilla}>
            {dias.map((d) => {
              const esHoy = mismaFecha(d, hoy);
              const finde = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div
                  key={d.toISOString()}
                  className={
                    'border-r border-dashed border-border/40 last:border-r-0 ' +
                    (esHoy ? 'bg-gold/10 ' : finde ? 'bg-muted/20 ' : '')
                  }
                />
              );
            })}
          </div>

          {/* Las barras, una fila por promesa */}
          {barras.map((b) => (
            <div key={b.r.id} className="relative grid h-14 items-center border-b border-border/60" style={grilla}>
              <button
                type="button"
                onClick={() => onVer(b.r)}
                title={tituloDeBarra(b, hoy)}
                style={{ gridColumn: `${b.desde + 1} / span ${b.ancho}` }}
                className={
                  'relative z-10 mx-1 flex h-9 min-w-0 items-center gap-1.5 px-2 text-left text-[11px] font-semibold transition-[filter,transform] duration-200 ease-house hover:brightness-110 active:scale-[0.99] ' +
                  colorDeBarra(b) +
                  ' ' +
                  // Una punta recta avisa que el tramo sigue fuera de la ventana.
                  (b.cortadaIzquierda ? 'rounded-l-none ' : 'rounded-l-lg ') +
                  (b.cortadaDerecha ? 'rounded-r-none' : 'rounded-r-lg')
                }
              >
                <span className="truncate">{b.r.nota}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums opacity-80">
                  {new Date(b.r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
