interface CurrentTimeIndicatorProps {
  horaActual: number;
  minutoActual: number;
}

export function CurrentTimeIndicator({
  horaActual,
  minutoActual,
}: CurrentTimeIndicatorProps) {
  // Posición dentro de la hora actual en píxeles (60px por hora)
  const posicionEnPixeles = (minutoActual / 60) * 60;

  return (
    <div
      className="absolute left-0 right-0 z-10 flex items-center gap-1 pointer-events-none"
      style={{
        top: `calc(3rem + ${horaActual * 60 + posicionEnPixeles}px)`,
      }}
    >
      {/* Circle indicator */}
      <div className="shrink-0 w-16 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-gold shadow-sm" />
      </div>

      {/* Line */}
      <div className="h-[2px] min-w-0 flex-1 bg-gold shadow-sm" />
    </div>
  );
}
