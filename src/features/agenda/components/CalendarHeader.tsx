import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DarkModeToggle } from './DarkModeToggle';

interface CalendarHeaderProps {
  title: string;
  modo: 'mes' | 'semana' | 'dia';
  overdue?: number;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onModoChange: (modo: 'mes' | 'semana' | 'dia') => void;
  onCreateClick: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export function CalendarHeader({
  title,
  modo,
  overdue = 0,
  onToday,
  onPrevious,
  onNext,
  onModoChange,
  onCreateClick,
  containerRef,
}: CalendarHeaderProps) {
  const MODOS = ['mes', 'semana', 'dia'] as const;
  const MODO_LABELS: Record<typeof MODOS[number], string> = {
    mes: 'Mes',
    semana: 'Semana',
    dia: 'Día',
  };

  return (
    <div className="flex flex-col gap-3 border-b border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: Navigation */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToday}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-all duration-150 hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Today
        </button>
        <div className="flex gap-1 rounded-lg border border-border p-1">
          <button
            onClick={onPrevious}
            className="rounded p-1 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Previous period"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={onNext}
            className="rounded p-1 text-muted-foreground transition-all duration-150 hover:bg-secondary/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Next period"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Center: Title & Info */}
      <div className="min-w-0 flex-1 text-center sm:px-4">
        <h1 className="font-heading text-2xl font-bold text-foreground">{title}</h1>
        {overdue > 0 && (
          <p className="text-xs text-destructive font-medium mt-1">
            {overdue} overdue
          </p>
        )}
      </div>

      {/* Right: Mode, Dark Mode & Create Button */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {MODOS.map((m) => (
            <button
              key={m}
              onClick={() => onModoChange(m)}
              className={
                'rounded px-2.5 py-1 text-xs font-semibold transition-all duration-150 ' +
                (modo === m
                  ? 'bg-navy text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary/30 hover:text-foreground')
              }
            >
              {MODO_LABELS[m]}
            </button>
          ))}
        </div>
        <DarkModeToggle containerRef={containerRef} />
        <button
          onClick={onCreateClick}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition-all duration-150 hover:bg-primary/90 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          + Create
        </button>
      </div>
    </div>
  );
}
