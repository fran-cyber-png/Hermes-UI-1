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
  /** `llamada` | `whatsapp` | `reunion` | `seguimiento` | `recordatorio` | `otro`. */
  tipo?: string;
  /** Minutos. `null` = no se dijo (la agenda pinta el bloque estándar). */
  duracionMin?: number | null;
  /** `alta` | `media` | `baja`. `null` = sin definir, el caso normal. */
  importancia?: string | null;
}

/**
 * LO QUE SE PUEDE CAMBIAR DE UN RECORDATORIO YA CREADO. Todo opcional: el PATCH
 * toca **sólo lo que viene**.
 *
 * 🔴 Esto era `{ estado }` a secas, y por eso reprogramar no reprogramaba: el
 * front ya mandaba `PATCH {cuando}` y `PATCH {importancia}` (arrastrar en el
 * calendario, el punto de color) contra una ruta que leía `req.body.estado`,
 * lo encontraba `undefined`, y **guardaba `pendiente`**. O sea que arrastrar una
 * tarea no la movía Y de paso des-completaba la que estaba hecha, sin un solo
 * síntoma. La forma parcial es lo que impide que vuelva a pasar: un campo que
 * no viaja no se escribe.
 */
export interface CambioDeRecordatorio {
  nota?: string;
  cuando?: Date;
  tipo?: string;
  duracionMin?: number | null;
  importancia?: string | null;
  estado?: EstadoRecordatorio;
}

/**
 * `cancelado` NO es `hecho`: «la llamé» y «ya no hace falta llamarla» son cosas
 * distintas, y contarlas juntas vuelve el cumplimiento de la agenda un número
 * que no significa nada.
 */
export type EstadoRecordatorio = 'pendiente' | 'hecho' | 'cancelado';

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
      // `undefined` deja que mande el default de la columna (`seguimiento`);
      // por eso no se escribe `?? 'seguimiento'` acá: el default vive en un
      // lugar solo, que es el schema.
      tipo: o.tipo,
      duracionMin: o.duracionMin ?? null,
      importancia: o.importancia ?? null,
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
 * Editar un recordatorio propio: marcarlo hecho, cancelarlo, reprogramarlo,
 * cambiarle el tipo o la importancia. **Sólo lo que viene en `cambios`.**
 *
 * `null` cuando no existe o no es de esa vendedora: las dos cosas las decide el
 * MISMO `WHERE`, y por eso la ruta las contesta con un solo 404.
 *
 * ⚠️ Con `cambios` vacío devuelve la fila tal cual, sin escribir: un UPDATE con
 * `set({})` es un error de SQL, y un PATCH que no pide nada no es un error de
 * la vendedora.
 */
export async function actualizarRecordatorio(
  base: typeof db,
  o: { id: number; vendedoraId: string; cambios: CambioDeRecordatorio },
): Promise<FilaRecordatorio | null> {
  const mio = and(eq(recordatorios.id, o.id), eq(recordatorios.vendedoraId, o.vendedoraId));

  if (Object.keys(o.cambios).length === 0) {
    const [fila] = await base.select().from(recordatorios).where(mio).limit(1);
    return fila ?? null;
  }

  const [fila] = await base.update(recordatorios).set(o.cambios).where(mio).returning();
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
