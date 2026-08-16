import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";

export const adsetsRouter = Router();

/**
 * Los 11 países que Goberna ya viene pauteando (leídos del adset real de la
 * campaña OSINT, la que trajo 530 leads). Se ofrecen como preset para no tener
 * que tildarlos de a uno cada vez.
 */
export const PAISES_GOBERNA = [
  { code: "PE", name: "Perú" },
  { code: "MX", name: "México" },
  { code: "CL", name: "Chile" },
  { code: "EC", name: "Ecuador" },
  { code: "BO", name: "Bolivia" },
  { code: "GT", name: "Guatemala" },
  { code: "DO", name: "Rep. Dominicana" },
  { code: "PA", name: "Panamá" },
  { code: "CR", name: "Costa Rica" },
  { code: "PY", name: "Paraguay" },
  { code: "US", name: "Estados Unidos" },
  { code: "CO", name: "Colombia" },
  { code: "AR", name: "Argentina" },
  { code: "HN", name: "Honduras" },
  { code: "SV", name: "El Salvador" },
] as const;

/**
 * Cómo le decimos a Meta qué queremos que optimice. Cada objetivo de campaña
 * admite un set distinto — mandar uno incompatible da un error críptico, así
 * que se acota aquí.
 */
export const OPTIMIZATION_GOALS: Record<string, { value: string; label: string; hint: string }[]> = {
  OUTCOME_LEADS: [
    {
      value: "LEAD_GENERATION",
      label: "Formulario instantáneo",
      hint: "La persona deja sus datos sin salir de Facebook/Instagram. Es lo que generó tus 680 leads.",
    },
    {
      value: "OFFSITE_CONVERSIONS",
      label: "Conversiones en el sitio",
      hint: "Optimiza usando el píxel de tu web. Necesita que el píxel esté midiendo el evento.",
    },
  ],
  OUTCOME_TRAFFIC: [
    { value: "LINK_CLICKS", label: "Clics en el enlace", hint: "Busca gente que hace clic." },
    { value: "LANDING_PAGE_VIEWS", label: "Vistas de la landing", hint: "Busca gente que además carga la página." },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: "POST_ENGAGEMENT", label: "Interacciones", hint: "Reacciones, comentarios, compartidos." },
    { value: "CONVERSATIONS", label: "Conversaciones", hint: "Mensajes iniciados (WhatsApp / Messenger)." },
  ],
  OUTCOME_AWARENESS: [
    { value: "REACH", label: "Alcance", hint: "Llegar a la mayor cantidad de personas distintas." },
    { value: "IMPRESSIONS", label: "Impresiones", hint: "Mostrar el anuncio la mayor cantidad de veces." },
  ],
  OUTCOME_SALES: [
    { value: "OFFSITE_CONVERSIONS", label: "Conversiones", hint: "Optimiza para compras usando el píxel." },
  ],
};

adsetsRouter.get("/options", (_req, res) => {
  res.json({ paises: PAISES_GOBERNA, optimizationGoals: OPTIMIZATION_GOALS });
});

adsetsRouter.post(
  "/",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
      return;
    }

    const {
      accountId,
      campaignId,
      name,
      optimizationGoal,
      pageId,
      pixelId,
      dailyBudget,
      countries,
      ageMin,
      ageMax,
      includeAudiences,
      excludeAudiences,
      advantageAudience,
    } = req.body ?? {};

    const errors: string[] = [];
    if (!accountId) errors.push("Falta la cuenta publicitaria.");
    if (!campaignId) errors.push("Falta la campaña.");
    if (!name) errors.push("El conjunto necesita un nombre.");
    if (!optimizationGoal) errors.push("Elige qué quieres que Meta optimice.");
    if (!Array.isArray(countries) || countries.length === 0) errors.push("Elige al menos un país.");
    if (optimizationGoal === "LEAD_GENERATION" && !pageId) {
      errors.push("Un formulario instantáneo necesita la Página que lo publica.");
    }
    if (optimizationGoal === "OFFSITE_CONVERSIONS" && !pixelId) {
      errors.push("Optimizar por conversiones necesita un píxel.");
    }
    if (errors.length > 0) {
      res.status(400).json({ type: "validation_error", errors });
      return;
    }

    // `promoted_object` es lo que Meta usa para saber QUÉ está promocionando.
    // Para formulario instantáneo es la Página; para conversiones, el píxel y
    // qué evento cuenta como resultado.
    const promotedObject =
      optimizationGoal === "LEAD_GENERATION"
        ? { page_id: String(pageId) }
        : { pixel_id: String(pixelId), custom_event_type: "LEAD" };

    // Meta espera los públicos como [{id}], no como ids sueltos.
    const asAudienceRefs = (ids: unknown) =>
      Array.isArray(ids) && ids.length > 0 ? ids.map((id: string) => ({ id: String(id) })) : undefined;

    const targeting: Record<string, unknown> = {
      geo_locations: { countries },
      age_min: Number(ageMin) || 18,
      age_max: Number(ageMax) || 65,
      // Meta EXIGE declararlo explícitamente (error 1870227 si falta).
      // advantage_audience=1 deja que Meta se expanda más allá de los públicos
      // que elegiste; =0 respeta tu selección al pie de la letra. Por defecto va
      // apagado: si alguien armó lookalikes finos y exclusiones, no queremos que
      // Meta los pise por su cuenta.
      targeting_automation: { advantage_audience: advantageAudience ? 1 : 0 },
    };

    const incluir = asAudienceRefs(includeAudiences);
    const excluir = asAudienceRefs(excludeAudiences);
    if (incluir) targeting.custom_audiences = incluir;
    // Excluir a quien ya convirtió es lo que evita pagarle a Meta por volver a
    // mostrarle el anuncio a alguien que ya se inscribió.
    if (excluir) targeting.excluded_custom_audiences = excluir;

    const params: Record<string, string> = {
      name,
      campaign_id: String(campaignId),
      optimization_goal: optimizationGoal,
      billing_event: "IMPRESSIONS",
      // Sin bid_strategy a propósito: cuando la campaña lleva presupuesto
      // (Advantage), la estrategia de puja vive allá. Mandarla también aquí hace
      // que Meta pida un bid_amount que no queremos fijar.
      promoted_object: JSON.stringify(promotedObject),
      targeting: JSON.stringify(targeting),
      status: "PAUSED",
    };

    // El presupuesto va aquí SOLO si la campaña no lo lleva (sin Advantage).
    // Mandar los dos hace que Meta rechace la creación.
    if (dailyBudget) {
      const parsed = Number(String(dailyBudget).replace(",", "."));
      if (!Number.isNaN(parsed) && parsed > 0) {
        params.daily_budget = String(Math.round(parsed * 100));
      }
    }

    const actId = String(accountId).startsWith("act_") ? accountId : `act_${accountId}`;
    const client = new MetaGraphClient(token);

    try {
      const data = await client.post(`${actId}/adsets`, params);
      res.json({ type: "success", adsetId: data.id, name });
    } catch (err) {
      if (err instanceof MetaGraphError) {
        res.status(err.httpCode ?? 502).json({
          type: "api_error",
          message: err.message,
          titulo: err.userTitle,
          errorCode: err.errorCode,
          subcode: err.subcode,
        });
        return;
      }
      console.error(`el conjunto de anuncios no se pudo crear — ${porQueFallo(err)}`);
      res.status(500).json({ type: "api_error", message: "No se pudo completar la operación." });
    }
  }),
);
