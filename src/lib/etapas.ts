/**
 * Las etapas del embudo, canónicas para TODA la app (Dashboard, cola, kanban,
 * recibo de venta). La identidad visual de una etapa es fija: ningún filtro ni
 * vista la re-pinta.
 */

export const ETAPAS = ['interesado', 'contactado', 'cotizado', 'cierre', 'perdido'] as const;
export type Etapa = (typeof ETAPAS)[number];

/** Chip de etapa (fondo + tinta). */
export const ETAPA_CHIP: Record<string, string> = {
  interesado: 'bg-primary/10 text-primary',
  contactado: 'bg-secondary text-secondary-foreground',
  cotizado: 'bg-navy text-white',
  cierre: 'bg-success/10 text-success',
  perdido: 'bg-destructive/10 text-destructive',
};

/** Color de segmento para la barra del embudo (índice = posición en ETAPAS). */
export function colorSegmento(etapa: string, i: number): string {
  if (etapa === 'cierre') return 'bg-success';
  if (etapa === 'perdido') return 'bg-muted-foreground/30';
  return ['bg-navy/40', 'bg-navy/60', 'bg-navy'][i] ?? 'bg-navy';
}
