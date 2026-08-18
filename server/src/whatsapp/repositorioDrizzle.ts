import { db } from '../db/client.js';
import { events, interactions } from '../db/schema.js';
import { emitirRT } from '../realtime/bus.js';
import { claveDeConversacion, duenaDeConversacion } from '../realtime/duenaDeConversacion.js';
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
        // De qué línea propia. Lo que en Meta se deduciría de `page_id`, en
        // WhatsApp es el número: sin esto, dos vendedoras quedan en un solo pozo.
        numeroPropio: interaccion.numeroPropio,
        // WhatsApp no tiene "publicación" ni conversación-contexto como los
        // comentarios de Meta: estos quedan null y no se inventan.
        pageId: null,
        contextoId: null,
        occurredAt: interaccion.occurredAt,
      })
      .onConflictDoNothing({ target: interactions.externalId });

    // Push de tiempo real: CUALQUIER mensaje nuevo (entrante, saliente, simulado)
    // pasa por acá, así que este es el único punto donde avisar "algo cambió".
    // La cola y la conversación de esta persona se invalidan al instante en el front.
    // `direccion` viaja para que el front pueda sonar SOLO con lo entrante — sin
    // ella, la campanita sonaría también cuando la vendedora manda un mensaje.
    //
    // 🔴 **`duena` decide a QUIÉN se le nombra este teléfono.** El evento se
    // publica igual para todas (la cola de cada una tiene que refrescarse), pero
    // sin este dato el stream lo sirve recortado — ver `realtime/visibilidad.ts`.
    // Es UNA lectura por PK y nunca tira: un fallo devuelve `null`, o sea evento
    // recortado, y jamás se lleva puesto el mensaje que se acaba de guardar.
    const duena = await duenaDeConversacion(
      db,
      claveDeConversacion(interaccion.canal, interaccion.personaId, interaccion.numeroPropio),
    );
    emitirRT({
      tipo: 'mensaje',
      canal: interaccion.canal,
      telefono: interaccion.personaId,
      direccion: interaccion.direccion,
      duena,
    });

    return true;
  },
};
