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
 *
 * ══ 🔴 DOS TIPOS, Y ESA ES LA FRONTERA ═══════════════════════════════════════
 *
 * El bus era un **broadcast**: `suscribirRT(cb)` no recibía ningún discriminante
 * y el handler SSE reenviaba el evento crudo, así que cada vendedora recibía un
 * frame por CADA mensaje de todo Hermes — el teléfono del lead ajeno y el
 * instante exacto, en vivo y sin quedar en ningún log. Peor que la fuga en sí:
 * era el **enumerador** que le sacaba la precondición a las demás («conocer un
 * teléfono ajeno»), así que cortarlo rompe solo la cadena entera
 * (auditoría del 17-ago-2026 §0.4, hallazgos C5/C12/C13/C44).
 *
 * Por eso hay DOS tipos y no uno con un campo opcional:
 *
 *   · `EventoRT`      — lo que se PUBLICA acá adentro. Lleva `duena`.
 *   · `EventoPublico` — lo que SALE por el cable, a una vendedora concreta.
 *                       **No tiene dónde poner `duena`**, así que el nombre de
 *                       la dueña no se puede filtrar ni por descuido: sería un
 *                       metadato ajeno («a Luz le escribieron recién») servido a
 *                       quien no trabaja esa conversación.
 *
 * La traducción de uno a otro vive en `realtime/visibilidad.ts`, es pura, y es
 * el único lugar donde se decide qué ve cada quien.
 */

/**
 * DE QUIÉN ES LA CONVERSACIÓN DE ESTE EVENTO.
 *
 * 🔴 **Es REQUERIDO a propósito, aunque casi siempre valga `null`.** Con un
 * campo opcional, un emisor nuevo que se olvide de resolverlo compila igual y
 * su evento sale sin dueña — que bajo la regla de `visibilidad.ts` es
 * fail-closed y por eso no fuga, pero deja una campanita muerta sin un solo
 * síntoma. Requerido, el compilador **obliga a decidir**.
 *
 * `null` significa **una sola cosa para quien lee**: «no se pudo atribuir». Ahí
 * caen los tres casos —no hay fila en `conversacion_asignada`, la migración del
 * reparto no está, o la consulta falló— y los tres fallan hacia el mismo lado.
 * No se distinguen porque no se accionan distinto: en los tres el evento sale
 * recortado.
 */
export type DuenaDelEvento = string | null;

/** Lo que se publica en el bus, adentro del proceso. */
export type EventoRT =
  // `direccion` es OPCIONAL a propósito: reacciones y recibos reusan este mismo
  // tipo para pedir un refresco de la cola sin ser un mensaje nuevo, y omitirla
  // ahí (en vez de inventar una) es lo que evita que la campanita de un mensaje
  // entrante suene por un 👍 o un ✓✓ (ver `notificaciones/decidir.ts` del front).
  | {
      tipo: 'mensaje';
      canal: string;
      telefono: string | null;
      direccion?: 'entrante' | 'saliente';
      duena: DuenaDelEvento;
    }
  | { tipo: 'estado' };

/**
 * Lo que sale por el SSE hacia UNA vendedora.
 *
 * ⚠️ `telefono` y `direccion` son opcionales porque el evento **recortado** no
 * los lleva: sin `telefono` no se puede nombrar al lead ajeno, y sin `direccion`
 * la campanita no suena (`esMensajeEntrante` trata la ausencia como «no sonar»).
 * Lo que sí sobrevive siempre es `tipo` + `canal`, que es todo lo que hace falta
 * para invalidar la cola — o sea que **a nadie se le congela la pantalla**: lo
 * único que se pierde es saber de QUIÉN fue el movimiento.
 */
export type EventoPublico =
  | { tipo: 'mensaje'; canal: string; telefono?: string; direccion?: 'entrante' | 'saliente' }
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
