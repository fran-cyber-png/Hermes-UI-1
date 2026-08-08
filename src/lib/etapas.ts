/**
 * Las etapas del embudo, canónicas para TODA la app (Dashboard, cola, kanban,
 * recibo de venta). La identidad visual de una etapa es fija: ningún filtro ni
 * vista la re-pinta.
 */

export const ETAPAS = ['interesado', 'contactado', 'cotizado', 'cierre', 'perdido'] as const;

/**
 * ══ «SIN RESPUESTA» — DERIVADA, NUNCA DECLARABLE ═══════════════════════════
 *
 * Le escribimos y la persona nunca contestó (server: `cola/etapaEfectivaSql.ts`).
 * Medido el 8-ago-2026: **2.580 de 3.973 conversaciones (65 %)**, que hasta hoy
 * caían en Contactados y Cotizados e inflaban las dos — 2.252 de los 3.050
 * Cotizados nunca habían dicho una palabra.
 *
 * 🔴 **Queda AFUERA de `ETAPAS` a propósito**, y no es un olvido: esa lista es la
 * que iteran el embudo del Dashboard y el recibo de venta, y ahí este valor sería
 * un segmento clavado en cero (el Dashboard solo cuenta conversaciones con un
 * primer entrante, así que por construcción nunca lo devuelve). Está en el TIPO
 * —porque el tablero sí lo recibe y lo pinta— y no en la lista que se enumera.
 * Tampoco se puede declarar: no hay botón ni arrastre que lleve acá, se deriva de
 * un hecho y deja de ser cierto solo, en cuanto la persona escribe.
 */
export const SIN_RESPUESTA = 'sin_respuesta';

export type Etapa = (typeof ETAPAS)[number] | typeof SIN_RESPUESTA;

/** Chip de etapa (fondo + tinta). */
export const ETAPA_CHIP: Record<string, string> = {
  // Tinta apagada y sin borde: es un estado de espera, no un peldaño ganado.
  // Sin oro — acá no hay ningún plazo corriendo, hay silencio.
  sin_respuesta: 'bg-muted text-muted-foreground',
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
