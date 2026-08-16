import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";

export const structureRouter = Router();

const VALID_PRESETS = new Set(["today", "last_7d", "last_30d", "this_month", "last_month", "maximum"]);

/**
 * "results" / "cost_per_result" llegan como [{indicator, values:[{value}]}].
 * Meta ya decide cuál acción cuenta como "el resultado" según el objetivo de
 * cada campaña — no inventamos la fórmula, solo leemos el primer elemento.
 */
function indicatorValue(arr: unknown): [string | null, number | null] {
  if (!Array.isArray(arr) || arr.length === 0) return [null, null];
  const first: any = arr[0] ?? {};
  const raw = first.values?.[0]?.value;
  return [first.indicator ?? null, raw != null ? Number(raw) : null];
}

interface Row {
  spend: number;
  results: number | null;
  resultIndicator: string | null;
  costPerResult: number | null;
  impressions: number;
  clicks: number;
}

const emptyRow = (): Row => ({
  spend: 0,
  results: null,
  resultIndicator: null,
  costPerResult: null,
  impressions: 0,
  clicks: 0,
});

function rowFrom(r: any): Row {
  const [indicator, results] = indicatorValue(r.results);
  const [, cpr] = indicatorValue(r.cost_per_result);
  return {
    spend: Number(r.spend ?? 0),
    results,
    resultIndicator: indicator,
    costPerResult: cpr,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.inline_link_clicks ?? 0),
  };
}

/**
 * GET /api/structure/:campaignId?datePreset=last_30d
 *
 * Devuelve las TRES ETAPAS anidadas, con la plata en cada nivel:
 *   Campaña → Conjuntos → Anuncios
 *
 * Son solo 2 llamadas a Meta (no una por nivel): una trae la estructura con
 * expansión de campos anidados, otra trae los insights a nivel anuncio y los
 * agregamos hacia arriba. Importa porque la cuenta tiene un rate limit ajustado.
 */
structureRouter.get(
  "/:campaignId",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
      return;
    }

    const { campaignId } = req.params;
    const datePreset = VALID_PRESETS.has(String(req.query.datePreset))
      ? String(req.query.datePreset)
      : "last_30d";

    const client = new MetaGraphClient(token);

    try {
      // 1. La estructura, en una sola llamada con campos anidados.
      const estructura = await client.get(campaignId, {
        fields: [
          "name,status,objective,daily_budget,lifetime_budget",
          "adsets.limit(50){name,status,optimization_goal,daily_budget,targeting,ads.limit(50){name,status,creative{thumbnail_url}}}",
        ].join(","),
      });

      // 2. Los insights a nivel ANUNCIO. Desde aquí se agrega hacia arriba:
      //    el gasto de un conjunto es la suma de sus anuncios.
      const insights = await client.getAll(`${campaignId}/insights`, {
        level: "ad",
        date_preset: datePreset,
        fields: "ad_id,adset_id,spend,impressions,inline_link_clicks,results,cost_per_result",
        limit: "200",
      });

      const porAnuncio = new Map<string, Row>();
      for (const r of insights) porAnuncio.set(r.ad_id, rowFrom(r));

      const adsets = (estructura.adsets?.data ?? []).map((as: any) => {
        const ads = (as.ads?.data ?? []).map((ad: any) => {
          const m = porAnuncio.get(ad.id) ?? emptyRow();
          return {
            id: ad.id,
            name: ad.name,
            status: ad.status,
            thumbnail: ad.creative?.thumbnail_url ?? null,
            ...m,
          };
        });

        // Agregación del conjunto = suma de sus anuncios.
        const spend = ads.reduce((s: number, a: any) => s + a.spend, 0);
        const results = ads.reduce((s: number, a: any) => s + (a.results ?? 0), 0);
        const t = as.targeting ?? {};

        return {
          id: as.id,
          name: as.name,
          status: as.status,
          optimizationGoal: as.optimization_goal,
          // Lo que hace entendible el conjunto de un vistazo: a quién le llega.
          countries: t.geo_locations?.countries ?? [],
          ageMin: t.age_min ?? null,
          ageMax: t.age_max ?? null,
          includedAudiences: (t.custom_audiences ?? []).map((a: any) => a.name),
          excludedAudiences: (t.excluded_custom_audiences ?? []).map((a: any) => a.name),
          spend,
          results: results || null,
          resultIndicator: ads.find((a: any) => a.resultIndicator)?.resultIndicator ?? null,
          costPerResult: results > 0 ? spend / results : null,
          ads: ads.sort((a: any, b: any) => b.spend - a.spend),
        };
      });

      const spendTotal = adsets.reduce((s: number, a: any) => s + a.spend, 0);
      const resultsTotal = adsets.reduce((s: number, a: any) => s + (a.results ?? 0), 0);

      res.json({
        campaign: {
          id: campaignId,
          name: estructura.name,
          status: estructura.status,
          objective: estructura.objective,
          dailyBudget: estructura.daily_budget ? Number(estructura.daily_budget) / 100 : null,
          spend: spendTotal,
          results: resultsTotal || null,
          costPerResult: resultsTotal > 0 ? spendTotal / resultsTotal : null,
        },
        adsets: adsets.sort((a: any, b: any) => b.spend - a.spend),
        datePreset,
      });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        res.status(err.httpCode ?? 502).json({
          type: "api_error",
          message: err.message,
          titulo: err.userTitle,
          errorCode: err.errorCode,
        });
        return;
      }
      console.error(`la estructura de la campaña ${campaignId} no se pudo armar — ${porQueFallo(err)}`);
      res.status(500).json({ type: "api_error", message: "No se pudo completar la operación." });
    }
  }),
);
