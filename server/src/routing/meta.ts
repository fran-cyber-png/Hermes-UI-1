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
 * Lo que además necesita el catálogo de campañas: seguir la paginación. Va
 * aparte para que los stubs de `resolverAnuncios` —que no pagina— no tengan que
 * fingir un método que nunca llaman.
 */
export interface ClienteGraphPaginado extends ClienteGraph {
  getAll(path: string, params: Record<string, string>): Promise<any[]>;
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
export function clienteDeEntorno(): ClienteGraphPaginado | null {
  const token = process.env.META_ACCESS_TOKEN;
  return token ? new MetaGraphClient(token) : null;
}

/** Una campaña de Meta, con los números de WhatsApp a los que mandan sus adsets. */
export interface CampanaDeMeta {
  campanaId: string;
  nombre: string;
  estado: string;
  numeros: string[];
}

/**
 * TODAS LAS CAMPAÑAS DE LA CUENTA QUE MANDAN GENTE A WHATSAPP.
 *
 * 🔴 **El número destino vive en el ADSET, no en la campaña**
 * (`promoted_object.whatsapp_phone_number`), así que se pregunta por adsets y se
 * agrupa. Una campaña con cuatro adsets puede mandar a cuatro números distintos
 * —medido: `[AGO] FORO DE ESTADO | WSP` lo hace— y por eso `numeros` es un
 * conjunto y no un valor.
 *
 * ⚠️ **Se piden TODOS los adsets, no solo los activos.** Un adset pausado hoy se
 * reactiva mañana, y una campaña que desaparece de la lista se lleva su cable
 * puesto sin avisar. El estado viaja y lo muestra la pantalla; filtrar acá sería
 * decidir por ella.
 */
export async function campanasDeWhatsapp(
  cuentaId: string,
  cliente: ClienteGraphPaginado,
): Promise<CampanaDeMeta[]> {
  const cuenta = cuentaId.startsWith("act_") ? cuentaId : `act_${cuentaId}`;
  const filas = await cliente.getAll(`${cuenta}/adsets`, {
    fields: "id,effective_status,destination_type,promoted_object,campaign{id,name,effective_status}",
    limit: "200",
  });

  const acumulado = new Map<string, { nombre: string; estado: string; numeros: Set<string> }>();

  for (const a of filas) {
    const c = a?.campaign;
    const id = typeof c?.id === "string" ? c.id : "";
    const nombre = typeof c?.name === "string" ? c.name.trim() : "";
    if (!id || !nombre) continue;

    const previa = acumulado.get(id) ?? {
      nombre,
      estado: typeof c?.effective_status === "string" ? c.effective_status : "",
      numeros: new Set<string>(),
    };
    const numero = normalizarNumero(a?.promoted_object?.whatsapp_phone_number);
    if (numero) previa.numeros.add(numero);
    acumulado.set(id, previa);
  }
  return [...acumulado.entries()].map(([campanaId, v]) => ({
    campanaId,
    nombre: v.nombre,
    estado: v.estado,
    numeros: [...v.numeros].sort(),
  }));
}

/**
 * ⚠️ Meta devuelve el número **sin `+` y a veces con separadores**; Hermes lo
 * guarda como dígitos con código de país (`51984429504`). Comparar sin
 * normalizar haría que ninguna campaña matcheara con ninguna línea, y la
 * pantalla diría «no hay campañas» sobre una cuenta con diecisiete adsets vivos.
 */
function normalizarNumero(crudo: unknown): string | null {
  const digitos = String(crudo ?? "").replace(/[^0-9]/g, "");
  return digitos.length >= 8 ? digitos : null;
}

/**
 * DE QUÉ CUENTAS DE PAUTA SON ESTOS ANUNCIOS.
 *
 * 🔴 **SON VARIAS, Y ASUMIR UNA TRAE EL CATÁLOGO EQUIVOCADO.** Medido el
 * 12-ago-2026: los anuncios de julio terminan en `…0016` y los de agosto en
 * `…0789` — el sufijo del id de Meta es la CUENTA, o sea que la pauta se mudó de
 * cuenta publicitaria en el medio. El primer borrador derivaba «la» cuenta del
 * primer anuncio visto, agarraba la vieja, y sincronizaba **116 campañas de la
 * cuenta que ya no se usa** mientras la campaña activa de OSINT no aparecía por
 * ningún lado. La pantalla quedaba llena y vacía a la vez.
 *
 * Por eso se preguntan TODOS los anuncios conocidos y se juntan sus cuentas. Se
 * resuelve en lotes (`ids=`), con el mismo reintento de a uno que
 * `resolverAnuncios`: un id podrido no puede dejar sin catálogo a las demás.
 *
 * `META_AD_ACCOUNT_ID` sigue mandando si está puesta: es la salida para fijar una
 * cuenta a mano sin depender de qué anuncios entraron.
 */
export async function cuentasDePauta(
  adIds: readonly string[],
  cliente: ClienteGraph,
): Promise<string[]> {
  const delEntorno = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  if (delEntorno) return [delEntorno];

  const unicos = [...new Set(adIds.map((a) => a.trim()).filter(Boolean))].slice(0, TOPE_POR_LOTE);
  if (unicos.length === 0) return [];

  const cuentas = new Set<string>();
  const anotar = (cuerpo: any) => {
    const id = typeof cuerpo?.account_id === "string" ? cuerpo.account_id.trim() : "";
    if (id) cuentas.add(id);
  };
  try {
    const r = await cliente.get("", { ids: unicos.join(","), fields: "account_id" });
    for (const ad of unicos) anotar(r?.[ad]);
  } catch {
    for (const ad of unicos) {
      try {
        anotar(await cliente.get(ad, { fields: "account_id" }));
      } catch {
        // Un anuncio que Meta ya no reconoce no puede dejar sin catálogo al resto.
      }
    }
  }
  return [...cuentas];
}
