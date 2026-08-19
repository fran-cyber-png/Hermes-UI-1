import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MODOS, MODO_ROTULO, type Modo } from '../modos';

/**
 * LA BARRA DE LA AGENDA.
 *
 * **«Hoy» vive en el CENTRO, pegado al título, y no en la esquina.** El botón y
 * el título contestan la misma pregunta —«¿dónde estoy parada?»— y separados
 * obligaban a cruzar la pantalla para volver: se lee «hoy, miércoles 9 de
 * septiembre» de un tirón. En la izquierda quedan solo las flechas, que son lo
 * único que mueve el foco.
 */

interface CalendarHeaderProps {
  title: string;
  modo: Modo;
  overdue?: number;
  /** `true` cuando el foco ya está en el día de hoy: «Hoy» se ve encendido y no hace nada. */
  enHoy?: boolean;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onModoChange: (modo: Modo) => void;
  onCreateClick: () => void;
}

export function CalendarHeader({
  title,
  modo,
  overdue = 0,
  enHoy = false,
  onToday,
  onPrevious,
  onNext,
  onModoChange,
  onCreateClick,
}: CalendarHeaderProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Izquierda: solo la navegación */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={onPrevious}
            className="rounded p-1 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Período anterior"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded p-1 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Período siguiente"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Centro: «Hoy» + el título, que se leen juntos */}
      <div className="min-w-0 flex-1 sm:px-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onToday}
            aria-current={enHoy ? 'date' : undefined}
            className={
              'shrink-0 rounded-full px-3 py-1 text-xs font-bold transition-all duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ' +
              (enHoy
                ? 'bg-navy text-white'
                : 'border border-border text-foreground hover:border-primary hover:bg-secondary/30')
            }
          >
            Hoy
          </button>
          <h1 className="truncate font-heading text-2xl font-bold text-foreground">{title}</h1>
        </div>
        {overdue > 0 && (
          <p className="mt-1 text-center text-xs font-medium text-destructive">
            {overdue} vencida{overdue === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {/* Derecha: modo y crear. El tema se elige en la barra de la app —no acá:
          no es una preferencia de la Agenda, es de toda la mesa. */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {MODOS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModoChange(m)}
              className={
                'rounded px-2.5 py-1 text-xs font-semibold transition-all duration-150 ' +
                (modo === m
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary/30 hover:text-foreground')
              }
            >
              {MODO_ROTULO[m]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCreateClick}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all duration-150 hover:bg-primary/90 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          + Crear
        </button>
      </div>
    </div>
  );
}
