import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";
import { porQueFallo } from "../lib/porQueFallo.js";
import { ruta } from "../lib/ruta.js";

export const metaAssetsRouter = Router();

function token(res: any): string | null {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) {
    res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
    return null;
  }
  return t;
}

/**
 * Páginas con su Instagram vinculado y sus formularios de leads.
 * Un anuncio de leads necesita las tres cosas: la Página lo publica, el
 * Instagram le da presencia en IG (donde vino el 59% de los leads), y el
 * formulario es donde la persona deja los datos.
 */
metaAssetsRouter.get("/pages", ruta(async (_req, res) => {
  const t = token(res);
  if (!t) return;

  const client = new MetaGraphClient(t);
  try {
    const pages = await client.getAll("me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
    });

    const enriched = await Promise.all(
      pages.map(async (p) => {
        const pageClient = new MetaGraphClient(p.access_token);
        let forms: any[] = [];
        try {
          forms = await pageClient.getAll(`${p.id}/leadgen_forms`, {
            fields: "id,name,status,leads_count",
            limit: "100",
          });
        } catch {
          // Página compartida por un partner sin permiso de Leads — se lista
          // igual, solo que sin formularios.
        }
        return {
          pageId: p.id,
          name: p.name,
          instagramId: p.instagram_business_account?.id ?? null,
          instagramUser: p.instagram_business_account?.username ?? null,
          leadForms: forms
            .filter((f) => f.status !== "ARCHIVED")
            .map((f) => ({ id: f.id, name: f.name, leadsCount: f.leads_count ?? 0 })),
        };
      }),
    );

    res.json({ pages: enriched.sort((a, b) => b.leadForms.length - a.leadForms.length) });
  } catch (err) {
    // El mensaje de un `MetaGraphError` SÍ se muestra: es el diagnóstico que dio
    // Meta y es lo único que explica por qué no se pudo listar. Cualquier otro
    // error sale genérico y se loguea — su texto crudo puede ser el SQL.
    if (!(err instanceof MetaGraphError)) {
      console.error(`las Páginas de Meta no se pudieron listar — ${porQueFallo(err)}`);
    }
    const message = err instanceof MetaGraphError ? err.message : "No se pudo completar la operación.";
    res.status(502).json({ type: "api_error", message });
  }
}));

/** Imágenes ya subidas a la cuenta — para no obligar a subir una nueva. */
metaAssetsRouter.get("/ad-images", ruta(async (req, res) => {
  const t = token(res);
  if (!t) return;

  const accountId = String(req.query.accountId ?? "").replace(/^act_/, "");
  if (!accountId) {
    res.status(400).json({ type: "validation_error", errors: ["Falta la cuenta publicitaria."] });
    return;
  }

  const client = new MetaGraphClient(t);
  try {
    const images = await client.getAll(`act_${accountId}/adimages`, {
      fields: "hash,name,url_128,width,height",
      limit: "50",
    });
    res.json({
      images: images.map((i) => ({
        hash: i.hash,
        name: i.name,
        url: i.url_128,
        width: i.width,
        height: i.height,
      })),
    });
  } catch (err) {
    // Mismo criterio que arriba: el diagnóstico de Meta se muestra, el resto no.
    if (!(err instanceof MetaGraphError)) {
      console.error(`las imágenes de la cuenta no se pudieron listar — ${porQueFallo(err)}`);
    }
    const message = err instanceof MetaGraphError ? err.message : "No se pudo completar la operación.";
    res.status(502).json({ type: "api_error", message });
  }
}));
