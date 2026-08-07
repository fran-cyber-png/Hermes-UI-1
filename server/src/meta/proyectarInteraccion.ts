import type { db } from "../db/client.js";
import { events, interactions } from "../db/schema.js";

/**
 * LA ÚNICA FORMA DE ESCRIBIR UNA INTERACCIÓN DE META — evento crudo + proyección.
 *
 * ── Por qué esto vive en un módulo propio ─────────────────────────────────
 * Hay DOS caminos por los que entra un comentario de FB/IG o un DM de
 * Messenger: el **polling** del Graph API (`interactionsIngestor.ts`, que fue el
 * único hasta el 7-ago-2026) y el **webhook** en tiempo real
 * (`webhook/meta.ts`). Los dos escriben la MISMA fila.
 *
 * Si cada uno se armara la suya, el mismo comentario entraría con dos formas
 * —uno con `direccion`, el otro sin; uno con el nombre, el otro con el
 * @usuario— y la cola mostraría dos cosas distintas para el mismo hecho según
 * quién lo capturó primero. Es la lección de #37 aplicada antes de pagarla:
 * `proyectarInteraccion.test.ts` cruza los dos caminos y falla si divergen.
 *
 * ── LA IDEMPOTENCIA ES LO QUE HACE QUE CONVIVAN ───────────────────────────
 * `(source, external_id)` en `events` y `external_id` en `interactions`. Y el
 * `external_id` es EL MISMO por los dos caminos, que es el detalle del que
 * depende todo: el `mid` que manda el webhook de Messenger es el mismo id que
 * devuelve `conversations{messages{id}}`, y el `comment_id` del webhook de
 * `feed` es el mismo `id` que devuelve `posts{comments{id}}`. Por eso se puede
 * dejar el polling corriendo como red de seguridad del webhook sin duplicar una
 * sola fila.
 *
 * ── Y por eso NO se guarda nada más que lo que Meta mandó ─────────────────
 * El que llega segundo no pisa: `onConflictDoNothing`. Gana el primero, y
 * tienen que ser intercambiables.
 */

/** Lo que se proyecta a `interactions`. El evento crudo va aparte, sin tocar. */
export interface ProyeccionInteraccion {
  externalId: string;
  canal: string;
  tipo: string;
  /** 'entrante' | 'saliente'. Sin esto no sabemos a quién le respondimos. */
  direccion?: string;
  /** 'persona' | 'pagina' | 'bot'. */
  autor?: string;
  personaId: string | null;
  personaNombre: string | null;
  texto: string | null;
  pageId: string;
  contextoId: string | null;
  contextoTexto: string | null;
  occurredAt: Date;
}

/** Lo que hace falta para escribir: de dónde vino, el crudo, y la proyección. */
export interface InteraccionDeMeta {
  /** `meta_comment_fb` · `meta_message_fb` · `meta_comment_ig`. */
  source: string;
  /** El payload tal como llegó. Es la fuente de verdad; la proyección es derivada. */
  raw: unknown;
  proyeccion: ProyeccionInteraccion;
}

type Base = typeof db;

/**
 * Guarda una interacción: **evento crudo primero** (fuente de verdad), proyección
 * después. Devuelve si era nueva — correrlo mil veces nunca duplica ni pierde.
 *
 * `base` se RECIBE, no se toma del singleton, y el import de `db/client` es
 * `import type` a propósito: un `.test.db.ts` corre contra la base efímera de
 * `TEST_DATABASE_URL`, y con el singleton importado como VALOR este módulo
 * exigiría `DATABASE_URL` al cargarse — o sea que el test no podría ni arrancar.
 * Es el mismo patrón que `cola/consultarCola.ts`.
 */
export async function guardarInteraccion(
  { source, raw, proyeccion }: InteraccionDeMeta,
  base: Base,
): Promise<boolean> {
  const [event] = await base
    .insert(events)
    .values({
      source,
      externalId: proyeccion.externalId,
      occurredAt: proyeccion.occurredAt,
      payload: raw as never,
    })
    .onConflictDoNothing({ target: [events.source, events.externalId] })
    .returning({ id: events.id });

  if (!event) return false; // ya lo teníamos

  await base
    .insert(interactions)
    .values({ eventId: event.id, ...proyeccion })
    .onConflictDoNothing({ target: interactions.externalId });

  return true;
}
