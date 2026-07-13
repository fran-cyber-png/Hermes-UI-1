import { MetaGraphClient } from "../meta/metaClient.js";
import type { AdInput, CampaignInput } from "../decisions/detectors.js";

/**
 * Trae el creativo (miniatura, copy, story_id) SOLO para los anuncios que gastaron.
 *
 * ── Por qué no en el llamado a /ads ──
 * Expandir `creative{…}` inline para TODOS los anuncios —la mayoría con $0— hacía el llamado
 * lentísimo: 60 segundos para una sola cuenta. Y no hace falta: el análisis de creativos solo mira
 * los que corrieron. Así que primero se traen los anuncios rápido, y acá se pide el creativo en
 * LOTE, solo para el puñado con gasto, con el endpoint `?ids=` de Meta (hasta 50 por llamado).
 *
 * Muta los anuncios en su lugar: les cuelga `.creative`. Es idempotente y acotado por `tope`.
 */

const LOTE = 50;

const CAMPOS_CREATIVO = "creative{thumbnail_url,body,title,object_type,effective_object_story_id}";

export async function adjuntarCreativos(
  token: string,
  campanas: CampaignInput[],
  tope = 80,
): Promise<number> {
  // Todos los anuncios con gasto, de mayor a menor: son los únicos que el análisis va a mirar.
  const conGasto: AdInput[] = [];
  for (const camp of campanas) {
    for (const adset of camp.adsets) {
      for (const ad of adset.ads) {
        if (ad.spend > 0) conGasto.push(ad);
      }
    }
  }
  conGasto.sort((a, b) => b.spend - a.spend);
  const objetivo = conGasto.slice(0, tope);
  if (objetivo.length === 0) return 0;

  const client = new MetaGraphClient(token);
  const porId = new Map(objetivo.map((a) => [a.id, a]));
  let adjuntados = 0;

  for (let i = 0; i < objetivo.length; i += LOTE) {
    const chunk = objetivo.slice(i, i + LOTE);
    const ids = chunk.map((a) => a.id).join(",");
    let resp: Record<string, any>;
    try {
      // El endpoint de lote de Meta: GET /?ids=a1,a2,…&fields=creative{…} → objeto por id.
      resp = await client.get("", { ids, fields: CAMPOS_CREATIVO });
    } catch {
      // Un lote que falla no tumba la corrida: esos anuncios quedan sin creativo, no revientan.
      continue;
    }

    for (const [id, node] of Object.entries(resp)) {
      const ad = porId.get(id);
      const cr = (node as any)?.creative;
      if (!ad || !cr) continue;
      ad.creative = {
        thumbnailUrl: cr.thumbnail_url ?? null,
        body: cr.body ?? null,
        title: cr.title ?? null,
        objectType: cr.object_type ?? null,
        storyId: cr.effective_object_story_id ?? null,
      };
      adjuntados += 1;
    }
  }

  return adjuntados;
}
