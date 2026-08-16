import { eq, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { events, interactions } from "../db/schema.js";

/**
 * EL SEAM DE RESPONDER COMENTARIOS — lo que `routes/responder.ts` necesita de la base.
 *
 * Acá vive TODO el SQL de ese router: la interacción que se va a responder, el
 * registro de lo enviado (evento + estado de la fila), y las dos lecturas que
 * hacen falta para deshacer una respuesta publicada. El router queda con lo
 * suyo: validar la entrada, hablarle a Meta, decidir y serializar.
 *
 * Recibe `base` INYECTADA (patrón de la casa, ADR 0008 — el mismo de
 * `consultarSenales` y `repositorioDePersona`): la ruta le pasa el singleton, el
 * test su base de prueba. Nunca el singleton desde adentro.
 *
 * ⚠️ Las consultas están tal cual salieron del router: mismo texto, mismos
 * parámetros, mismo orden de filas. Esto es una mudanza, no una optimización.
 */

/**
 * La interacción que se quiere responder, con lo mínimo para decidir: si es un
 * comentario (lo único soportado hoy), de qué Página es y cuál es su id externo
 * en Meta —que es contra el que se publica la respuesta y se manda el privado—.
 */
export type InteraccionAResponder = {
  id: number;
  canal: string;
  tipo: string;
  external_id: string;
  page_id: string;
  persona_nombre: string | null;
};

/** La interacción por su id. `undefined` si no existe (el 404 lo decide el router). */
export async function interaccionAResponder(
  base: typeof db,
  interactionId: number,
): Promise<InteraccionAResponder | undefined> {
  const [inter] = await base.execute<InteraccionAResponder>(sql`
    SELECT i.id, i.canal, i.tipo, i.page_id, i.persona_nombre, e.external_id
    FROM interactions i JOIN events e ON e.id = i.event_id
    WHERE i.id = ${interactionId}
  `);
  return inter;
}

/** Guarda lo enviado como evento — queda el registro de qué se dijo y a quién. */
export async function registrarRespuesta(
  base: typeof db,
  tipo: string,
  interactionId: number,
  payload: unknown,
): Promise<void> {
  await base.insert(events).values({
    source: `respuesta_${tipo}`,
    externalId: `${interactionId}:${tipo}:${Date.now()}`,
    occurredAt: new Date(),
    payload: payload as any,
  });
  await base
    .update(interactions)
    .set({ status: "contactado" })
    .where(eq(interactions.id, interactionId));
}

/**
 * El evento de la última respuesta que registramos para esa interacción. El
 * `payload` es el crudo que se guardó al enviar: adentro vive
 * `resultado.publico`, el id del comentario que publicamos, que es lo único que
 * se puede borrar.
 */
export type RespuestaRegistrada = {
  id: number;
  payload: any;
};

/**
 * La última respuesta registrada de esa interacción (la más reciente por
 * `occurred_at`). `undefined` si nunca se respondió.
 */
export async function ultimaRespuestaPublicada(
  base: typeof db,
  interactionId: number,
): Promise<RespuestaRegistrada | undefined> {
  const [evento] = await base.execute<RespuestaRegistrada>(sql`
    SELECT id, payload FROM events
    WHERE source = 'respuesta_comentario' AND external_id LIKE ${`${interactionId}:%`}
    ORDER BY occurred_at DESC LIMIT 1
  `);
  return evento;
}

/** La Página dueña de la interacción — con eso se pide el token que puede borrar. */
export type PaginaDeLaInteraccion = {
  page_id: string;
};

/**
 * La Página de esa interacción.
 *
 * ⚠️ El tipo no dice `| undefined` porque es EXACTAMENTE lo que el router
 * asumía cuando la consulta vivía adentro (`const [inter] = await db.execute…`)
 * y no se le agrega un chequeo que antes no estaba: sería cambiarle el
 * comportamiento a una mudanza. Con la fila ausente devuelve `undefined` en
 * runtime, igual que antes.
 */
export async function paginaDeLaInteraccion(
  base: typeof db,
  interactionId: number,
): Promise<PaginaDeLaInteraccion> {
  const [inter] = await base.execute<PaginaDeLaInteraccion>(sql`
    SELECT page_id FROM interactions WHERE id = ${interactionId}
  `);
  return inter;
}

/**
 * Deja registrado que se borró una respuesta nuestra y devuelve la fila a
 * `nuevo`: la conversación vuelve a estar sin contactar, que es la verdad
 * después de sacar lo publicado.
 */
export async function registrarBorrado(
  base: typeof db,
  interactionId: number,
  comentarioBorrado: string,
): Promise<void> {
  await base.insert(events).values({
    source: "respuesta_borrada",
    externalId: `${interactionId}:borrada:${Date.now()}`,
    occurredAt: new Date(),
    payload: { interactionId, comentarioBorrado },
  });
  await base.update(interactions).set({ status: "nuevo" }).where(eq(interactions.id, interactionId));
}
