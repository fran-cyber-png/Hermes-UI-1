/**
 * La eficiencia relativa: qué tan caro es este resultado comparado con el
 * promedio de su campaña.
 *
 * Es la pieza que hace visible la fuga de plata. En la campaña OSINT real, el
 * conjunto de mayo traía resultados a $0.62 y el de abril a $1.24 — el doble.
 * Pero abril se llevó 7 veces más presupuesto. Nadie lo vio porque había que
 * cruzar dos tablas a mano.
 */
export type Eficiencia = 'mejor' | 'bien' | 'caro' | 'muy-caro' | 'sin-datos';

export function eficienciaDe(costPerResult: number | null, promedio: number | null): Eficiencia {
  if (costPerResult === null || promedio === null || promedio === 0) return 'sin-datos';
  const ratio = costPerResult / promedio;
  if (ratio <= 0.75) return 'mejor';
  if (ratio <= 1.05) return 'bien';
  if (ratio <= 1.5) return 'caro';
  return 'muy-caro';
}

export const EFICIENCIA_META: Record<Eficiencia, { label: string; text: string; bg: string; bar: string }> = {
  mejor: { label: 'El más barato', text: 'text-temp-fresco', bg: 'bg-temp-fresco/10', bar: 'bg-temp-fresco' },
  bien: { label: 'En el promedio', text: 'text-muted-foreground', bg: '', bar: 'bg-primary' },
  caro: { label: 'Caro', text: 'text-temp-frio', bg: 'bg-temp-frio/5', bar: 'bg-temp-frio' },
  'muy-caro': { label: 'Muy caro', text: 'text-destructive', bg: 'bg-destructive/5', bar: 'bg-destructive' },
  'sin-datos': { label: 'Sin datos', text: 'text-muted-foreground', bg: '', bar: 'bg-muted-foreground/30' },
};

export const money = (n: number | null, dec = 2) =>
  n === null ? '—' : n.toLocaleString('es', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/**
 * Cuánto se habría ganado moviendo el presupuesto de lo caro a lo barato.
 * No es una proyección fina — es el orden de magnitud de la plata que se está
 * dejando en la mesa, que es lo que hace falta para tomar la decisión.
 */
export function resultadosPerdidos(
  items: { spend: number; costPerResult: number | null }[],
): { extra: number; mejorCpr: number } | null {
  const conDatos = items.filter((i) => i.costPerResult !== null && i.costPerResult > 0 && i.spend > 0);
  if (conDatos.length < 2) return null;

  const mejorCpr = Math.min(...conDatos.map((i) => i.costPerResult!));
  const gastoTotal = conDatos.reduce((s, i) => s + i.spend, 0);
  const resultadosActuales = conDatos.reduce((s, i) => s + i.spend / i.costPerResult!, 0);
  const resultadosSiTodoFueraElMejor = gastoTotal / mejorCpr;

  const extra = Math.round(resultadosSiTodoFueraElMejor - resultadosActuales);
  return extra > 0 ? { extra, mejorCpr } : null;
}
