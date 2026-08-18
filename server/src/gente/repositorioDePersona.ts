import { eq, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { interactions } from "../db/schema.js";
import { sinEstasLineasSql } from "../numeros/campana.js";

/**
 * EL SEAM DE LA FICHA DE PERSONA — lo que `routes/persona.ts` necesita de la base.
 *
 * Acá vive TODO el SQL de ese router: el hilo de una persona en un canal, la
 * interacción suelta que se abre desde la cola, y los dos datos que se le
 * preguntan a Meta una sola vez y se cachean en la fila (`puede_privado` y el
 * `permalink`). El router queda con lo suyo: leer los params, decidir y
 * serializar.
 *
 * Recibe `base` INYECTADA (patrón de la casa, ADR 0008 — el mismo de
 * `consultarSenales` y `leadDeTelefono`): la ruta le pasa el singleton, el test
 * su base de prueba. Nunca el singleton desde adentro.
 *
 * ⚠️ Las consultas están tal cual salieron del router: mismo texto, mismos
 * parámetros, mismo orden de filas. Esto es una mudanza, no una optimización.
 *
 * ══ LA FRONTERA DE CAMPAÑA (`numeros/campana.ts`) ═══════════════════════════
 *
 * Las tres consultas de acá leen `interactions` por `(canal, persona_id)` o por
 * id, **sin mirar por qué línea entró el mensaje**, así que las tres servían la
 * conversación de una línea de campaña a cualquiera. Cada una recibe ahora la
 * lista de líneas vedadas, resuelta en la ruta (que es donde hay una persona).
 *
 * 🔴 **`interaccionPorId` filtra en el `WHERE` y devuelve `undefined`, o sea un
 * 404 — no un 403.** El id es un `serial`: es ENUMERABLE (hallazgo C3 de la
 * auditoría del 17-ago-2026), así que un 403 confirmaría que ese id existe y
 * convertiría la frontera en un censo. Con el 404, una fila de campaña se ve
 * igual que una que no existe.
 */

/** Una fila del hilo completo de una persona en un canal (la vista de conversación). */
export type FilaDelHilo = {
  id: number;
  tipo: string;
  direccion: string;
  autor: string;
  persona_nombre: string | null;
  texto: string | null;
  occurred_at: string;
  status: string;
};

/**
 * El hilo COMPLETO de una persona en un canal, en orden de conversación (ASC).
 *
 * Llave `(canal, persona_id)` —la misma con la que la cola agrupa los DMs de
 * Messenger—, no el id de una interacción suelta.
 */
export async function hiloDeLaConversacion(
  base: typeof db,
  canal: string,
  personaId: string,
  lineasVedadas: readonly string[] = [],
): Promise<FilaDelHilo[]> {
  return await base.execute<FilaDelHilo>(sql`
    SELECT id, tipo, direccion, autor, persona_nombre, texto, occurred_at, status
    FROM interactions
    WHERE canal = ${canal} AND persona_id = ${personaId}
      AND ${sinEstasLineasSql(sql`numero_propio`, lineasVedadas)}
    ORDER BY occurred_at ASC
    LIMIT 100
  `);
}

/** La interacción que se abrió, con lo mínimo para saber a quién pertenece. */
export type InteraccionAbierta = {
  id: number;
  canal: string;
  persona_id: string | null;
  persona_nombre: string | null;
};

/** La interacción por su id. `undefined` si no existe (el 404 lo decide el router). */
export async function interaccionPorId(
  base: typeof db,
  id: number,
  lineasVedadas: readonly string[] = [],
): Promise<InteraccionAbierta | undefined> {
  const [actual] = await base.execute<InteraccionAbierta>(
    sql`SELECT id, canal, persona_id, persona_nombre FROM interactions
         WHERE id = ${id} AND ${sinEstasLineasSql(sql`numero_propio`, lineasVedadas)}`,
  );
  return actual;
}

/** Una fila del historial reciente de una persona (lo que se pinta al abrir una interacción). */
export type FilaDelHistorial = {
  id: number;
  tipo: string;
  texto: string | null;
  contexto_texto: string | null;
  occurred_at: string;
  status: string;
};

/** Las últimas 25 interacciones de esa persona en ese canal, de la más nueva a la más vieja. */
export async function historialDeLaPersona(
  base: typeof db,
  canal: string,
  personaId: string,
  lineasVedadas: readonly string[] = [],
): Promise<FilaDelHistorial[]> {
  return await base.execute<FilaDelHistorial>(sql`
    SELECT id, tipo, texto, contexto_texto, occurred_at, status
    FROM interactions
    WHERE canal = ${canal} AND persona_id = ${personaId}
      AND ${sinEstasLineasSql(sql`numero_propio`, lineasVedadas)}
    ORDER BY occurred_at DESC
    LIMIT 25
  `);
}

/**
 * Lo que hace falta para responder «¿se le puede mandar un privado?» SIN llamar a
 * Meta: el canal y el tipo (en Instagram ni siquiera está habilitado), la
 * antigüedad, si la ventana de 7 días sigue abierta, y la respuesta cacheada de
 * una consulta anterior.
 */
export type DatosDePrivado = {
  canal: string;
  tipo: string;
  page_id: string;
  external_id: string;
  dias: number;
  ventana_abierta: boolean;
  puede_privado: boolean | null;
};

export async function datosDePrivado(
  base: typeof db,
  id: number,
): Promise<DatosDePrivado | undefined> {
  const [inter] = await base.execute<DatosDePrivado>(sql`
    SELECT i.canal, i.tipo, i.page_id, e.external_id,
           extract(day FROM now() - i.occurred_at)::int          AS dias,
           (i.occurred_at > now() - interval '7 days')           AS ventana_abierta,
           i.puede_privado
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.id = ${id}
  `);
  return inter;
}

/** El cacheo de lo que contestó Meta: la respuesta y cuándo se preguntó. */
export async function guardarPuedePrivado(
  base: typeof db,
  id: number,
  puede: boolean,
): Promise<void> {
  await base
    .update(interactions)
    .set({ puedePrivado: puede, puedePrivadoAt: new Date() })
    .where(eq(interactions.id, id));
}

/**
 * Lo que hace falta para resolver el link a Facebook/Instagram: el `permalink` ya
 * cacheado (si está, no se llama a Meta), y con qué preguntarle si no está —la
 * Página, el id externo del comentario y, en Instagram, la publicación que lo
 * contiene.
 */
export type DatosDelLink = {
  id: number;
  canal: string;
  page_id: string;
  permalink: string | null;
  external_id: string;
  contexto_id: string | null;
};

export async function datosDelLink(
  base: typeof db,
  id: number,
): Promise<DatosDelLink | undefined> {
  const [inter] = await base.execute<DatosDelLink>(sql`
    SELECT i.id, i.canal, i.page_id, i.permalink, i.contexto_id, e.external_id
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.id = ${id}
  `);
  return inter;
}

/** El cacheo del permalink que resolvió Meta. */
export async function guardarPermalink(
  base: typeof db,
  id: number,
  permalink: string,
): Promise<void> {
  await base.update(interactions).set({ permalink }).where(eq(interactions.id, id));
}
