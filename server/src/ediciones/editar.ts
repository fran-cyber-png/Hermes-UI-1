import type { db as Base } from '../db/client.js';
import type { TransporteWhatsapp } from '../whatsapp/transporte.js';
import { externalIdDeWa } from '../reacciones/dominio.js';
import { guardarEdicion } from './repositorio.js';

/**
 * EDITAR UN MENSAJE YA ENVIADO — la corrección de un error de tipeo.
 *
 * ── Por qué solo whatsmeow ────────────────────────────────────────────────
 * Es un permiso del PROTOCOLO de WhatsApp multi-dispositivo (lo tiene desde
 * 2023); Meta NO lo expone en la Cloud API — no hay ningún PATCH de mensajes
 * en la Graph API oficial (verificado contra la doc el 14-ago-2026: solo hay
 * POST para mandar). Por eso `editarTexto` es OPCIONAL en `TransporteWhatsapp`
 * — un transporte que no lo tenga (`cloud-api`, y hoy también `falso` fuera de
 * los tests) simplemente no ofrece el botón, feature-detectado con `?.`.
 *
 * ── Por qué NO pasa por `EnvioControlado` ─────────────────────────────────
 * Mismo argumento que reaccionar (`reacciones/enviar.ts`): esto no le llega a
 * un destinatario nuevo, corrige algo que YA le llegó a la MISMA persona. No
 * hay pieza que estampar de nuevo y contarlo contra el ritmo (20/hora,
 * 60/día) le robaría cupo a los envíos de verdad por corregir una tilde.
 *
 * Lo que sí se conserva es lo que protege la línea: la guarda de número propio
 * y que no se edite con la sesión caída o baneada.
 */

export type ResultadoEdicion = { ok: true } | { ok: false; motivo: string };

export interface OrdenEdicion {
  numeroPropio: string;
  telefono: string;
  /** El id CRUDO de WhatsApp del mensaje saliente original (sin el `wa:`). */
  mensajeId: string;
  textoNuevo: string;
}

/** Pura: por qué esta edición no se puede mandar, o `null` si se puede. */
export function motivoParaNoEditar(textoNuevo: string): string | null {
  if (!textoNuevo.trim()) return 'el mensaje no puede quedar vacío';
  return null;
}

/**
 * `transporte` viene inyectado, como en `reaccionar` — el mismo seam del
 * repo, para testear sin levantar WhatsApp.
 */
export async function editarMensaje(
  base: typeof Base,
  transporte: Pick<TransporteWhatsapp, 'estado' | 'editarTexto' | 'numeroPropio'>,
  orden: OrdenEdicion,
): Promise<ResultadoEdicion> {
  if (!orden.mensajeId) return { ok: false, motivo: 'falta el mensaje a editar' };
  const motivo = motivoParaNoEditar(orden.textoNuevo);
  if (motivo) return { ok: false, motivo };

  // La guarda de línea equivocada, igual que en `reaccionar` y `EnvioControlado`:
  // una edición que sale por otro número corrige un mensaje en un chat que ese
  // transporte no mandó nunca.
  if (transporte.numeroPropio !== orden.numeroPropio) {
    return {
      ok: false,
      motivo: `la edición es para ${orden.numeroPropio} y este transporte es ${transporte.numeroPropio}`,
    };
  }

  const estado = transporte.estado();
  if (estado.estado === 'baneado') {
    return { ok: false, motivo: `WhatsApp suspendió el número (código ${estado.codigo})` };
  }
  if (estado.estado !== 'conectado') {
    return { ok: false, motivo: `la sesión está "${estado.estado}"` };
  }
  if (!transporte.editarTexto) {
    return { ok: false, motivo: 'esta línea no puede editar mensajes' };
  }

  await transporte.editarTexto(orden.telefono, orden.mensajeId, orden.textoNuevo);

  // Se guarda DESPUÉS de que salió, igual que una reacción: si WhatsApp la
  // rechazó, no queda una edición fantasma que la burbuja muestre sin haber
  // salido de verdad.
  await guardarEdicion(base, {
    mensajeExternalId: externalIdDeWa(orden.mensajeId),
    texto: orden.textoNuevo,
    editadoAt: new Date(),
  });

  return { ok: true };
}
