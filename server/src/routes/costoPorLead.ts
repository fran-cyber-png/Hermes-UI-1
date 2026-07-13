import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { MetaGraphClient } from "../meta/metaClient.js";
import { aUsd, tasasDeCambio } from "../analisis/tasas.js";
import { diasDe, type Rango } from "../lib/rangos.js";

/**
 * El costo REAL por lead: cruza los leads que capturamos con lo que Meta dice
 * que costó traerlos.
 *
 * Es distinto del "costo por resultado" que muestra Meta. Meta cuenta como
 * "resultado" lo que optimiza (que puede incluir conversiones de landing, no
 * solo formularios). Aquí contamos personas reales, con nombre y teléfono, que
 * están en nuestra base. Es la única cifra que se puede contrastar contra
 * ventas después.
 *
 * ── TODO EN DÓLARES. Y no es un detalle de formato ──
 * Esto tomaba `spend` crudo de Meta y lo sumaba entre campañas de CUENTAS DISTINTAS. Goberna tiene
 * cuentas en USD, en COP y en BOB: la pantalla imprimía «$» sobre una suma de soles con dólares, y
 * ordenaba el ranking de "el anuncio más barato" con esa mezcla.
 *
 * El daño no es cosmético: un peso colombiano vale ~1/4.100 de dólar. Una campaña colombiana con un
 * costo por lead PÉSIMO aparecía como la más barata del ranking por puro tipo de cambio, y la frase
 * «este anuncio trae leads 3,5× más baratos» podía ser, literalmente, la tasa de conversión de la
 * moneda. Alguien mueve presupuesto real detrás de eso.
 */
export interface CostoPorLead {
  campaignId: string;
  campaignName: string;
  leads: number;
  /** SIEMPRE en USD. `null` cuando la moneda de la cuenta no tiene tasa: no medible ≠ gratis. */
  gasto: number | null;
  /** SIEMPRE en USD. `null` si no hay gasto convertible o no hay leads. */
  costoPorLead: number | null;
  adName: string | null;
}

export async function costoPorLead(
  token: string,
  rango: Rango = "todo",
): Promise<{
  porCampana: CostoPorLead[];
  porAnuncio: CostoPorLead[];
  totales: { leads: number; gasto: number; costoPorLead: number | null } | null;
  /** Campañas cuya moneda no tiene tasa: quedaron fuera de los totales, y se dice. */
  sinTasa: number;
}> {
  // El rango se aplica a los LEADS, y el gasto lo sigue solo: como la ventana
  // que se le pide a Meta se calcula desde el primer y último lead (abajo),
  // filtrar aquí achica también la ventana de gasto. Un solo filtro, y las dos
  // mitades de la división quedan hablando del mismo período.
  const dias = diasDe(rango);
  const desdeRango =
    dias === null ? sql`` : sql`AND created_time > now() - (${String(dias)} || ' days')::interval`;

  // 1. Cuántos leads trajo cada campaña/anuncio, y en qué ventana de fechas.
  const filas = await db.execute<{
    campaign_id: string;
    campaign_name: string;
    ad_name: string;
    leads: number;
    desde: string;
    hasta: string;
  }>(sql`
    SELECT
      campaign_id,
      campaign_name,
      ad_name,
      count(*)::int              AS leads,
      min(created_time)::date::text AS desde,
      max(created_time)::date::text AS hasta
    FROM leads
    WHERE campaign_id IS NOT NULL
    ${desdeRango}
    GROUP BY 1, 2, 3
  `);

  if (filas.length === 0) return { porCampana: [], porAnuncio: [], totales: null, sinTasa: 0 };

  const client = new MetaGraphClient(token);
  const tasas = await tasasDeCambio();
  const campaignIds = [...new Set(filas.map((f) => f.campaign_id))];

  // 2. El gasto real de Meta, a nivel anuncio, en la ventana en que llegaron
  //    los leads. Usar la ventana exacta importa: pedir un rango más ancho
  //    inflaría el costo por lead con gasto que no generó esos leads.
  //
  //    Y se pide `account_currency`: sin ella no se sabe si ese "1.500" son dólares o son pesos
  //    colombianos, que valen 4.100 veces menos. Todo lo que sale de acá ya está en USD.
  const gastoPorAnuncio = new Map<string, number | null>();
  const gastoPorCampana = new Map<string, number | null>();

  for (const campaignId of campaignIds) {
    const deLaCampana = filas.filter((f) => f.campaign_id === campaignId);
    const desde = deLaCampana.map((f) => f.desde).sort()[0];
    const hasta = deLaCampana.map((f) => f.hasta).sort().reverse()[0];

    try {
      const insights = await client.getAll(`${campaignId}/insights`, {
        level: "ad",
        time_range: JSON.stringify({ since: desde, until: hasta }),
        fields: "ad_name,spend,account_currency",
        limit: "200",
      });

      let totalCampana: number | null = 0;
      for (const r of insights) {
        const usd = aUsd(Number(r.spend ?? 0), String(r.account_currency ?? "USD"), tasas);
        const key = `${campaignId}:${r.ad_name}`;
        if (usd == null) {
          // Sin tasa NO se falsea con un cero: un cero se ve como "gratis" y encabeza el ranking
          // de lo más barato. Se marca como no medible y queda fuera de todo total.
          gastoPorAnuncio.set(key, null);
          totalCampana = null;
          continue;
        }
        const prev = gastoPorAnuncio.get(key);
        if (prev !== null) gastoPorAnuncio.set(key, (prev ?? 0) + usd);
        if (totalCampana !== null) totalCampana += usd;
      }
      gastoPorCampana.set(campaignId, totalCampana);
    } catch {
      // Si Meta no responde (rate limit), esa campaña queda sin costo — mejor
      // omitirla que mostrar un número inventado.
    }
  }

  const porAnuncio: CostoPorLead[] = filas
    .map((f) => {
      const gasto = gastoPorAnuncio.get(`${f.campaign_id}:${f.ad_name}`) ?? null;
      return {
        campaignId: f.campaign_id,
        campaignName: f.campaign_name,
        adName: f.ad_name,
        leads: f.leads,
        gasto,
        costoPorLead: gasto != null && f.leads > 0 ? gasto / f.leads : null,
      };
    })
    .filter((x) => (x.gasto ?? 0) > 0)
    .sort((a, b) => (a.costoPorLead ?? Infinity) - (b.costoPorLead ?? Infinity));

  const agrupadoPorCampana = new Map<string, CostoPorLead>();
  for (const f of filas) {
    const prev = agrupadoPorCampana.get(f.campaign_id);
    agrupadoPorCampana.set(f.campaign_id, {
      campaignId: f.campaign_id,
      campaignName: f.campaign_name,
      adName: null,
      leads: (prev?.leads ?? 0) + f.leads,
      gasto: gastoPorCampana.get(f.campaign_id) ?? null,
      costoPorLead: null,
    });
  }
  const todasLasCampanas = [...agrupadoPorCampana.values()].map((c) => ({
    ...c,
    costoPorLead: c.gasto != null && c.leads > 0 ? c.gasto / c.leads : null,
  }));

  // Las campañas cuya moneda no tiene tasa se cuentan y se reportan; no se suman ni se esconden.
  const sinTasa = todasLasCampanas.filter((c) => c.gasto == null).length;
  const porCampana = todasLasCampanas
    .filter((c) => (c.gasto ?? 0) > 0)
    .sort((a, b) => (a.costoPorLead ?? Infinity) - (b.costoPorLead ?? Infinity));

  const leadsTot = porCampana.reduce((s, c) => s + c.leads, 0);
  const gastoTot = porCampana.reduce((s, c) => s + (c.gasto ?? 0), 0);

  return {
    porCampana,
    porAnuncio,
    totales:
      leadsTot > 0
        ? { leads: leadsTot, gasto: gastoTot, costoPorLead: gastoTot > 0 ? gastoTot / leadsTot : null }
        : null,
    sinTasa,
  };
}
