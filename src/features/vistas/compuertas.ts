import type { Etapa } from '../../lib/etapas';

/**
 * LAS COMPUERTAS DEL PIPELINE, DEL LADO DE LA UI (#60).
 *
 * La compuerta REAL vive en el server (`gestiones.ts`: a Cotizado no se pasa
 * sin interés, a Cierre solo se llega registrando la venta) y NO se relaja.
 * Antes, chocarla era un rebote: la tarjeta volvía sola con un aviso de texto.
 * Ahora la UI la acompaña — soltar en una etapa que necesita un dato abre un
 * modal para registrarlo ahí mismo, y al completarlo el movimiento se concreta.
 *
 * Módulo puro a propósito: la política de «qué modal abre cada destino» y «qué
 * se reintenta tras completar» se fija con tests sin DOM (`compuertas.test.ts`);
 * `VistaEmbudo` solo la ejecuta.
 */

/** Qué hace el Pipeline cuando la vendedora suelta una tarjeta en una columna. */
export type AccionDrop =
  | { accion: 'nada' }
  | { accion: 'mover'; etapa: Etapa }
  /** Cierre + WhatsApp: el modal de Registrar venta, con la conversación precargada. */
  | { accion: 'modal-venta' }
  /** Cierre + comentario FB/IG: sin teléfono no hay ficha ni venta — se abre la conversación. */
  | { accion: 'abrir' };

export function decidirDrop(v: { actual: Etapa; destino: Etapa; canal: string }): AccionDrop {
  if (v.actual === v.destino) return { accion: 'nada' };
  if (v.destino === 'cierre') {
    return v.canal === 'whatsapp' ? { accion: 'modal-venta' } : { accion: 'abrir' };
  }
  // Cotizados también «intenta»: la compuerta la valida el server, no la UI.
  // Si rebota, `decidirRebote` convierte ese rechazo en el modal del interés.
  return { accion: 'mover', etapa: v.destino };
}

/** Qué hace el Pipeline cuando el server rechazó el movimiento. */
export type AccionRebote =
  /** La compuerta de Cotizado habló: falta el interés — el modal lo pide ahí mismo. */
  | { accion: 'modal-interes' }
  /** Cualquier otro rechazo (red, validación): el aviso de texto de siempre. */
  | { accion: 'aviso'; mensaje: string };

export function decidirRebote(v: {
  destino: Etapa;
  /** El status HTTP del rechazo — `null` cuando ni siquiera hubo respuesta (red). */
  status: number | null;
  mensaje: string | null;
}): AccionRebote {
  if (v.destino === 'cotizado' && v.status === 400) return { accion: 'modal-interes' };
  const motivo = (v.mensaje ?? 'No se pudo mover').replace(/\.\s*$/, '');
  return { accion: 'aviso', mensaje: `${motivo}.` };
}

/**
 * El reintento tras registrar el interés: el drag original se completa solo —
 * misma tarjeta, mismo destino (`cotizado`). La vendedora no arrastra dos veces.
 */
export function reintentoTrasInteres<C>(pendiente: C | null): { c: C; etapa: Etapa } | null {
  return pendiente ? { c: pendiente, etapa: 'cotizado' } : null;
}
