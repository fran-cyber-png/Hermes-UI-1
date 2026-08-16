import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";

export const adsRouter = Router();

/**
 * Los botones que puede llevar el anuncio. Para un formulario instantáneo,
 * el botón es lo que abre el formulario.
 */
export const CALL_TO_ACTIONS = [
  { value: "SIGN_UP", label: "Registrarte" },
  { value: "LEARN_MORE", label: "Más información" },
  { value: "DOWNLOAD", label: "Descargar" },
  { value: "APPLY_NOW", label: "Postularte" },
  { value: "GET_QUOTE", label: "Solicitar información" },
] as const;

adsRouter.get("/options", (_req, res) => {
  res.json({ callToActions: CALL_TO_ACTIONS });
});

/**
 * Crear un anuncio son DOS llamadas a Meta, no una:
 *   1. el creativo (la pieza: imagen + textos + botón + a dónde lleva)
 *   2. el anuncio (el creativo, metido dentro de un conjunto)
 * Si la primera falla, no se crea nada — por eso no hay estado a medias.
 */
adsRouter.post(
  "/",
  ruta(async (req, res) => {
    const token = process.env.META_ACCESS_TOKEN;
    if (!token) {
      res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
      return;
    }

    const {
      accountId,
      adsetId,
      name,
      pageId,
      instagramId,
      imageHash,
      message,
      headline,
      description,
      leadFormId,
      link,
      callToAction,
    } = req.body ?? {};

    const errors: string[] = [];
    if (!accountId) errors.push("Falta la cuenta publicitaria.");
    if (!adsetId) errors.push("Falta el conjunto de anuncios.");
    if (!name) errors.push("El anuncio necesita un nombre.");
    if (!pageId) errors.push("Falta la Página que publica el anuncio.");
    if (!imageHash) errors.push("Elige una imagen.");
    if (!message) errors.push("Falta el texto principal del anuncio.");
    if (!leadFormId && !link) errors.push("El anuncio necesita un formulario o un enlace de destino.");
    if (errors.length > 0) {
      res.status(400).json({ type: "validation_error", errors });
      return;
    }

    const actId = String(accountId).startsWith("act_") ? accountId : `act_${accountId}`;
    const client = new MetaGraphClient(token);

    const linkData: Record<string, unknown> = {
      message,
      image_hash: imageHash,
      // Con formulario instantáneo el link no se usa (la persona nunca sale de
      // Meta), pero la API lo exige igual.
      link: link || "https://fb.me/",
      name: headline || undefined,
      description: description || undefined,
      call_to_action: leadFormId
        ? { type: callToAction || "SIGN_UP", value: { lead_gen_form_id: String(leadFormId) } }
        : { type: callToAction || "LEARN_MORE", value: { link: link } },
    };

    const objectStorySpec: Record<string, unknown> = { page_id: String(pageId), link_data: linkData };
    if (instagramId) objectStorySpec.instagram_user_id = String(instagramId);

    try {
      // 1. El creativo.
      const creative = await client.post(`${actId}/adcreatives`, {
        name: `${name} — creativo`,
        object_story_spec: JSON.stringify(objectStorySpec),
      });

      // 2. El anuncio. Pausado, igual que los otros dos niveles.
      const ad = await client.post(`${actId}/ads`, {
        name,
        adset_id: String(adsetId),
        creative: JSON.stringify({ creative_id: creative.id }),
        status: "PAUSED",
      });

      const accountNumber = String(accountId).replace(/^act_/, "");
      res.json({
        type: "success",
        adId: ad.id,
        creativeId: creative.id,
        name,
        adsManagerUrl: `https://adsmanager.facebook.com/manage/ads?act=${accountNumber}&selected_ad_ids=${ad.id}`,
      });
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
      console.error(`el anuncio no se pudo crear — ${porQueFallo(err)}`);
      res.status(500).json({ type: "api_error", message: "No se pudo completar la operación." });
    }
  }),
);
