import { inArray } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import { edicionesWa } from '../db/ediciones.js';

/**
 * GUARDAR Y LEER EDICIONES — mismo criterio de degradación que las reacciones
 * (`reacciones/repositorio.ts`): sin la migración aplicada, `guardar` traga el
 * error y `porMensaje` devuelve un mapa vacío. Un hilo sin la marca de
 * «Editado» sigue siendo el hilo; tumbarlo por eso sería un precio absurdo.
 */

function faltaLaTabla(e: unknown): boolean {
  const codigo = (e as { code?: string })?.code;
  return codigo === '42P01'; // undefined_table
}

export interface EdicionAplicada {
  mensajeExternalId: string;
  texto: string;
  editadoAt: Date;
}

/** Aplica una edición: REEMPLAZA el texto vigente del mensaje (no es un historial). */
export async function guardarEdicion(base: typeof Base, e: EdicionAplicada): Promise<'guardada' | 'sin_tabla'> {
  try {
    await base
      .insert(edicionesWa)
      .values({ mensajeExternalId: e.mensajeExternalId, texto: e.texto, editadoAt: e.editadoAt })
      .onConflictDoUpdate({
        target: edicionesWa.mensajeExternalId,
        set: { texto: e.texto, editadoAt: e.editadoAt },
      });
    return 'guardada';
  } catch (err) {
    if (faltaLaTabla(err)) {
      console.warn('[ediciones] `ediciones_wa` no existe todavía: la edición no se guarda.');
      return 'sin_tabla';
    }
    throw err;
  }
}

/** Una edición, tal como se dibuja: el texto vigente y cuándo cambió por última vez. */
export interface EdicionDeMensaje {
  texto: string;
  editadoAt: Date;
}

/**
 * Las ediciones de un puñado de mensajes, indexadas por `external_id` — una
 * consulta para todo el hilo, no una por burbuja (mismo criterio que
 * `reaccionesPorMensaje`).
 */
export async function edicionesPorMensaje(
  base: typeof Base,
  externalIds: string[],
): Promise<Map<string, EdicionDeMensaje>> {
  const mapa = new Map<string, EdicionDeMensaje>();
  if (externalIds.length === 0) return mapa;

  try {
    const filas = await base
      .select({ mensaje: edicionesWa.mensajeExternalId, texto: edicionesWa.texto, editadoAt: edicionesWa.editadoAt })
      .from(edicionesWa)
      .where(inArray(edicionesWa.mensajeExternalId, externalIds));

    for (const f of filas) mapa.set(f.mensaje, { texto: f.texto, editadoAt: f.editadoAt });
    return mapa;
  } catch (e) {
    if (faltaLaTabla(e)) return mapa;
    throw e;
  }
}
