import { EventEmitter } from 'node:events';

/**
 * EL BUS DE TIEMPO REAL.
 *
 * El server ya recibe los mensajes en vivo (whatsmeow los empuja apenas llegan).
 * El problema es que el frontend no se enteraba: las queries de la cola tenían
 * `staleTime` y no refrescaban solas, así que un mensaje nuevo quedaba en la base
 * sin aparecer en pantalla hasta que la vendedora cambiaba de filtro.
 *
 * Este bus cierra ese hueco: cuando algo cambia (un mensaje nuevo, un cambio de
 * estado de sesión), se emite un evento acá; el endpoint SSE lo reenvía a cada
 * Hermes abierto, y el frontend invalida exactamente las queries afectadas. Es
 * push, no polling: el delay es de milisegundos, no de segundos.
 */
export type EventoRT =
  // `direccion` es OPCIONAL a propósito: reacciones y recibos reusan este mismo
  // tipo para pedir un refresco de la cola sin ser un mensaje nuevo, y omitirla
  // ahí (en vez de inventar una) es lo que evita que la campanita de un mensaje
  // entrante suene por un 👍 o un ✓✓ (ver `notificaciones/decidir.ts` del front).
  | { tipo: 'mensaje'; canal: string; telefono: string | null; direccion?: 'entrante' | 'saliente' }
  | { tipo: 'estado' };

const emisor = new EventEmitter();
emisor.setMaxListeners(200); // muchas pestañas/vendedoras a la vez, sin warnings

export function emitirRT(e: EventoRT): void {
  emisor.emit('rt', e);
}

export function suscribirRT(cb: (e: EventoRT) => void): () => void {
  emisor.on('rt', cb);
  return () => emisor.off('rt', cb);
}
