import type { Etapa } from '../../lib/etapas';

/**
 * EL TABLERO HONESTO (#90) — la lógica pura del Pipeline, sin DOM.
 *
 * Interesados dejó de ser columna: es la bandeja de arriba (un contador real y
 * el acceso a Mensajes, donde ese trabajo de verdad se hace). Las columnas de
 * trabajo cargan POR etapa efectiva (`?etapa=`, #89) y acá se decide dónde cae
 * cada tarjeta cuando hay movimientos optimistas en el medio. VistaEmbudo solo
 * ejecuta; la política se fija con tests sin DOM (mismo patrón que
 * `compuertas.ts`).
 */

/** Las columnas del tablero, en el orden del embudo. Interesado NO está: es bandeja. */
export const COLUMNAS_TRABAJO = [
  { id: 'contactado', titulo: 'Contactados', pista: 'Ya les respondimos. Se llena solo.' },
  { id: 'cotizado', titulo: 'Cotizados', pista: 'Compuerta: exige curso de interés.' },
  { id: 'cierre', titulo: 'Cierre', pista: 'Se llega registrando la venta.' },
  { id: 'perdido', titulo: 'Perdidos', pista: 'Lo dijo la vendedora. No vuelve solo.' },
] as const;

export type EtapaTrabajo = (typeof COLUMNAS_TRABAJO)[number]['id'];

const ETAPAS_TRABAJO: readonly string[] = COLUMNAS_TRABAJO.map((c) => c.id);

/** Lo mínimo que el tablero necesita saber de una tarjeta. */
export interface TarjetaTablero {
  clave: string;
  /** La etapa dicha por el server (ADR 0013). Sin ella no se inventa nada. */
  etapa_efectiva?: string | null;
}

/**
 * La etapa ACTUAL de una tarjeta para las compuertas: el movimiento optimista
 * en vuelo (si hay) le gana a la del server. Sin dato del server, `null` —
 * jamás el fallback `'interesado'` que hacía mentir al tablero viejo.
 */
export function etapaDeTarjeta(
  c: TarjetaTablero,
  overrides: Record<string, Etapa>,
): Etapa | null {
  return overrides[c.clave] ?? ((c.etapa_efectiva as Etapa | undefined) || null);
}

/**
 * Reparte lo cargado por columna en lo que se PINTA por columna:
 *
 *   · manda la etapa efectiva de la propia tarjeta (si el refetch del origen
 *     viene atrasado, la tarjeta no se duplica: cada clave se pinta una vez);
 *   · un movimiento optimista la muda ya — entra ARRIBA del destino (es lo que
 *     la vendedora acaba de tocar) y sale del origen;
 *   · una etapa fuera del tablero (interesado) no se pinta en ninguna columna.
 */
export function repartirColumnas<C extends TarjetaTablero>(
  cargadas: ReadonlyArray<readonly [EtapaTrabajo, readonly C[]]>,
  overrides: Record<string, Etapa>,
): Map<EtapaTrabajo, C[]> {
  const mapa = new Map<EtapaTrabajo, C[]>(COLUMNAS_TRABAJO.map((c) => [c.id, []]));
  const movidas = new Map<EtapaTrabajo, C[]>(COLUMNAS_TRABAJO.map((c) => [c.id, []]));
  const vistas = new Set<string>();

  for (const [columna, items] of cargadas) {
    for (const c of items) {
      if (vistas.has(c.clave)) continue;
      vistas.add(c.clave);
      const propia = ETAPAS_TRABAJO.includes(c.etapa_efectiva ?? '')
        ? (c.etapa_efectiva as EtapaTrabajo)
        : c.etapa_efectiva == null
          ? columna // server viejo sin la columna: se respeta la etapa pedida
          : null; // interesado u otra: fuera del tablero
      const destino = overrides[c.clave] ?? propia;
      if (destino == null || !ETAPAS_TRABAJO.includes(destino)) continue;
      (destino === propia ? mapa : movidas).get(destino as EtapaTrabajo)!.push(c);
    }
  }

  for (const [columna, items] of movidas) {
    if (items.length) mapa.get(columna)!.unshift(...items);
  }
  return mapa;
}

/** El «Ver más» honesto: cuántas faltan de ESTA columna. Nunca negativo, nunca inventado. */
export function quedanPorTraer(total: number | undefined, cargadas: number): number {
  if (total == null) return 0;
  return Math.max(total - cargadas, 0);
}
