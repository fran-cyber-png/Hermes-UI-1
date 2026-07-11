import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { events, leads } from "../db/schema.js";
import { MetaGraphClient } from "./metaClient.js";

export const LEAD_SOURCE = "meta_lead_ad";

// Campos que Meta devuelve por lead. Trae la cadena de atribución completa
// (ad → adset → campaign), así que `Persona → Anuncio → Campaña` sale gratis.
const LEAD_FIELDS =
  "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform";

interface FieldDatum {
  name: string;
  values: string[];
}

/**
 * Los nombres de campo los define quien arma el formulario en Meta — no hay un
 * set fijo garantizado. Estos son los estándar que Meta ofrece por defecto; el
 * resto (ej. "¿cuál_es_tu_cargo?") se preserva entero en customFields en vez de
 * descartarse.
 */
const KNOWN_FIELDS: Record<string, "fullName" | "email" | "phone" | "country"> = {
  full_name: "fullName",
  first_name: "fullName",
  email: "email",
  phone_number: "phone",
  country: "country",
};

export function normalizeFieldData(fieldData: FieldDatum[] = []) {
  const known: { fullName?: string; email?: string; phone?: string; country?: string } = {};
  const custom: Record<string, string> = {};

  for (const field of fieldData) {
    const value = field.values?.[0];
    if (value === undefined) continue;
    const target = KNOWN_FIELDS[field.name];
    if (target) known[target] = value;
    else custom[field.name] = value;
  }

  return { ...known, customFields: custom };
}

export interface IngestSummary {
  formId: string;
  formName: string;
  fetched: number;
  inserted: number;
  alreadyKnown: number;
}

/**
 * Trae todos los leads de un formulario y los persiste de forma idempotente.
 *
 * Escribe primero el evento crudo (fuente de verdad) y recién después proyecta
 * el lead normalizado. El ON CONFLICT DO NOTHING sobre (source, external_id) es
 * lo que hace que correr esto mil veces nunca duplique ni pierda un lead — se
 * puede re-ejecutar sin miedo.
 */
export async function ingestFormLeads(
  client: MetaGraphClient,
  pageAccessToken: string,
  pageId: string,
  form: { id: string; name: string },
): Promise<IngestSummary> {
  const pageClient = new MetaGraphClient(pageAccessToken);
  const rows = await pageClient.getAll(`${form.id}/leads`, { fields: LEAD_FIELDS, limit: "100" });

  let inserted = 0;

  for (const raw of rows) {
    const occurredAt = new Date(raw.created_time);

    // 1. Evento crudo — la fuente de verdad. Si ya existía, no se toca.
    const [event] = await db
      .insert(events)
      .values({
        source: LEAD_SOURCE,
        externalId: raw.id,
        occurredAt,
        payload: raw,
      })
      .onConflictDoNothing({ target: [events.source, events.externalId] })
      .returning({ id: events.id });

    // Sin fila devuelta = el evento ya estaba ingerido. Nada que hacer.
    if (!event) continue;

    // 2. Proyección normalizada.
    const person = normalizeFieldData(raw.field_data);
    await db
      .insert(leads)
      .values({
        eventId: event.id,
        leadId: raw.id,
        pageId,
        formId: raw.form_id ?? form.id,
        formName: form.name,
        campaignId: raw.campaign_id ?? null,
        campaignName: raw.campaign_name ?? null,
        adsetId: raw.adset_id ?? null,
        adsetName: raw.adset_name ?? null,
        adId: raw.ad_id ?? null,
        adName: raw.ad_name ?? null,
        platform: raw.platform ?? null,
        isOrganic: raw.is_organic ?? null,
        fullName: person.fullName ?? null,
        email: person.email ?? null,
        phone: person.phone ?? null,
        country: person.country ?? null,
        customFields: person.customFields,
        createdTime: occurredAt,
      })
      .onConflictDoNothing({ target: leads.leadId });

    inserted += 1;
  }

  return {
    formId: form.id,
    formName: form.name,
    fetched: rows.length,
    inserted,
    alreadyKnown: rows.length - inserted,
  };
}

/** Recorre todas las Páginas alcanzables y sus formularios. */
export async function ingestAllLeads(token: string) {
  const client = new MetaGraphClient(token);
  const pages = await client.getAll("me/accounts", { fields: "id,name,access_token", limit: "100" });

  const summaries: (IngestSummary & { pageName: string })[] = [];
  const errors: { pageName: string; message: string }[] = [];

  for (const page of pages) {
    const pageClient = new MetaGraphClient(page.access_token);
    let forms: any[];
    try {
      forms = await pageClient.getAll(`${page.id}/leadgen_forms`, { fields: "id,name", limit: "100" });
    } catch (err) {
      // Páginas compartidas por un partner sin permiso de Leads caen aquí.
      // No frenan la corrida: se reporta y se sigue con las demás.
      errors.push({ pageName: page.name, message: (err as Error).message });
      continue;
    }

    for (const form of forms) {
      const summary = await ingestFormLeads(client, page.access_token, page.id, form);
      if (summary.fetched > 0) summaries.push({ ...summary, pageName: page.name });
    }
  }

  return { summaries, errors };
}

/** Cuánto se enfrió el dato: mediana/máximo del lag entre que pasó y que lo capturamos. */
export async function leadColdnessStats() {
  const [row] = await db.execute<{
    total: number;
    sin_atender: number;
    lead_mas_viejo: string | null;
    dias_promedio_frio: number | null;
  }>(sql`
    SELECT
      count(*)::int                                                        AS total,
      count(*) FILTER (WHERE status = 'nuevo')::int                        AS sin_atender,
      min(created_time)::text                                              AS lead_mas_viejo,
      round(avg(extract(epoch FROM (now() - created_time)) / 86400))::int  AS dias_promedio_frio
    FROM leads
  `);
  return row;
}
