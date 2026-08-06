import { and, eq, inArray, sql } from 'drizzle-orm';
import type { db as Base } from '../db/client.js';
import { reaccionesWa } from '../db/reacciones.js';
import { leerReaccion, type ReaccionEntrante } from './dominio.js';

/**
 * GUARDAR Y LEER REACCIONES.
 *
 * ── Degrada, no tumba ────────────────────────────────────────────────────
 * Sin la migración aplicada, `guardar` traga el error y `porMensaje` devuelve un
 * mapa vacío. Es lo contrario de lo que hace el catálogo de piezas (ADR 0023,
 * donde media lista es una mentira para un índice que cachea) y por el mismo
 * criterio: acá el consumidor es una persona mirando un hilo, y **un hilo sin
 * las reacciones sigue siendo el hilo**. Tumbar la conversación entera de la
 * vendedora porque no se pudo pintar un 👍 sería un precio absurdo.
 *
 * Los envíos y el hilo se despliegan antes que el schema (N4 va solo, N5 es un
 * botón): esta ventana existe de verdad en cada deploy.
 */

function faltaLaTabla(e: unknown): boolean {
  // 42P01 = undefined_table. Cualquier otro error se propaga: un fallo de
  // conexión no es «no hay reacciones».
  const codigo = (e as { code?: string })?.code;
  return codigo === '42P01';
}

/**
 * Aplica una reacción entrante: la pone, la reemplaza o la quita.
 *
 * **Reaccionar de nuevo REEMPLAZA** (una persona tiene una reacción por
 * mensaje) y **el emoji vacío QUITA** — las dos cosas son la semántica de
 * WhatsApp, y las dos llegan por el mismo camino. Ver `dominio.ts`.
 *
 * Devuelve qué pasó, para poder loguearlo sin volver a leer.
 */
export async function guardarReaccion(
  base: typeof Base,
  r: ReaccionEntrante,
): Promise<'puesta' | 'quitada' | 'sin_tabla'> {
  const accion = leerReaccion(r.emoji);
  try {
    if (accion.tipo === 'quitar') {
      await base
        .delete(reaccionesWa)
        .where(
          and(
            eq(reaccionesWa.mensajeExternalId, r.mensajeExternalId),
            eq(reaccionesWa.dePersona, r.dePersona),
          ),
        );
      return 'quitada';
    }
    await base
      .insert(reaccionesWa)
      .values({
        mensajeExternalId: r.mensajeExternalId,
        dePersona: r.dePersona,
        emoji: accion.emoji,
        occurredAt: r.cuando,
      })
      .onConflictDoUpdate({
        target: [reaccionesWa.mensajeExternalId, reaccionesWa.dePersona],
        set: { emoji: accion.emoji, occurredAt: r.cuando },
      });
    return 'puesta';
  } catch (e) {
    if (faltaLaTabla(e)) {
      console.warn('[reacciones] `reacciones_wa` no existe todavía: la reacción no se guarda.');
      return 'sin_tabla';
    }
    throw e;
  }
}

/** Una reacción, tal como se dibuja. */
export interface ReaccionDeMensaje {
  emoji: string;
  /** `true` si la puso Goberna por esa línea, no el lead. */
  nuestra: boolean;
}

/**
 * Las reacciones de un puñado de mensajes, indexadas por `external_id`.
 *
 * Una consulta para todo el hilo y no una por burbuja: 200 mensajes serían 200
 * viajes para pintar algo que casi siempre está vacío.
 */
export async function reaccionesPorMensaje(
  base: typeof Base,
  externalIds: string[],
  numeroPropio?: string | null,
): Promise<Map<string, ReaccionDeMensaje[]>> {
  const mapa = new Map<string, ReaccionDeMensaje[]>();
  if (externalIds.length === 0) return mapa;

  try {
    const filas = await base
      .select({
        mensaje: reaccionesWa.mensajeExternalId,
        emoji: reaccionesWa.emoji,
        de: reaccionesWa.dePersona,
      })
      .from(reaccionesWa)
      .where(inArray(reaccionesWa.mensajeExternalId, externalIds))
      .orderBy(sql`${reaccionesWa.occurredAt} ASC`);

    const propio = (numeroPropio ?? '').replace(/\D/g, '');
    for (const f of filas) {
      const lista = mapa.get(f.mensaje) ?? [];
      lista.push({ emoji: f.emoji, nuestra: propio !== '' && f.de === propio });
      mapa.set(f.mensaje, lista);
    }
    return mapa;
  } catch (e) {
    if (faltaLaTabla(e)) return mapa;
    throw e;
  }
}
