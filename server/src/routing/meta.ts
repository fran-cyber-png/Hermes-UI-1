import { MetaGraphClient } from "../meta/metaClient.js";

/**
 * DEL ad_id A SU CAMPAÑA — la única parte de este frente que habla con Meta.
 *
 * Vive aparte a propósito: el reparto ocurre adentro del webhook y **no puede
 * llamar acá** (ver `db/routing.ts`). Esto se corre a mano —el botón de la
 * pantalla o `npm run routing:refrescar`— y deja la respuesta en
 * `campana_anuncio`, que es contra lo que el webhook resuelve.
 *
 * `resolverAnuncio` (en `meta/anuncio.ts`) hace lo mismo para UNO y no se
 * reemplaza: contesta otra pregunta (el nombre humano de un anuncio para la
 * ficha) y no le importa el estado de la campaña.
 */

export interface CampanaDeAnuncio {
  adId: string;
  campanaId: string;
  campanaNombre: string;
  /** El `effective_status` crudo de la campaña. Se traduce al leer, no acá. */
  estado: string;
}

/** Lo mínimo que este módulo necesita de un cliente de Graph. Inyectable para los tests. */
export interface ClienteGraph {
  get(path: string, params?: Record<string, string>): Promise<any>;
}

/**
 * ⚠️ **Meta corta el `ids=` en 50.** Y no es lo único: si UNO de los ids del
 * lote es inválido, **falla el lote ENTERO** — un solo `12345` de una prueba
 * vieja dejaría sin resolver a las trece campañas de verdad. Por eso, cuando un
 * lote falla, se reintenta uno por uno y se descartan solo los que no existen.
 */
const TOPE_POR_LOTE = 50;

const CAMPOS = "id,campaign{id,name,effective_status}";

export async function resolverAnuncios(
  adIds: readonly string[],
  cliente: ClienteGraph,
): Promise<{ resueltos: CampanaDeAnuncio[]; fallaron: string[] }> {
  const unicos = [...new Set(adIds.map((a) => a.trim()).filter(Boolean))];
  const resueltos: CampanaDeAnuncio[] = [];
  const fallaron: string[] = [];

  for (let i = 0; i < unicos.length; i += TOPE_POR_LOTE) {
    const lote = unicos.slice(i, i + TOPE_POR_LOTE);
    try {
      const r = await cliente.get("", { ids: lote.join(","), fields: CAMPOS });
      for (const ad of lote) {
        const fila = leerUno(ad, r?.[ad]);
        if (fila) resueltos.push(fila);
        else fallaron.push(ad);
      }
    } catch {
      // El lote se cayó: puede haber sido UN id inválido. Se pregunta de a uno
      // para no perder los buenos por culpa del malo.
      for (const ad of lote) {
        try {
          const fila = leerUno(ad, await cliente.get(ad, { fields: CAMPOS }));
          if (fila) resueltos.push(fila);
          else fallaron.push(ad);
        } catch {
          fallaron.push(ad);
        }
      }
    }
  }

  return { resueltos, fallaron };
}

/**
 * Un anuncio sin campaña legible **no se guarda a medias**: una fila con el
 * nombre en blanco se vería en la pantalla como una campaña de verdad, y le
 * podrían poner una regla. Mejor que falte a que mienta.
 */
function leerUno(adId: string, cuerpo: any): CampanaDeAnuncio | null {
  const c = cuerpo?.campaign;
  const campanaId = typeof c?.id === "string" ? c.id.trim() : "";
  const nombre = typeof c?.name === "string" ? c.name.trim() : "";
  if (!campanaId || !nombre) return null;
  return {
    adId,
    campanaId,
    campanaNombre: nombre,
    estado: typeof c?.effective_status === "string" ? c.effective_status : "",
  };
}

/** El cliente de verdad. `null` si no hay token: config faltante, no una caída. */
export function clienteDeEntorno(): ClienteGraph | null {
  const token = process.env.META_ACCESS_TOKEN;
  return token ? new MetaGraphClient(token) : null;
}
