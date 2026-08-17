import { useState, useRef, useEffect } from 'react';
import type { Recordatorio } from './agenda';
import { mismaFecha } from './fechas';
import { TimeColumn } from './components/TimeColumn';
import { DayColumn } from './components/DayColumn';
import { CurrentTimeIndicator } from './components/CurrentTimeIndicator';

export function VistaSemanaConTimeline({
  diasSemana,
  hoy,
  ahora,
  porDia,
  onVer,
  onActualizarHora,
}: {
  diasSemana: Date[];
  hoy: Date;
  ahora: Date;
  porDia: Map<string, Recordatorio[]>;
  onVer: (r: Recordatorio) => void;
  onActualizarHora: (recordatorioId: number, nuevaHora: Date) => void;
}) {
  const [draggedRecordatorio, setDraggedRecordatorio] = useState<{ r: Recordatorio; hora: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const horasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const gridDiv = scrollRef.current;
    const horasDiv = horasRef.current;
    if (!gridDiv || !horasDiv) return;

    const handleScroll = () => {
      horasDiv.scrollTop = gridDiv.scrollTop;
    };

    gridDiv.addEventListener('scroll', handleScroll);
    return () => gridDiv.removeEventListener('scroll', handleScroll);
  }, []);

  const handleDragStart = (e: React.DragEvent, r: Recordatorio) => {
    const hora = new Date(r.cuando).getHours();
    setDraggedRecordatorio({ r, hora });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, fecha: Date) => {
    e.preventDefault();
    if (!draggedRecordatorio) return;

    const nuevaFecha = new Date(draggedRecordatorio.r.cuando);
    nuevaFecha.setFullYear(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    onActualizarHora(draggedRecordatorio.r.id, nuevaFecha);
    setDraggedRecordatorio(null);
  };

  const ahoraHora = ahora.getHours();
  const ahoraMinuto = ahora.getMinutes();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden relative">
      {/* Timeline de horas */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Columna de horas */}
        <TimeColumn ahora={ahora} />

        {/* Grid de días - scrolleable */}
        <div className="flex min-h-0 flex-1 overflow-y-auto" ref={scrollRef}>
          {diasSemana.map((fecha) => {
            const delDia = porDia.get(fecha.toDateString()) ?? [];

            return (
              <DayColumn
                key={fecha.toISOString()}
                fecha={fecha}
                eventos={delDia}
                hoy={hoy}
                ahora={ahora}
                onView={onVer}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                draggedRecordatorio={draggedRecordatorio}
              />
            );
          })}
        </div>
      </div>

      {/* Current time indicator */}
      {diasSemana.some((f) => mismaFecha(f, hoy)) && (
        <CurrentTimeIndicator horaActual={ahoraHora} minutoActual={ahoraMinuto} />
      )}
    </div>
  );
}
