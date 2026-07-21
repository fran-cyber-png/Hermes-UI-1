import { MetaGraphClient } from './metaClient.js';

/**
 * DEL ad_id AL NOMBRE HUMANO — la ayuda de la Meta API.
 *
 * Un `externalAdReply` trae el `sourceId` (el ad_id), que es un número. Para que
 * la vendedora entienda "vino del anuncio X de la campaña Y", ese número se
 * resuelve contra la Graph API. Es una lectura, con el mismo token que ya usa la
 * ingesta.
 */

export interface AnuncioResuelto {
  adId: string;
  anuncio: string | null;
  campana: string | null;
  conjunto: string | null;
}

export async function resolverAnuncio(adId: string): Promise<AnuncioResuelto | null> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const client = new MetaGraphClient(token);
    // Un pedido: el anuncio con su campaña y su conjunto anidados.
    const r = await client.get(adId, { fields: 'name,campaign{name},adset{name}' });
    return {
      adId,
      anuncio: (r?.name as string) ?? null,
      campana: (r?.campaign?.name as string) ?? null,
      conjunto: (r?.adset?.name as string) ?? null,
    };
  } catch {
    // Un ad_id que Meta no reconoce (o un token sin acceso a esa cuenta) no rompe
    // la detección: el lead igual quedó marcado como "vino de un anuncio".
    return null;
  }
}
