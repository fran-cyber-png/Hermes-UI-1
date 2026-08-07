import type { db as Base } from '../db/client.js';
import type { TransporteWhatsapp } from '../whatsapp/transporte.js';
import { externalIdDeWa, leerReaccion } from './dominio.js';
import { guardarReaccion } from './repositorio.js';

/**
 * REACCIONAR NOSOTROS — poner un 👍 a lo que dijo el lead.
 *
 * ── Por qué NO pasa por `EnvioControlado` ────────────────────────────────
 * La regla de la casa es que `EnvioControlado` es la única puerta hacia
 * `enviarTexto`, y se respeta: esto no manda un mensaje. Pero la pregunta de
 * fondo —«¿debería pasar igual?»— merece respuesta escrita, porque la respuesta
 * fácil sería «sí, por las dudas» y estaría mal:
 *
 * · `envios_wa` es el registro de MENSAJES, con su pieza, su procedencia y su
 *   versión (ADR 0022). Una reacción no tiene texto, no sale de ningún catálogo
 *   y no hay «de qué pieza salió» que estampar. Meterla ahí llenaría de filas
 *   vacías la tabla que mide qué contenido funciona.
 * · 🔴 **Y contaría contra el ritmo.** Los topes de 20/hora y 60/día por número
 *   existen para que un envío masivo no queme la línea. Un 👍 no es eso — pero
 *   si consumiera cupo, **reaccionar le robaría envíos a los mensajes de
 *   verdad**, que es exactamente al revés de lo que se quiere.
 *
 * Lo que sí se conserva es lo que protege la línea: **no se reacciona con la
 * sesión caída ni baneada**. Un `temporary_ban` frena esto igual que frena todo
 * lo demás.
 *
 * ── Y sigue siendo una acción humana ─────────────────────────────────────
 * Una reacción sale porque alguien tocó un emoji. No hay reacción automática, no
 * hay «reaccionar a todos los que preguntaron por precio». La forma de esta
 * función es el control: un emoji, un mensaje, una vez.
 */

export type ResultadoReaccion =
  | { ok: true; quitada: boolean }
  | { ok: false; motivo: string };

export interface OrdenReaccion {
  numeroPropio: string;
  telefono: string;
  /** El id CRUDO de WhatsApp del mensaje al que se reacciona (sin el `wa:`). */
  mensajeId: string;
  /** El emoji. Vacío = quitar la reacción. */
  emoji: string;
}

/**
 * `transporte` viene inyectado (no se busca el gestor acá) para que esto se
 * pueda testear sin levantar WhatsApp: es el mismo patrón de los seams del repo.
 */
export async function reaccionar(
  base: typeof Base,
  transporte: Pick<TransporteWhatsapp, 'estado' | 'enviarReaccion' | 'numeroPropio'>,
  orden: OrdenReaccion,
): Promise<ResultadoReaccion> {
  if (!orden.mensajeId) return { ok: false, motivo: 'falta el mensaje al que reaccionar' };

  // La guarda de línea equivocada, igual que en `EnvioControlado`: una reacción
  // que sale por otro número aparece en un chat que el lead no conoce.
  if (transporte.numeroPropio !== orden.numeroPropio) {
    return {
      ok: false,
      motivo: `la reacción es para ${orden.numeroPropio} y este transporte es ${transporte.numeroPropio}`,
    };
  }

  const estado = transporte.estado();
  if (estado.estado === 'baneado') {
    return { ok: false, motivo: `WhatsApp suspendió el número (código ${estado.codigo})` };
  }
  if (estado.estado !== 'conectado') {
    return { ok: false, motivo: `la sesión está "${estado.estado}"` };
  }
  if (!transporte.enviarReaccion) {
    return { ok: false, motivo: 'esta línea no puede reaccionar' };
  }

  const accion = leerReaccion(orden.emoji);
  await transporte.enviarReaccion(orden.telefono, orden.mensajeId, accion.tipo === 'poner' ? accion.emoji : '');

  // Se guarda DESPUÉS de que salió, y con `dePersona` = el número propio: así la
  // píldora se dibuja de nuestro lado sin esperar a que WhatsApp nos devuelva
  // nuestro propio recibo (que además puede no llegar nunca).
  await guardarReaccion(base, {
    mensajeExternalId: externalIdDeWa(orden.mensajeId),
    dePersona: orden.numeroPropio,
    emoji: accion.tipo === 'poner' ? accion.emoji : '',
    cuando: new Date(),
  });

  return { ok: true, quitada: accion.tipo === 'quitar' };
}
