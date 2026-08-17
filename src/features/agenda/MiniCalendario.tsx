import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Recordatorio } from './agenda';
import { inicioDeSemana, mismaFecha } from './fechas';
import { tipoDominante, BARRA_TIPO } from './tipoDeNota';
import { colorPuntoImportancia } from './importancia';

const DIAS_SEMANA = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

export function MiniCalendario({
  foco,
  onClickDia,
  onCambiarMes,
  porDia,
  hoy,
}: {
  foco: Date;
  onClickDia: (fecha: Date) => void;
  onCambiarMes: (direccion: 1 | -1) => void;
  porDia: Map<string, Recordatorio[]>;
  hoy: Date;
}) {
  const [hoveredDia, setHoveredDia] = useState<Date | null>(null);

  const primerDia = new Date(foco.getFullYear(), foco.getMonth(), 1);
  const desde = inicioDeSemana(primerDia);

  const dias = Array.from({ length: 42 }, (_, i) => new Date(desde.getTime() + i * 86_400_000));

  return (
    <div className="w-72 rounded-lg border border-border bg-card p-4 shadow-sm">
      {/* Encabezado con navegación */}
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onCambiarMes(-1)}
          className="rounded p-1 hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Mes anterior"
        >
          <ChevronLeft size={18} />
        </button>
        <h3 className="font-heading text-sm font-bold text-foreground flex-1 text-center">
          {foco.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
        </h3>
        <button
          type="button"
          onClick={() => onCambiarMes(1)}
          className="rounded p-1 hover:bg-secondary/50 transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Mes siguiente"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Días de semana */}
      <div className="grid grid-cols-7 gap-0 mb-2 px-1">
        {DIAS_SEMANA.map((dia) => (
          <div key={dia} className="text-center font-mono text-[9px] font-bold text-muted-foreground/70 py-1">
            {dia}
          </div>
        ))}
      </div>

      {/* Grid de días */}
      <div className="grid grid-cols-7 gap-0 border border-border/40 rounded">
        {dias.map((fecha) => {
          const delDia = porDia.get(fecha.toDateString()) ?? [];
          const esHoy = mismaFecha(fecha, hoy);
          const esDelMes = fecha.getMonth() === foco.getMonth();
          const tipoMsg = delDia.length > 0 ? tipoDominante(delDia) : null;

          return (
            <div
              key={fecha.toISOString()}
              className={`
                relative aspect-square flex items-center justify-center text-[11px] font-semibold
                border-r border-b border-border/20 last-of-type:border-r-0
                ${Math.floor((dias.indexOf(fecha)) / 7) === Math.ceil(42 / 7) - 1 ? 'border-b-0' : ''}
                ${(dias.indexOf(fecha) + 1) % 7 === 0 ? 'border-r-0' : ''}
                transition-colors
                ${esDelMes ? 'cursor-pointer' : 'cursor-default'}
                ${esHoy
                  ? 'bg-navy text-white ring-inset ring-2 ring-gold'
                  : esDelMes
                    ? 'hover:bg-secondary/30 text-foreground'
                    : 'text-muted-foreground/40 hover:bg-secondary/20'
                }
              `}
              onClick={() => esDelMes && onClickDia(fecha)}
              onMouseEnter={() => setHoveredDia(fecha)}
              onMouseLeave={() => setHoveredDia(null)}
            >
              {fecha.getDate()}

              {/* Punto indicador de recordatorios */}
              {delDia.length > 0 && (
                <div className={`absolute bottom-1 right-1 w-1 h-1 rounded-full ${tipoMsg ? BARRA_TIPO[tipoMsg] : 'bg-muted-foreground/50'}`} />
              )}

              {/* Tooltip al pasar el mouse */}
              {hoveredDia && mismaFecha(hoveredDia, fecha) && delDia.length > 0 && (
                <div className="absolute left-[calc(100%+8px)] top-0 z-50 w-56 rounded-lg bg-card border border-border text-foreground p-3 text-[10px] shadow-xl pointer-events-none">
                  <div className="font-bold mb-2 text-xs">
                    {fecha.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })}
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {delDia.map((r) => (
                      <div key={r.id} className="flex items-start gap-2 p-1.5 rounded bg-secondary/30 hover:bg-secondary/50 transition-colors">
                        {r.importancia && (
                          <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${colorPuntoImportancia(r.importancia)}`} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">{r.nota}</div>
                          <div className="text-[9px] text-muted-foreground">
                            {new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
