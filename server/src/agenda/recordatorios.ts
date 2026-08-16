import { and, asc, desc, eq, gte, or } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { gestiones, recordatorios } from '../db/schema.js';

/**
 * EL SEAM DE LA AGENDA — `db` inyectado (ADR 0008).
 *
 * La ruta le pasa el singleton, el test su base de prueba. Acá vive todo lo que
 * toca la base: leer la agenda, agendar un recordatorio (con su consecuencia en
 * el embudo), cambiarle el estado y borrarlo. La ruta valida la entrada, llama
 * acá y serializa la respuesta: nada más.
 */

/** Una fila de `recordatorios`, tal cual sale de la base. */
export type FilaRecordatorio = typeof recordatorios.$inferSelect;

/**
 * Lo que hace falta para agendar. Ya normalizado por la ruta: acá llegan los
 * tipos resueltos, no el cuerpo crudo del request.
 */
export interface NuevoRecordatorio {
  vendedoraId: string;
  clave: string;
  canal: string;
  personaId: string | null;
  personaNombre: string | null;
  numeroPropio: string | null;
  nota: string;
  cuando: Date;
}

/** Los pendientes (todos, vencidos incluidos) + los hechos de los últimos 35 días
 *  (una grilla mensual completa, con margen). */
export async function consultarAgenda(
  base: typeof db,
  vendedoraId: string,
): Promise<FilaRecordatorio[]> {
  const hace7d = new Date(Date.now() - 35 * 24 * 3600 * 1000);
  return await base
    .select()
    .from(recordatorios)
    .where(
      and(
        eq(recordatorios.vendedoraId, vendedoraId),
        or(eq(recordatorios.estado, 'pendiente'), gte(recordatorios.cuando, hace7d)),
      ),
    )
    .orderBy(asc(recordatorios.cuando));
}

/** Agendar un seguimiento: la fila del recordatorio y lo que se sigue de ella. */
export async function agendarRecordatorio(
  base: typeof db,
  o: NuevoRecordatorio,
): Promise<FilaRecordatorio> {
  const [fila] = await base
    .insert(recordatorios)
    .values({
      vendedoraId: o.vendedoraId,
      clave: o.clave,
      canal: o.canal,
      personaId: o.personaId,
      personaNombre: o.personaNombre,
      numeroPropio: o.numeroPropio,
      nota: o.nota,
      cuando: o.cuando,
    })
    .returning();

  // Agendar un seguimiento ES contactar: si el lead seguía en "interesado" (o
  // sin gestión), pasa a "contactado" solo. La acción humana fue agendar; esto
  // asienta su consecuencia en el embudo. Los 'general' (sin conversación) no.
  if (fila.clave !== 'general') {
    const [ultima] = await base
      .select({ etapa: gestiones.etapa })
      .from(gestiones)
      .where(eq(gestiones.clave, fila.clave))
      .orderBy(desc(gestiones.creadoAt))
      .limit(1);
    const actual = ultima ? (ultima.etapa === 'nuevo' ? 'interesado' : ultima.etapa) : null;
    if (!actual || actual === 'interesado') {
      await base.insert(gestiones).values({
        vendedoraId: o.vendedoraId,
        clave: fila.clave,
        canal: fila.canal,
        personaId: fila.personaId,
        personaNombre: fila.personaNombre,
        numeroPropio: fila.numeroPropio,
        etapa: 'contactado',
        notas: `Agendó: ${fila.nota.slice(0, 80)}`,
      });
    }
  }

  return fila;
}

/**
 * Marcar hecho / reabrir. Solo el estado: la promesa no se reescribe.
 *
 * `null` cuando no existe o no es de esa vendedora: las dos cosas las decide el
 * MISMO `WHERE`, y por eso la ruta las contesta con un solo 404.
 */
export async function cambiarEstadoDeRecordatorio(
  base: typeof db,
  o: { id: number; vendedoraId: string; estado: 'pendiente' | 'hecho' },
): Promise<FilaRecordatorio | null> {
  const [fila] = await base
    .update(recordatorios)
    .set({ estado: o.estado })
    .where(and(eq(recordatorios.id, o.id), eq(recordatorios.vendedoraId, o.vendedoraId)))
    .returning();
  return fila ?? null;
}

/** Borrar un recordatorio propio. Devuelve si había algo que borrar. */
export async function borrarRecordatorio(
  base: typeof db,
  o: { id: number; vendedoraId: string },
): Promise<boolean> {
  const borradas = await base
    .delete(recordatorios)
    .where(and(eq(recordatorios.id, o.id), eq(recordatorios.vendedoraId, o.vendedoraId)))
    .returning({ id: recordatorios.id });
  return borradas.length > 0;
}
