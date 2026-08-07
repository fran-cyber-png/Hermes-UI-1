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

/**
 * Las columnas del tablero, en el orden del embudo. Interesado NO está: es
 * bandeja. Cada una lleva su `pista` (qué significa estar acá) y su `vacio` (qué
 * hacer para que deje de estar vacía) — una columna en cero que no explica cómo
 * se llena es la mitad del problema de esta pantalla.
 */
export const COLUMNAS_TRABAJO = [
  {
    id: 'contactado',
    titulo: 'Contactados',
    pista: 'Les hablaste y no volvieron. Se llena solo.',
    vacio: 'Cuando le respondas a alguien, aparece acá.',
  },
  {
    id: 'cotizado',
    titulo: 'Cotizados',
    pista: 'Saben el precio y el curso.',
    vacio: 'Marcá «Cotizado» en una tarjeta con precio enviado, o arrastrala acá.',
  },
  {
    id: 'cierre',
    titulo: 'Cierre',
    pista: 'No se declara: se gana con la venta.',
    vacio: 'Registrá la venta desde la ficha y la tarjeta llega sola.',
  },
  {
    id: 'perdido',
    titulo: 'Perdidos',
    pista: 'Lo dijiste vos. No vuelve solo.',
    vacio: 'Nada descartado.',
  },
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

/**
 * Una celda del desglose que sirve el server: etapa × ya-le-hablamos × precio ×
 * viva, con su conteo. Es la MISMA foto que las tarjetas, contada de una pasada
 * (`server/src/cola/consultarCola.ts`).
 */
export interface FilaDesglose {
  etapa: string;
  yaLeHablamos: boolean;
  precio: boolean;
  viva: boolean;
  /**
   * La ventana de conversación sigue abierta (server: `cola/ventana.ts`): se le
   * puede escribir texto libre AHORA, sin pagar una plantilla. Opcional porque
   * un server viejo no manda el campo — y ahí el chip no se dibuja, que es como
   * se comportaba antes.
   */
  ventana?: boolean;
  n: number;
}

/**
 * LA BANDEJA, DICHA COMO ES. Hasta acá era un número gris con un rótulo que
 * mentía: «Levantaron la mano y nadie les respondió aún» — falso para la mitad.
 * Medido en producción el 2026-07-25, la bandeja son **476 conversaciones donde
 * la pelota es nuestra**, y son dos trabajos distintos:
 *
 *   · `nuevas` — nadie les contestó nunca. Se abren.
 *   · `retomadas` — ya les hablamos y volvieron a escribir. Se siguen.
 *
 * `vivas` es el número que decide el día: cuántas están escribiendo AHORA
 * (nivel 0, menos de 24 h). La mediana de primera respuesta es de 39 minutos;
 * ese número tiene que estar a la vista, no enterrado en una pila.
 */
export function resumirBandeja(
  desglose: readonly FilaDesglose[] | undefined,
  /**
   * Los conteos por etapa de siempre (#89). El front sale a producción SIN
   * reinicio del server (N4) y el server recién en el botón (N5): entre uno y
   * otro no hay desglose. Ahí la bandeja cuenta con lo que hay y CALLA el
   * detalle, en vez de mostrar un cero que no es cierto.
   */
  conteos?: Record<string, number>,
): { total: number; nuevas: number; retomadas: number; vivas: number; hayDetalle: boolean } {
  const r = { total: 0, nuevas: 0, retomadas: 0, vivas: 0, hayDetalle: false };
  if (!desglose) return { ...r, total: conteos?.interesado ?? 0 };
  r.hayDetalle = true;
  for (const fila of desglose) {
    if (fila.etapa !== 'interesado') continue;
    r.total += fila.n;
    if (fila.yaLeHablamos) r.retomadas += fila.n;
    else r.nuevas += fila.n;
    if (fila.viva) r.vivas += fila.n;
  }
  return r;
}

/**
 * El tamaño real de una columna y el de su recorte útil: cuántas de esas
 * conversaciones ya tienen un precio encima. Con 611 precios enviados y la
 * columna Cotizados en cero, ese subconjunto ES el trabajo del día.
 */
export function resumirColumna(
  desglose: readonly FilaDesglose[] | undefined,
  etapa: string,
  /** El conteo de siempre, para el rato en que el front va adelante del server. */
  conteos?: Record<string, number>,
): { total: number; conPrecio: number; enVentana: number } {
  if (!desglose) return { total: conteos?.[etapa] ?? 0, conPrecio: 0, enVentana: 0 };
  const r = { total: 0, conPrecio: 0, enVentana: 0 };
  for (const fila of desglose) {
    if (fila.etapa !== etapa) continue;
    r.total += fila.n;
    if (fila.precio) r.conPrecio += fila.n;
    // `ventana` ausente (server viejo) NO suma: el chip se esconde en cero, que
    // es preferible a ofrecer un recorte que el server no sabe aplicar.
    if (fila.ventana) r.enVentana += fila.n;
  }
  return r;
}
