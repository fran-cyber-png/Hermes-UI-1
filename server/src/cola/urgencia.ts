/**
 * QUÉ ES "URGENTE" EN LA COLA DE LA VENDEDORA.
 *
 * La regla vieja ordenaba todo por la ventana de 7 días de Meta. Con WhatsApp en
 * la misma cola eso enterraba lo que más vende: un chat donde alguien está
 * escribiendo AHORA "quiero comprar, pasame el link" quedaba debajo de miles de
 * comentarios "👏" con la ventana abierta.
 *
 * Goberna vende por WhatsApp: una conversación viva es lo más urgente que hay.
 * Por eso la urgencia tiene cuatro niveles, y el vivo va arriba de todo:
 *
 *   Nivel 0 — VIVO: mensaje sin responder con un entrante RECIENTE (< 24 h).
 *             Alguien está hablando ahora y esperando. El que espera hace más,
 *             primero.
 *   Nivel 1 — EXPIRA: comentario de Meta con la ventana abierta y sin responder.
 *             El más viejo primero (le quedan menos horas antes de cerrarse).
 *   Nivel 2 — ESPERA: mensaje sin responder pero ya viejo (> 24 h). Sigue siendo
 *             trabajo pendiente; el más viejo primero.
 *   Nivel 3 — EL RESTO: lo respondido y las ventanas cerradas. Reciente primero;
 *             nada de esto corre peligro.
 */

export interface ItemUrgencia {
  tipo: 'comentario' | 'mensaje';
  /** Solo significa algo en comentarios: la ventana de 7 días de Meta sigue abierta. */
  ventanaAbierta: boolean;
  /** ¿Existe un saliente posterior al último entrante? Derivada, nunca estado de fila. */
  respondida: boolean;
  /**
   * El momento que manda para ordenar:
   * - comentario → cuándo comentó (cuánto le queda de ventana);
   * - mensaje → el último entrante sin responder (cuánto hace que espera).
   */
  referencia: Date;
}

/** Una conversación se considera VIVA si el entrante sin responder llegó hace menos de esto. */
export const ACTIVO_MS = 24 * 60 * 60 * 1000;

/** Nivel de urgencia; menor = más arriba en la cola. */
export type Clave = { nivel: 0 | 1 | 2 | 3; orden: number };

export function claveUrgencia(item: ItemUrgencia, ahora: Date): Clave {
  const t = item.referencia.getTime();
  const edad = ahora.getTime() - t;

  // Nivel 0 — VIVO: mensaje sin responder, con un entrante reciente. El que hace
  // más que espera, primero → orden ascendente.
  if (item.tipo === 'mensaje' && !item.respondida && edad < ACTIVO_MS) {
    return { nivel: 0, orden: t };
  }

  // Nivel 1 — EXPIRA: comentario Meta con ventana abierta, sin responder. El más
  // viejo primero (menos horas de ventana) → ascendente.
  if (item.tipo === 'comentario' && item.ventanaAbierta && !item.respondida) {
    return { nivel: 1, orden: t };
  }

  // Nivel 2 — ESPERA: mensaje sin responder pero ya viejo. Todavía es trabajo.
  if (item.tipo === 'mensaje' && !item.respondida) {
    return { nivel: 2, orden: t };
  }

  // Nivel 3 — EL RESTO: respondido o ventana cerrada. Reciente arriba (negamos).
  return { nivel: 3, orden: -t };
}

/** Compara dos claves: primero el nivel, después el orden interno. Menor = más arriba. */
export function compararUrgencia(a: Clave, b: Clave): number {
  if (a.nivel !== b.nivel) return a.nivel - b.nivel;
  return a.orden - b.orden;
}

/** Ordena una lista por urgencia. No muta el arreglo original. */
export function ordenarPorUrgencia<T extends ItemUrgencia>(items: T[], ahora: Date): T[] {
  return [...items].sort((x, y) => compararUrgencia(claveUrgencia(x, ahora), claveUrgencia(y, ahora)));
}
