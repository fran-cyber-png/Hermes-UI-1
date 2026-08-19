/**
 * CHISPA — sparkline de 2px sin ejes: el pulso de una serie, no su análisis.
 * Hereda el color de la tinta (currentColor): el consumidor la tiñe con
 * text-navy-ink (u otra tinta de marca — nunca oro: el oro es tiempo, no historia).
 */
export function Chispa({
  valores,
  etiqueta,
  ancho = 96,
  alto = 28,
  className = '',
}: {
  valores: number[];
  /** Resumen accesible: 'Mensajes por día, últimos 14 días: hoy 12'. */
  etiqueta: string;
  ancho?: number;
  alto?: number;
  className?: string;
}) {
  if (valores.length < 2) return null;
  const max = Math.max(1, ...valores);
  const pad = 3;
  const x = (i: number) => pad + (i / (valores.length - 1)) * (ancho - pad * 2);
  const y = (v: number) => alto - pad - (v / max) * (alto - pad * 2);
  const puntos = valores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg role="img" aria-label={etiqueta} width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} className={className}>
      <title>{etiqueta}</title>
      <polyline points={puntos} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(valores.length - 1)} cy={y(valores[valores.length - 1])} r={2.5} fill="currentColor" />
    </svg>
  );
}
