import type { CampaignInput } from "../decisions/detectors.js";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { indicatorValue } from "../lib/indicator.js";

/**
 * Recolecta el estado de la pauta desde Meta. Corre en un JOB, nunca en el camino de una pantalla.
 *
 * ── El problema que resuelve ──
 * La versión anterior pedía, POR CADA CAMPAÑA, su estructura y sus insights:
 *
 *     2 llamadas por cuenta  +  2 llamadas × 409 campañas  =  866 llamadas, secuenciales
 *     ≈ 2 a 4 minutos, y candidato seguro a rate limit
 *
 * Pero Meta deja pedir conjuntos, anuncios e insights **a nivel de cuenta**, todos de una. Así:
 *
 *     5 llamadas por cuenta, sin importar cuántas campañas tenga  ≈ 120 llamadas
 *     y en paralelo (con concurrencia acotada, para no gatillar el rate limit)
 *
 * De paso arregla un bug de correctitud: `adsets.limit(25){ads.limit(25)}` truncaba en silencio
 * toda campaña con más de 25 conjuntos. Acá se pagina hasta el final.
 */

/** Cuántas cuentas se piden a la vez. Más rápido no es mejor si Meta te corta el acceso. */
const CUENTAS_EN_PARALELO = 4;

export type ResultadoRecoleccion = {
  campanas: CampaignInput[];
  errores: { accountId: string; message: string }[];
  llamadas: number;
  duracionMs: number;
};

type Ventana = Record<string, string>;

/** Todo lo que hace falta de UNA cuenta, en 5 llamadas (más las páginas que hagan falta). */
async function recolectarCuenta(
  client: MetaGraphClient,
  accountId: string,
  ventana: Ventana,
  contar: () => void,
): Promise<CampaignInput[]> {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;

  contar();
  const cuenta = await client.get(actId, { fields: "name,currency" });

  // Las cuatro colecciones, en paralelo. Ninguna depende de la otra: se cruzan en memoria.
  const [campanas, conjuntos, anuncios, insights] = await Promise.all([
    // Solo activas: sobre una campaña pausada no hay nada que decidir.
    (contar(),
    client.getAll(`${actId}/campaigns`, {
      fields: "id,name,status",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: "200",
    })),
    (contar(),
    client.getAll(`${actId}/adsets`, {
      fields: "id,name,status,campaign_id,targeting{custom_audiences,excluded_custom_audiences}",
      limit: "200",
    })),
    (contar(),
    client.getAll(`${actId}/ads`, {
      // Sin expandir el creativo acá: expandirlo inline para TODOS los anuncios (la mayoría sin
      // gasto) hace el llamado lentísimo —60s para una cuenta—. El creativo se trae después, solo
      // para los anuncios que gastaron, en lote (ver `adjuntarCreativos`).
      fields: "id,name,status,adset_id",
      limit: "500",
    })),
    (contar(),
    client.getAll(`${actId}/insights`, {
      level: "ad",
      ...ventana,
      fields: "ad_id,spend,results,cost_per_result",
      limit: "500",
    })),
  ]);

  // ── El armado, en memoria. Cero llamadas más. ──
  const metricaPorAd = new Map<string, { spend: number; results: number | null; costPerResult: number | null }>(
    insights.map((r: any) => [
      r.ad_id,
      {
        spend: Number(r.spend ?? 0),
        results: indicatorValue(r.results),
        costPerResult: indicatorValue(r.cost_per_result),
      },
    ]),
  );

  const adsPorConjunto = new Map<string, any[]>();
  for (const ad of anuncios) {
    if (!ad.adset_id) continue;
    const m = metricaPorAd.get(ad.id) ?? { spend: 0, results: null, costPerResult: null };
    const c = ad.creative ?? null;
    const lista = adsPorConjunto.get(ad.adset_id) ?? [];
    lista.push({
      id: ad.id,
      name: ad.name,
      status: ad.status,
      ...m,
      // El creativo, aplanado a lo que la pantalla necesita. Si Meta no lo devolvió, queda null.
      creative: c
        ? {
            thumbnailUrl: c.thumbnail_url ?? null,
            body: c.body ?? null,
            title: c.title ?? null,
            objectType: c.object_type ?? null,
            storyId: c.effective_object_story_id ?? null,
          }
        : null,
    });
    adsPorConjunto.set(ad.adset_id, lista);
  }

  const conjuntosPorCampana = new Map<string, any[]>();
  for (const cj of conjuntos) {
    if (!cj.campaign_id) continue;
    const ads = adsPorConjunto.get(cj.id) ?? [];
    const spend = ads.reduce((s, a) => s + a.spend, 0);
    const results = ads.reduce((s, a) => s + (a.results ?? 0), 0);
    const t = cj.targeting ?? {};

    const lista = conjuntosPorCampana.get(cj.campaign_id) ?? [];
    lista.push({
      id: cj.id,
      name: cj.name,
      status: cj.status,
      spend,
      results: results || null,
      costPerResult: results > 0 ? spend / results : null,
      includedAudiences: (t.custom_audiences ?? []).map((x: any) => x.name),
      excludedAudiences: (t.excluded_custom_audiences ?? []).map((x: any) => x.name),
      ads,
    });
    conjuntosPorCampana.set(cj.campaign_id, lista);
  }

  return campanas.map((camp: any) => {
    const adsets = conjuntosPorCampana.get(camp.id) ?? [];
    const spend = adsets.reduce((s, a) => s + a.spend, 0);
    const results = adsets.reduce((s, a) => s + (a.results ?? 0), 0);
    return {
      id: camp.id,
      name: camp.name,
      status: camp.status,
      spend,
      results: results || null,
      costPerResult: results > 0 ? spend / results : null,
      accountId,
      accountName: cuenta.name,
      currency: cuenta.currency,
      adsets,
    };
  });
}

/** Recolecta todas las cuentas, de a tandas, para no gatillar el rate limit de Meta. */
export async function recolectarPauta(
  token: string,
  accountIds: string[],
  ventana: Ventana,
): Promise<ResultadoRecoleccion> {
  const arranque = Date.now();
  const client = new MetaGraphClient(token);
  const campanas: CampaignInput[] = [];
  const errores: { accountId: string; message: string }[] = [];
  let llamadas = 0;
  const contar = () => {
    llamadas += 1;
  };

  for (let i = 0; i < accountIds.length; i += CUENTAS_EN_PARALELO) {
    const tanda = accountIds.slice(i, i + CUENTAS_EN_PARALELO);
    const resultados = await Promise.all(
      tanda.map(async (accountId) => {
        try {
          return { accountId, campanas: await recolectarCuenta(client, accountId, ventana, contar) };
        } catch (err) {
          // Una cuenta que falla (los `fetch failed` de Bolivia y Ecuador) NO tumba la corrida.
          // Pero tampoco desaparece: queda registrada y visible, en vez de perderse en un log.
          const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
          return { accountId, campanas: [] as CampaignInput[], error: message };
        }
      }),
    );

    for (const r of resultados) {
      campanas.push(...r.campanas);
      if ("error" in r && r.error) errores.push({ accountId: r.accountId, message: r.error });
    }
  }

  return { campanas, errores, llamadas, duracionMs: Date.now() - arranque };
}
