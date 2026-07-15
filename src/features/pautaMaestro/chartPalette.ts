/**
 * Paleta única para todos los charts de Pauta Comparar. Antes cada archivo
 * (CompararChart, EfficiencyScatter, BubbleCampanas, RadarCampanas, DonutGasto,
 * CompararBarras, BarrasHorizontales, CompararTabla, PautaDetallePage) copiaba
 * el mismo array de hex a mano, y EfficiencyScatter además reusaba el verde/rojo
 * de estado para una serie continua (CTR) — dos problemas que esta paleta
 * resuelve: una sola fuente, y los tonos de estado quedan reservados.
 *
 * Los tonos de estado y el chrome de ejes viven como `var(--token)`: como los
 * charts son SVG, el navegador resuelve la variable igual que en cualquier
 * otro elemento, así que quedan sincronizados con `index.css` sin duplicar hex.
 */

/**
 * Identidad categórica (campaña o anuncio), orden fijo — nunca se cicla ni se
 * regenera por filtro. Excluye a propósito los tonos de éxito/alerta/destructivo
 * (reservados a estado) para que un veredicto nunca se confunda con "serie N".
 *
 * Validado con el script de la skill `dataviz` (`validate_palette.js`, modo
 * light, superficie #FFFFFF, `--pairs all` — la app la usa también en
 * scatter/bubble, donde dos series cualquiera pueden terminar adyacentes):
 * pasa piso de luminosidad, piso de croma, separación CVD y contraste. El
 * violeta (#7C3AED) se descartó: quedaba a ΔE 12.4 del azul primario para
 * visión normal (piso mínimo 15) — casi indistinguible.
 */
export const CATEGORICAL = [
  'var(--primary)', // #2563EB — azul
  '#0891B2', // teal
  '#DB2777', // magenta
  '#65A30D', // oliva
  '#9A3412', // marrón
] as const;

/**
 * Asigna color por posición ESTABLE en la lista de ids ordenada, no por índice
 * de filtro/hover — así una campaña no cambia de color cuando se reordena o se
 * agrega/saca otra de la selección.
 */
export function colorForId(id: string, allIds: string[]): string {
  const orden = [...allIds].sort();
  const idx = orden.indexOf(id);
  return CATEGORICAL[(idx < 0 ? 0 : idx) % CATEGORICAL.length];
}

/** Reservado a veredicto/alertas — nunca "serie N". Siempre con ícono o label, nunca solo color. */
export const STATUS = {
  good: 'var(--success)',
  neutral: 'var(--primary)',
  warning: 'var(--warning)',
  critical: 'var(--destructive)',
} as const;

/** Chrome de ejes/grid de Recharts, tokenizado en vez de hex sueltos. */
export const CHROME = {
  grid: 'var(--border)',
  axis: 'var(--muted-foreground)',
} as const;
