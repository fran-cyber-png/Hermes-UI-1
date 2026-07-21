import { db } from '../db/client.js';
import { events, interactions } from '../db/schema.js';
import type { RepositorioInteracciones } from './ingesta.js';
import type { EventoProyectado, InteraccionProyectada } from './proyectar.js';

/**
 * El repositorio real, contra Postgres. Mismo patrón que `interactionsIngestor`:
 * el evento crudo primero (fuente de verdad), la proyección después, ambos
 * idempotentes por sus UNIQUE.
 *
 * Vive en su propio archivo —y no en `ingesta.ts`— a propósito: importa `db`, y
 * `db/client.ts` explota si no hay `DATABASE_URL`. Manteniéndolo separado, el
 * test del puente corre sin Postgres ni variables de entorno.
 */
export const repositorioDrizzle: RepositorioInteracciones = {
  async persistir(evento: EventoProyectado, interaccion: InteraccionProyectada): Promise<boolean> {
    const [event] = await db
      .insert(events)
      .values({
        source: evento.source,
        externalId: evento.externalId,
        occurredAt: evento.occurredAt,
        payload: evento.payload,
      })
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({ id: events.id });

    // Sin fila devuelta, el evento ya existía: es un duplicado, no un error.
    if (!event) return false;

    await db
      .insert(interactions)
      .values({
        eventId: event.id,
        externalId: interaccion.externalId,
        canal: interaccion.canal,
        tipo: interaccion.tipo,
        direccion: interaccion.direccion,
        autor: interaccion.autor,
        personaId: interaccion.personaId,
        personaNombre: interaccion.personaNombre,
        texto: interaccion.texto,
        // WhatsApp no tiene "publicación" ni conversación-contexto como los
        // comentarios de Meta: estos quedan null y no se inventan.
        pageId: null,
        contextoId: null,
        occurredAt: interaccion.occurredAt,
      })
      .onConflictDoNothing({ target: interactions.externalId });

    return true;
  },
};
