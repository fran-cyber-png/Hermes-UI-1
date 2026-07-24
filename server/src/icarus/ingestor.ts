import type { db } from "../db/client.js";
import { events, leads } from "../db/schema.js";
import { submissionALead, type SubmissionIcarus } from "./mapeo.js";

/**
 * INGESTA ICARUS → event store + `leads` (#114).
 *
 * Calca el patrón de `meta/leadsIngestor.ts`: escribe primero el EVENTO CRUDO
 * (la fuente de verdad, con la submission entera en el payload) y recién después
 * proyecta el lead normalizado. El `ON CONFLICT DO NOTHING` sobre
 * (source, external_id) es lo que hace idempotente correr esto mil veces: nunca
 * duplica ni pierde una submission. La misma persona que además está en Meta
 * convive en la tabla `leads`; el desempate lo hace el seam de la ficha (#113),
 * no la ingesta.
 *
 * Recibe `destino` INYECTADO (patrón de la casa, ADR 0008): el script le pasa el
 * singleton de Hermes, el test su base de prueba. La conexión READ-ONLY a icarus
 * es problema del script (`scripts/ingestIcarus.ts`) — acá solo llegan filas ya
 * leídas, y esto solo ESCRIBE en la base de Hermes.
 */

/** El `source` del event store para las submissions de landings web. */
export const ICARUS_SOURCE = "icarus_landing";

export interface ResumenIcarus {
  /** Filas leídas de icarus en el lote. */
  leidos: number;
  /** Leads nuevos proyectados. */
  insertados: number;
  /** Filas cuyo evento ya estaba ingerido (idempotencia). */
  yaEstaban: number;
  /** Filas sin teléfono NI email (o sin fecha usable): no aportan al match. */
  descartados: number;
}

/** Suma dos resúmenes — para acumular a lo largo de las tandas del script. */
export function sumarResumen(a: ResumenIcarus, b: ResumenIcarus): ResumenIcarus {
  return {
    leidos: a.leidos + b.leidos,
    insertados: a.insertados + b.insertados,
    yaEstaban: a.yaEstaban + b.yaEstaban,
    descartados: a.descartados + b.descartados,
  };
}

/** Ingiere un lote de submissions de icarus de forma idempotente. */
export async function ingestarLote(
  destino: typeof db,
  filas: SubmissionIcarus[],
): Promise<ResumenIcarus> {
  let insertados = 0;
  let yaEstaban = 0;
  let descartados = 0;

  for (const fila of filas) {
    const lead = submissionALead(fila);
    if (lead === null) {
      descartados += 1;
      continue;
    }

    // 1. Evento crudo — la fuente de verdad. El external_id es el leadId
    //    namespaced ('icarus:<id>'); si ya existía, no se toca.
    const [event] = await destino
      .insert(events)
      .values({
        source: ICARUS_SOURCE,
        externalId: lead.leadId,
        occurredAt: lead.createdTime,
        payload: fila,
      })
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({ id: events.id });

    // Sin fila devuelta = el evento ya estaba ingerido. Nada que proyectar.
    if (!event) {
      yaEstaban += 1;
      continue;
    }

    // 2. Proyección normalizada.
    await destino
      .insert(leads)
      .values({
        eventId: event.id,
        leadId: lead.leadId,
        formName: lead.formName,
        campaignName: lead.campaignName,
        platform: lead.platform,
        isOrganic: lead.isOrganic,
        fullName: lead.fullName,
        email: lead.email,
        phone: lead.phone,
        country: lead.country,
        customFields: lead.customFields,
        createdTime: lead.createdTime,
      })
      .onConflictDoNothing({ target: leads.leadId });

    insertados += 1;
  }

  return { leidos: filas.length, insertados, yaEstaban, descartados };
}
