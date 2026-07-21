/**
 * QUÉ ES "URGENTE" EN LA COLA DE LA VENDEDORA.
 *
 * La regla vieja (heredada de la bandeja de comentarios) ordenaba todo por una
 * sola cosa: la ventana de 7 días de Meta. Con WhatsApp en la misma cola eso se
 * rompe, porque mezcla dos relojes que NO son lo mismo:
 *
 *   · La ventana de Meta es un deadline DURO: pasados 7 días no se puede mandar
 *     el privado NUNCA MÁS. Lo que no se contesta se pierde para siempre.
 *   · La espera de WhatsApp es una cortesía BLANDA: contestar hoy o mañana es
 *     peor atención, pero no cierra ninguna puerta.
 *
 * Meterlos en un solo número entierra lo que se pierde para siempre debajo de lo
 * que se puede contestar mañana. Por eso la urgencia tiene DOS NIVELES:
 *
 *   Nivel 0 — LO QUE EXPIRA: comentarios de Meta con la ventana abierta y sin
 *             responder. Adentro, el MÁS VIEJO primero (le quedan menos horas).
 *   Nivel 1 — LO QUE ESPERA: mensajes (WhatsApp/Messenger) sin responder.
 *             Adentro, el más viejo sin responder primero.
 *   Nivel 2 — EL RESTO: lo ya respondido y las ventanas cerradas. Lo reciente
 *             primero; nada de esto corre peligro.
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

/** Nivel de urgencia; menor = más arriba en la cola. */
export type Clave = { nivel: 0 | 1 | 2; orden: number };

export function claveUrgencia(item: ItemUrgencia): Clave {
  const t = item.referencia.getTime();

  // Nivel 0 — lo que expira: comentario Meta con ventana abierta, sin responder.
  // Ordena por el más viejo primero (menos horas de ventana) → orden ascendente.
  if (item.tipo === 'comentario' && item.ventanaAbierta && !item.respondida) {
    return { nivel: 0, orden: t };
  }

  // Nivel 1 — lo que espera: cualquier mensaje sin responder. El que hace más que
  // espera primero → orden ascendente por antigüedad del entrante.
  if (item.tipo === 'mensaje' && !item.respondida) {
    return { nivel: 1, orden: t };
  }

  // Nivel 2 — el resto: respondido, o ventana ya cerrada. Nada corre peligro, así
  // que lo reciente arriba → orden descendente (negamos el tiempo).
  return { nivel: 2, orden: -t };
}

/** Compara dos claves: primero el nivel, después el orden interno. Menor = más arriba. */
export function compararUrgencia(a: Clave, b: Clave): number {
  if (a.nivel !== b.nivel) return a.nivel - b.nivel;
  return a.orden - b.orden;
}

/** Ordena una lista de items por urgencia. No muta el arreglo original. */
export function ordenarPorUrgencia<T extends ItemUrgencia>(items: T[]): T[] {
  return [...items].sort((x, y) => compararUrgencia(claveUrgencia(x), claveUrgencia(y)));
}
