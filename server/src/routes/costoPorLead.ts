import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { MetaGraphClient } from "../meta/metaClient.js";

/**
 * El costo REAL por lead: cruza los leads que capturamos con lo que Meta dice
 * que costó traerlos.
 *
 * Es distinto del "costo por resultado" que muestra Meta. Meta cuenta como
 * "resultado" lo que optimiza (que puede incluir conversiones de landing, no
 * solo formularios). Aquí contamos personas reales, con nombre y teléfono, que
 * están en nuestra base. Es la única cifra que se puede contrastar contra
 * ventas después.
 */
export interface CostoPorLead {
  campaignId: string;
  campaignName: string;
  leads: number;
  gasto: number;
  costoPorLead: number;
  adName: string | null;
}

export async function costoPorLead(token: string): Promise<{
  porCampana: CostoPorLead[];
  porAnuncio: CostoPorLead[];
  totales: { leads: number; gasto: number; costoPorLead: number } | null;
}> {
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
    GROUP BY 1, 2, 3
  `);

  if (filas.length === 0) return { porCampana: [], porAnuncio: [], totales: null };

  const client = new MetaGraphClient(token);
  const campaignIds = [...new Set(filas.map((f) => f.campaign_id))];

  // 2. El gasto real de Meta, a nivel anuncio, en la ventana en que llegaron
  //    los leads. Usar la ventana exacta importa: pedir un rango más ancho
  //    inflaría el costo por lead con gasto que no generó esos leads.
  const gastoPorAnuncio = new Map<string, number>();
  const gastoPorCampana = new Map<string, number>();

  for (const campaignId of campaignIds) {
    const deLaCampana = filas.filter((f) => f.campaign_id === campaignId);
    const desde = deLaCampana.map((f) => f.desde).sort()[0];
    const hasta = deLaCampana.map((f) => f.hasta).sort().reverse()[0];

    try {
      const insights = await client.getAll(`${campaignId}/insights`, {
        level: "ad",
        time_range: JSON.stringify({ since: desde, until: hasta }),
        fields: "ad_name,spend",
        limit: "200",
      });

      let totalCampana = 0;
      for (const r of insights) {
        const spend = Number(r.spend ?? 0);
        totalCampana += spend;
        const key = `${campaignId}:${r.ad_name}`;
        gastoPorAnuncio.set(key, (gastoPorAnuncio.get(key) ?? 0) + spend);
      }
      gastoPorCampana.set(campaignId, totalCampana);
    } catch {
      // Si Meta no responde (rate limit), esa campaña queda sin costo — mejor
      // omitirla que mostrar un número inventado.
    }
  }

  const porAnuncio: CostoPorLead[] = filas
    .map((f) => {
      const gasto = gastoPorAnuncio.get(`${f.campaign_id}:${f.ad_name}`) ?? 0;
      return {
        campaignId: f.campaign_id,
        campaignName: f.campaign_name,
        adName: f.ad_name,
        leads: f.leads,
        gasto,
        costoPorLead: f.leads > 0 ? gasto / f.leads : 0,
      };
    })
    .filter((x) => x.gasto > 0)
    .sort((a, b) => a.costoPorLead - b.costoPorLead);

  const agrupadoPorCampana = new Map<string, CostoPorLead>();
  for (const f of filas) {
    const prev = agrupadoPorCampana.get(f.campaign_id);
    agrupadoPorCampana.set(f.campaign_id, {
      campaignId: f.campaign_id,
      campaignName: f.campaign_name,
      adName: null,
      leads: (prev?.leads ?? 0) + f.leads,
      gasto: gastoPorCampana.get(f.campaign_id) ?? 0,
      costoPorLead: 0,
    });
  }
  const porCampana = [...agrupadoPorCampana.values()]
    .map((c) => ({ ...c, costoPorLead: c.leads > 0 ? c.gasto / c.leads : 0 }))
    .filter((c) => c.gasto > 0)
    .sort((a, b) => a.costoPorLead - b.costoPorLead);

  const leadsTot = porCampana.reduce((s, c) => s + c.leads, 0);
  const gastoTot = porCampana.reduce((s, c) => s + c.gasto, 0);

  return {
    porCampana,
    porAnuncio,
    totales:
      leadsTot > 0 ? { leads: leadsTot, gasto: gastoTot, costoPorLead: gastoTot / leadsTot } : null,
  };
}
