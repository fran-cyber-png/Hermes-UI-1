import { Router } from "express";
import { MetaGraphClient, MetaGraphError } from "../meta/metaClient.js";

export const audiencesRouter = Router();

/**
 * Cómo trabaja Goberna en realidad (leído de la cuenta, no supuesto):
 *
 *   1. Arman un PÚBLICO FUENTE a partir de comportamiento real:
 *      visitantes de una landing (píxel), gente que vio 3 seg de un video,
 *      quien interactuó con FB/IG, o una base de clientes subida a mano.
 *   2. De ese público sacan LOOKALIKES en tres tramos: 1%, 1-3%, 3-5%.
 *      (160 de sus 200 públicos son lookalikes — es su jugada principal.)
 *   3. Pautan sobre los lookalikes + retargeting.
 *   4. Y EXCLUYEN a quien ya convirtió, para no pagar por mostrarle el anuncio
 *      otra vez a alguien que ya se inscribió.
 *
 * El paso 4 es el que más plata ahorra y el más fácil de olvidar.
 */
const SUBTYPE_LABEL: Record<string, string> = {
  LOOKALIKE: "Públicos similares",
  WEBSITE: "Visitaron la web (píxel)",
  ENGAGEMENT: "Interactuaron con FB/IG",
  IG_BUSINESS: "Instagram",
  CUSTOM: "Listas subidas",
  OFFLINE_EVENTS: "Eventos offline",
  APP: "App",
};

// Nombres que Goberna usa para marcar un público como "de exclusión".
const PISTA_EXCLUSION = /excluir|exclude|excluded/i;

audiencesRouter.get("/", async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    res.status(500).json({ type: "config_error", message: "META_ACCESS_TOKEN no está configurado." });
    return;
  }

  const accountId = String(req.query.accountId ?? "").replace(/^act_/, "");
  if (!accountId) {
    res.status(400).json({ type: "validation_error", errors: ["Falta la cuenta publicitaria."] });
    return;
  }

  const client = new MetaGraphClient(token);
  try {
    const rows = await client.getAll(`act_${accountId}/customaudiences`, {
      fields: "id,name,subtype,approximate_count_lower_bound,operation_status,time_created",
      limit: "500",
    });

    const audiences = rows
      .map((a) => ({
        id: a.id,
        name: a.name,
        subtype: a.subtype,
        grupo: SUBTYPE_LABEL[a.subtype] ?? a.subtype,
        size: a.approximate_count_lower_bound ?? null,
        listo: a.operation_status?.code === 200,
        // Heurística sobre el nombre: Goberna marca los públicos de exclusión
        // en el propio nombre. Es una sugerencia, no una regla — el usuario
        // decide igual dónde va cada uno.
        sugeridoParaExcluir: PISTA_EXCLUSION.test(a.name ?? ""),
        creado: a.time_created,
      }))
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

    res.json({ audiences, total: audiences.length });
  } catch (err) {
    const message = err instanceof MetaGraphError ? err.message : (err as Error).message;
    res.status(502).json({ type: "api_error", message });
  }
});
