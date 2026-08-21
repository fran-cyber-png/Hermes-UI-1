import { EventCard } from './EventCard';
import type { Recordatorio } from '../agenda';
import { mismaFecha } from '../fechas';

interface DayColumnProps {
  fecha: Date;
  eventos: Recordatorio[];
  hoy: Date;
  ahora: Date;
  onView: (r: Recordatorio) => void;
  onDragStart?: (e: React.DragEvent, r: Recordatorio) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, fecha: Date) => void;
  draggedRecordatorio?: { r: Recordatorio; hora: number } | null;
}

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export function DayColumn({
  fecha,
  eventos,
  hoy,
  ahora,
  onView,
  onDragStart,
  onDragOver,
  onDrop,
  draggedRecordatorio,
}: DayColumnProps) {
  const esHoy = mismaFecha(fecha, hoy);
  const diasDiaFecha = fecha.toLocaleDateString('en', { weekday: 'short', day: 'numeric' });

  // Agrupar eventos por hora
  const eventosPorHora = new Map<number, Recordatorio[]>();
  eventos.forEach((r) => {
    const hora = new Date(r.cuando).getHours();
    if (!eventosPorHora.has(hora)) {
      eventosPorHora.set(hora, []);
    }
    eventosPorHora.get(hora)!.push(r);
  });

  return (
    <div className="flex-1 flex flex-col min-w-0 border-r border-border last:border-r-0 bg-card">
      {/* Header */}
      <div
        className={
          'h-12 shrink-0 border-b border-border flex items-center justify-center ' +
          (esHoy ? 'bg-navy text-white' : 'bg-card text-foreground')
        }
      >
        <div className="text-center">
          <div className="font-mono text-[11px] opacity-70">{diasDiaFecha.substring(0, 2).toUpperCase()}</div>
          <div className="font-semibold text-sm">{diasDiaFecha.split(' ')[1]}</div>
        </div>
      </div>

      {/* Hours grid */}
      <div className="flex-1 overflow-hidden relative">
        {HORAS.map((hora) => {
          const horaEventos = eventosPorHora.get(hora) || [];

          return (
            <div
              key={hora}
              onDragOver={onDragOver}
              onDrop={(e) => {
                if (onDrop) {
                  const nuevaFecha = new Date(fecha);
                  nuevaFecha.setHours(hora, 0, 0, 0);
                  onDrop(e, nuevaFecha);
                }
              }}
              className="h-[60px] border-b border-border/20 p-1 overflow-hidden hover:bg-secondary/5 transition-colors cursor-default"
            >
              {/* Events in this hour */}
              <div className="flex flex-col gap-1 h-full overflow-y-auto">
                {horaEventos.map((evento) => {
                  const vencido =
                    new Date(evento.cuando) < ahora && evento.estado !== 'hecho';

                  return (
                    <EventCard
                      key={evento.id}
                      recordatorio={evento}
                      vencido={vencido}
                      onView={onView}
                      onDragStart={onDragStart}
                      draggable={true}
                      isDragging={
                        draggedRecordatorio?.r.id === evento.id
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
