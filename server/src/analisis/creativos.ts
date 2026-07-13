import type { CampaignInput } from "../decisions/detectors.js";
import { aUsd, type Tasas } from "./tasas.js";

/**
 * EL ANÁLISIS DE CREATIVOS — qué anuncio funciona, no solo cuánto gastó.
 *
 * Aplana todos los anuncios del snapshot y los agrupa por CREATIVO (el `effective_object_story_id`:
 * el post real detrás del anuncio). Un mismo creativo suele correr en varios anuncios/conjuntos; lo
 * que importa es cómo rinde el creativo, no cada instancia. Junta su gasto y sus resultados, muestra
 * su miniatura y su copy, y dice cuánto cuesta cada resultado.
 *
 * ── Honestidad del dinero ──
 * Cada anuncio gasta en la moneda de SU cuenta. Se convierte a USD con la tasa del negocio antes de
 * comparar, o rankearíamos pesos contra dólares. El "resultado" (conversación iniciada, normalmente)
 * es un conteo, así que el costo por resultado en USD es gasto_usd / resultados.
 *
 * ── Lo que este análisis NO dice todavía ──
 * Qué creativo produjo cada VENTA. Eso necesita el `ctwa_clid` del clic-a-WhatsApp, que hoy Baileys
 * descarta y llega con la migración a la Cloud API. Hasta entonces: costo por CONVERSACIÓN, no por
 * venta. Se dice así, no se finge.
 */

const MIN_GASTO_USD = 20; // debajo de esto, no hay con qué juzgar un creativo
const MIN_RESULTADOS = 3; // el mismo portón que roasPais: no se acciona sobre 1-2 conversaciones

export type VeredictoCreativo = "eficiente" | "caro" | "medio" | "sin_resultados" | "poco_gasto";

export type Creativo = {
  clave: string;
  nombre: string;
  thumbnailUrl: string | null;
  copy: string | null;
  gastoUsd: number;
  resultados: number;
  /** null cuando no hubo resultados: no medible ≠ cero. */
  costoPorResultadoUsd: number | null;
  /** En cuántos anuncios corrió este mismo creativo. */
  anuncios: number;
  campana: string;
  veredicto: VeredictoCreativo;
  /** ¿Se quemó? Frecuencia sube Y CTR baja: al mismo público se le muestra más y responde menos. */
  fatiga: boolean;
  /** CTR promedio del creativo, en %. null si Meta no dio la serie diaria. */
  ctr: number | null;
};

type Agg = {
  nombre: string;
  thumbnailUrl: string | null;
  copy: string | null;
  gastoUsd: number;
  resultados: number;
  anuncios: number;
  campana: string;
  fatiga: boolean;
  ctrs: number[];
};

export function creativos(campanas: CampaignInput[], tasas: Tasas): Creativo[] {
  const porCreativo = new Map<string, Agg>();

  for (const camp of campanas) {
    for (const adset of camp.adsets) {
      for (const ad of adset.ads) {
        const cr = ad.creative ?? null;
        const spendUsd = aUsd(ad.spend, camp.currency, tasas);
        // Sin conversión (moneda sin tasa) no se puede comparar: se descarta, no se falsea.
        if (spendUsd == null) continue;

        // La clave es el post real (story) si existe; si no, el anuncio como su propio creativo.
        const clave = cr?.storyId ?? ad.id;
        const prev =
          porCreativo.get(clave) ??
          ({
            nombre: cr?.title ?? ad.name,
            thumbnailUrl: cr?.thumbnailUrl ?? null,
            copy: cr?.body ?? cr?.title ?? null,
            gastoUsd: 0,
            resultados: 0,
            anuncios: 0,
            campana: camp.name,
            fatiga: false,
            ctrs: [],
          } as Agg);

        prev.gastoUsd += spendUsd;
        prev.resultados += ad.results ?? 0;
        prev.anuncios += 1;
        // Si CUALQUIER anuncio de este creativo está quemado, el creativo está quemado: es el
        // mismo post mostrándose de más al mismo público.
        if (ad.fatiga) prev.fatiga = true;
        if (ad.ctr != null) prev.ctrs.push(ad.ctr);
        // Se conserva la primera miniatura/copy no vacíos que aparezcan.
        prev.thumbnailUrl ||= cr?.thumbnailUrl ?? null;
        prev.copy ||= cr?.body ?? cr?.title ?? null;
        porCreativo.set(clave, prev);
      }
    }
  }

  const items = [...porCreativo.entries()]
    .map(([clave, a]) => ({
      clave,
      nombre: a.nombre,
      thumbnailUrl: a.thumbnailUrl,
      copy: a.copy,
      gastoUsd: Math.round(a.gastoUsd),
      resultados: a.resultados,
      costoPorResultadoUsd: a.resultados > 0 ? Math.round((a.gastoUsd / a.resultados) * 100) / 100 : null,
      anuncios: a.anuncios,
      campana: a.campana,
      fatiga: a.fatiga,
      ctr: a.ctrs.length ? Math.round((a.ctrs.reduce((s, x) => s + x, 0) / a.ctrs.length) * 100) / 100 : null,
    }))
    .filter((c) => c.gastoUsd > 0); // solo creativos que efectivamente corrieron

  // La mediana del costo por resultado, sobre los que tienen con qué juzgarse (gasto Y volumen
  // mínimos). Es la vara del veredicto: un creativo con 1 conversación no debe torcerla.
  const costos = items
    .filter(
      (c) =>
        c.costoPorResultadoUsd != null && c.gastoUsd >= MIN_GASTO_USD && c.resultados >= MIN_RESULTADOS,
    )
    .map((c) => c.costoPorResultadoUsd as number)
    .sort((a, b) => a - b);
  const mediana = costos.length ? costos[Math.floor(costos.length / 2)] : null;

  const conVeredicto: Creativo[] = items.map((c) => ({
    ...c,
    veredicto: veredicto(c.gastoUsd, c.resultados, c.costoPorResultadoUsd, mediana),
  }));

  // Se ordena por PLATA: los creativos con más inversión detrás primero.
  return conVeredicto.sort((a, b) => b.gastoUsd - a.gastoUsd);
}

function veredicto(
  gastoUsd: number,
  resultados: number,
  costo: number | null,
  mediana: number | null,
): VeredictoCreativo {
  if (gastoUsd < MIN_GASTO_USD) return "poco_gasto"; // sin gasto mínimo no se acciona
  if (resultados === 0 || costo == null) return "sin_resultados"; // gastó y no generó conversación
  // Con 1-2 conversaciones el costo por resultado es ruido: no se dice "eficiente" ni "caro".
  if (resultados < MIN_RESULTADOS) return "medio";
  if (mediana == null) return "medio";
  if (costo <= mediana * 0.75) return "eficiente"; // notablemente más barato que el resto
  if (costo >= mediana * 1.5) return "caro"; // notablemente más caro
  return "medio";
}
