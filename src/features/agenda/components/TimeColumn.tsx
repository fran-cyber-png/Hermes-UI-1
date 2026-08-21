interface TimeColumnProps {
  ahora?: Date;
}

const HORAS = Array.from({ length: 24 }, (_, i) => i);

export function TimeColumn({ ahora }: TimeColumnProps) {
  const ahoraHora = ahora ? ahora.getHours() : -1;

  return (
    <div className="shrink-0 w-16 border-r border-border bg-card">
      {/* Header space */}
      <div className="h-12 border-b border-border" />

      {/* Hours */}
      <div className="flex flex-col">
        {HORAS.map((hora) => {
          const isCurrentHour = hora === ahoraHora;
          const timeStr = `${String(hora).padStart(2, '0')}:00`;

          return (
            <div
              key={hora}
              className="h-[60px] border-b border-border/20 flex items-start justify-end pr-2 pt-1"
            >
              <span
                className={
                  'font-mono text-[11px] transition-colors ' +
                  (isCurrentHour
                    ? 'text-foreground font-semibold opacity-100'
                    : 'text-muted-foreground opacity-60')
                }
              >
                {timeStr}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
