/**
 * LA LÓGICA PURA DE LA COLA POTENCIADA (#49) — sin React, testeable con vitest.
 *
 * Los tabs (`Todo · No leídos · Favoritos`) son el EJE de la cola; «Piden info»
 * y «Por vencer» son filtros SECUNDARIOS que angostan dentro del tab, y la
 * categoría es el tercer eje (modo Listas). Acá vive el mapeo tab/filtro →
 * query-params y la migración del valor viejo de localStorage.
 */

export type Tab = 'todo' | 'no-leidos' | 'favoritos';

/** Los filtros secundarios: reencarnan a los viejos por intención (#49, §Nada se tira). */
export type FiltroSec = '' | 'pide-info' | 'por-vencer';

export const TABS: { valor: Tab; label: string; vacio: string }[] = [
  { valor: 'todo', label: 'Todo', vacio: 'No entró nada por ningún canal.' },
  { valor: 'no-leidos', label: 'No leídos', vacio: 'Nada sin leer.' },
  { valor: 'favoritos', label: 'Favoritos', vacio: 'No marcaste favoritos.' },
];

export const FILTROS_SEC: { valor: Exclude<FiltroSec, ''>; label: string }[] = [
  { valor: 'pide-info', label: 'Piden info' },
  { valor: 'por-vencer', label: 'Por vencer' },
];

const TABS_VALIDOS: readonly string[] = TABS.map((t) => t.valor);

export function esTab(x: unknown): x is Tab {
  return typeof x === 'string' && TABS_VALIDOS.includes(x);
}

/**
 * Sanea el valor persistido del tab a uno VÁLIDO. El default de la cola dejó de
 * ser `puedo-escribirle` y pasó a `Todo` (#49): cualquier valor viejo o basura
 * cae en `todo`, así el caché persistido no abre mostrando la página de un
 * filtro que ya no existe como tab.
 */
export function migrarFiltroViejo(raw: string | null | undefined): Tab {
  return esTab(raw) ? raw : 'todo';
}

/** La key vieja de la cola (el filtro por intención, pre-#49). */
export const KEY_FILTRO_VIEJO = 'hermes.colaFiltro';
/** La key nueva: el tab es otro eje, no el mismo valor con otro nombre. */
export const KEY_TAB = 'hermes.colaTab';

/**
 * Qué debería ver, la primera vez, alguien que YA venía usando la cola vieja.
 *
 * La key cambió, así que sin esto la migración no migra nada: quien tenía
 * «Piden info» elegido abre en Todo y su filtro desaparece sin explicación. Se
 * traduce UNA vez, al arrancar, y el valor viejo se borra para no volver a
 * pisar lo que la vendedora elija después.
 *
 *   · `pide-info`        → tab Todo + el filtro secundario «Piden info» (existe).
 *   · `puedo-escribirle` → tab Todo + «Por vencer», su reencarnación (#49).
 *   · cualquier otra cosa → Todo, sin filtro.
 *
 * Devuelve `null` si no hay nada que migrar (usuaria nueva, o ya migrada).
 */
export function migracionDesdeKeyVieja(
  leer: (k: string) => string | null,
  borrar: (k: string) => void,
): { tab: Tab; filtroSec: FiltroSec } | null {
  const crudo = leer(KEY_FILTRO_VIEJO);
  if (crudo == null) return null;
  borrar(KEY_FILTRO_VIEJO);

  // Se guardó con JSON.stringify (useLocalStorage), así que viene entrecomillado.
  let valor = crudo;
  try {
    const parseado: unknown = JSON.parse(crudo);
    if (typeof parseado === 'string') valor = parseado;
  } catch {
    // Valor sin JSON válido: se usa tal cual y, si no matchea, cae en el default.
  }

  if (valor === 'pide-info') return { tab: 'todo', filtroSec: 'pide-info' };
  if (valor === 'puedo-escribirle') return { tab: 'todo', filtroSec: 'por-vencer' };
  return { tab: 'todo', filtroSec: '' };
}

export interface EstadoCola {
  tab: Tab;
  filtroSec: FiltroSec;
  /** El nombre (minúsculas) de la categoría en el modo Listas; null = sin filtro. */
  categoria: string | null;
  canal?: string;
}

/**
 * Traduce el estado de la cola a los query-params de `/api/conversaciones`. Solo
 * emite lo que se aparta del default (tab `todo` no viaja): así la queryKey de
 * react-query es estable y el default no ensucia la URL.
 */
export function parametrosDeCola(e: EstadoCola): Record<string, string> {
  const p: Record<string, string> = {};
  if (e.tab !== 'todo') p.tab = e.tab;
  if (e.filtroSec) p.intencion = e.filtroSec;
  if (e.categoria) p.categoria = e.categoria;
  if (e.canal) p.canal = e.canal;
  return p;
}
