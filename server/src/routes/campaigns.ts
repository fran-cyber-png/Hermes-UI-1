import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";

export const campaignsRouter = Router();

export const CAMPAIGN_OBJECTIVES = [
  { value: "OUTCOME_LEADS", label: "Clientes potenciales" },
  { value: "OUTCOME_SALES", label: "Ventas" },
  { value: "OUTCOME_TRAFFIC", label: "Tráfico" },
  { value: "OUTCOME_ENGAGEMENT", label: "Interacción" },
  { value: "OUTCOME_AWARENESS", label: "Reconocimiento" },
] as const;

// Real Graph API special_ad_categories values. ISSUES_ELECTIONS_POLITICS
// matters a lot here — Goberna runs political-consulting campaigns, and Meta
// requires this flag (plus separate ad-authorization on the Page/account) for
// those; miscategorizing gets campaigns rejected or restricted.
export const SPECIAL_AD_CATEGORIES = [
  { value: "ISSUES_ELECTIONS_POLITICS", label: "Temas sociales, elecciones o política" },
  { value: "HOUSING", label: "Vivienda" },
  { value: "EMPLOYMENT", label: "Empleo" },
  { value: "CREDIT", label: "Crédito" },
] as const;

campaignsRouter.get("/objectives", (_req, res) => {
  res.json({ objectives: CAMPAIGN_OBJECTIVES, specialAdCategories: SPECIAL_AD_CATEGORIES });
});

// Live ad-account list from Meta (mirrors goberna-dashboard's
// _call_graph_me_adaccounts) — no local account cache yet, so this always
// hits the Graph API directly. Only active accounts (account_status === 1)
// are returned, matching ads_crear_campana's filter.
campaignsRouter.get(
  "/ad-accounts",
  ruta(async (_req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado en el servidor." });
      return;
    }

    const client = new MetaGraphClient(token);
    try {
      const accounts = await client.getAll("me/adaccounts", {
        fields: "id,name,account_status,currency",
        limit: "100",
      });
      // Each account is effectively a country/portfolio (e.g. "Goberna Perú",
      // "CONSULTORÍA GOBERNA") — sort alphabetically so 19+ accounts are
      // scannable instead of arriving in whatever order the Graph API returns.
      const active = accounts
        .filter((a) => a.account_status === 1)
        .map((a) => ({ accountId: String(a.id).replace(/^act_/, ""), name: a.name, currency: a.currency }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ accounts: active });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        res.status(err.httpCode ?? 502).json({ type: "api_error", message: err.message, errorCode: err.errorCode });
        return;
      }
      console.error(`GET /api/campaigns/ad-accounts falló — ${porQueFallo(err)}`);
      res.status(500).json({ type: "api_error", message: "No se pudo completar la operación." });
    }
  }),
);

// GET /api/campaigns?accountIds=123,456 — list existing campaigns for the
// chosen accounts, straight from the Graph API (no local cache). Partial
// failures (e.g. one account lacking permission) don't block the rest.
campaignsRouter.get(
  "/",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado en el servidor." });
      return;
    }

    const raw = req.query.accountIds;
    const ids = (typeof raw === "string" ? raw.split(",") : []).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      res.json({ campaigns: [], errors: [] });
      return;
    }

    const client = new MetaGraphClient(token);
    const settled = await Promise.all(
      ids.map(async (accountId) => {
        const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        try {
          const rows = await client.getAll(`${actId}/campaigns`, {
            fields: "id,name,status,objective,created_time",
            limit: "100",
          });
          return {
            accountId,
            campaigns: rows.map((r) => ({
              accountId,
              id: r.id,
              name: r.name,
              status: r.status,
              objective: r.objective,
              createdTime: r.created_time,
            })),
          };
        } catch (err) {
          // El mensaje de Meta sí sale (es lo que explica «esta cuenta no te deja
          // verla»); cualquier otro error se loguea y afuera va un texto genérico.
          if (err instanceof MetaGraphError) {
            return { accountId, campaigns: [], error: err.message };
          }
          console.error(`GET /api/campaigns (${actId}) falló — ${porQueFallo(err)}`);
          return { accountId, campaigns: [], error: "No se pudo completar la operación." };
        }
      }),
    );

    const campaigns = settled.flatMap((s) => s.campaigns);
    const errors = settled
      .filter((s): s is { accountId: string; campaigns: never[]; error: string } => Boolean(s.error))
      .map((s) => ({ accountId: s.accountId, message: s.error }));

    campaigns.sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1));
    res.json({ campaigns, errors });
  }),
);

const VALID_DATE_PRESETS = new Set(["today", "last_7d", "last_30d", "this_month", "last_month"]);

// GET /api/campaigns/insights?accountIds=a,b&datePreset=last_30d — per-campaign
// spend/results for the chosen window, straight from the insights edge (same
// fields goberna-dashboard's sync_meta_ads uses). "results"/"cost_per_result"
// come back as [{indicator, values:[{value}]}] — Meta already resolves which
// action_type counts as "the result" based on each campaign's own objective,
// so we don't invent a formula here, just pass the first element through.
campaignsRouter.get(
  "/insights",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado en el servidor." });
      return;
    }

    const raw = req.query.accountIds;
    const ids = (typeof raw === "string" ? raw.split(",") : []).map((s) => s.trim()).filter(Boolean);
    const datePreset = VALID_DATE_PRESETS.has(String(req.query.datePreset)) ? String(req.query.datePreset) : "last_30d";

    if (ids.length === 0) {
      res.json({ insights: [], errors: [] });
      return;
    }

    const client = new MetaGraphClient(token);
    const settled = await Promise.all(
      ids.map(async (accountId) => {
        const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
        try {
          const rows = await client.getAll(`${actId}/insights`, {
            level: "campaign",
            date_preset: datePreset,
            fields: "campaign_id,spend,impressions,reach,inline_link_clicks,results,cost_per_result,objective",
            limit: "200",
          });
          return {
            accountId,
            insights: rows.map((r) => {
              const [resultIndicator, resultValueRaw] = extractIndicatorValue(r.results);
              const [, costPerResultRaw] = extractIndicatorValue(r.cost_per_result);
              return {
                accountId,
                campaignId: r.campaign_id,
                spend: r.spend ?? "0",
                impressions: r.impressions ?? "0",
                reach: r.reach ?? "0",
                linkClicks: r.inline_link_clicks ?? "0",
                objective: r.objective,
                resultIndicator,
                resultCount: resultValueRaw,
                costPerResult: costPerResultRaw,
              };
            }),
          };
        } catch (err) {
          // Igual que en la lista: el mensaje de Meta explica el fallo de ESA
          // cuenta y sale; cualquier otro se loguea y afuera va lo genérico.
          if (err instanceof MetaGraphError) {
            return { accountId, insights: [], error: err.message };
          }
          console.error(`GET /api/campaigns/insights (${actId}) falló — ${porQueFallo(err)}`);
          return { accountId, insights: [], error: "No se pudo completar la operación." };
        }
      }),
    );

    const insights = settled.flatMap((s) => s.insights);
    const errors = settled
      .filter((s): s is { accountId: string; insights: never[]; error: string } => Boolean(s.error))
      .map((s) => ({ accountId: s.accountId, message: s.error }));

    res.json({ insights, errors, datePreset });
  }),
);

// "results" / "cost_per_result" arrive as [{indicator, values:[{value}]}] —
// first element wins (mirrors goberna-dashboard's _extract_indicator_value).
function extractIndicatorValue(arr: unknown): [string | null, string | null] {
  if (!Array.isArray(arr) || arr.length === 0) return [null, null];
  const first = arr[0] ?? {};
  const indicator = first.indicator ?? null;
  const values = first.values ?? [];
  const value = Array.isArray(values) && values[0] ? values[0].value ?? null : null;
  return [indicator, value];
}

interface AccountResult {
  accountId: string;
  type: "success" | "api_error";
  campaignId?: string;
  adsManagerUrl?: string;
  message?: string;
  errorCode?: number;
}

async function createOneCampaign(
  client: MetaGraphClient,
  accountId: string,
  apiParams: Record<string, string>,
): Promise<AccountResult> {
  const actId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
  try {
    const data = await client.post(`${actId}/campaigns`, apiParams);
    const campaignId = data.id ?? "";
    return {
      accountId,
      type: "success",
      campaignId,
      adsManagerUrl: `https://adsmanager.facebook.com/manage/campaigns?act=${accountId}&selected_campaign_ids=${campaignId}`,
    };
  } catch (err) {
    if (err instanceof MetaGraphError) {
      return { accountId, type: "api_error", message: err.message, errorCode: err.errorCode };
    }
    console.error(`POST /api/campaigns (${actId}) falló — ${porQueFallo(err)}`);
    return { accountId, type: "api_error", message: "No se pudo completar la operación." };
  }
}

campaignsRouter.post(
  "/",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado en el servidor." });
      return;
    }

    const { accountIds, name, objective, dailyBudget, specialAdCategories } = req.body ?? {};
    const ids: string[] = Array.isArray(accountIds) ? accountIds.filter(Boolean) : [];

    const errors: string[] = [];
    if (ids.length === 0) errors.push("Elige al menos una cuenta publicitaria.");
    if (!name) errors.push("El nombre de la campaña no puede estar vacío.");
    if (!objective) errors.push("Falta el objetivo de la campaña.");
    if (errors.length > 0) {
      res.status(400).json({ type: "validation_error", errors });
      return;
    }

    // Campaigns are created PAUSED by default — reviewing before launch is the
    // safe default (matches goberna-dashboard's ads_crear_campana behaviour).
    const apiParams: Record<string, string> = {
      name,
      objective,
      status: "PAUSED",
      special_ad_categories: JSON.stringify(Array.isArray(specialAdCategories) ? specialAdCategories : []),
      is_adset_budget_sharing_enabled: "false",
    };

    if (dailyBudget) {
      const parsed = Number(String(dailyBudget).replace(",", "."));
      if (!Number.isNaN(parsed) && parsed > 0) {
        // Graph API expects the budget in the account's minor currency unit
        // (cents) — same raw number applied to every selected account, each in
        // ITS OWN currency (no cross-currency conversion here).
        apiParams.daily_budget = String(Math.round(parsed * 100));
        // A campaign-level budget makes the adset-sharing flag irrelevant.
        delete apiParams.is_adset_budget_sharing_enabled;

        // Sin esto, Meta pone por default LOWEST_COST_WITH_BID_CAP, que exige un
        // bid_amount que nadie definió — y después falla la creación del conjunto
        // con un error que no menciona a la campaña. Las campañas reales de
        // Goberna usan LOWEST_COST_WITHOUT_CAP ("gastá el presupuesto lo mejor
        // que puedas, sin tope de puja"), así que ese es el default correcto.
        apiParams.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
      }
    }

    const client = new MetaGraphClient(token);
    const results = await Promise.all(ids.map((accountId) => createOneCampaign(client, accountId, apiParams)));

    res.json({ type: "bulk_result", campaignName: name, results });
  }),
);
