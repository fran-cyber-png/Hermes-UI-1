import { MetaGraphClient, MetaGraphError } from "./metaClient.js";

/**
 * SUSCRIBIR LAS PÁGINAS AL WEBHOOK — lo que faltaba para que FB/IG existieran.
 *
 * Medido en VPS1 el 7-ago-2026: el token ve **12 Páginas y 9 cuentas de
 * Instagram**, y las **12 tienen `subscribed_apps` VACÍO**. Ésa es la razón
 * completa de por qué en producción no había un solo comentario: no era el
 * token, no era la UI, no era la cola. La app de Meta nunca se suscribió.
 *
 * ── Esto es la MITAD del trabajo, y la otra no es código ───────────────────
 * Suscribir la Página le dice a Meta «mandale los eventos a la app». **Dónde**
 * los manda se declara UNA vez en el dashboard de la app (Webhooks → objetos
 * `page` e `instagram` → callback `https://hermes-api.goberna.us/webhook/meta`
 * con el `WHATSAPP_VERIFY_TOKEN`). Sin eso, esto responde `success: true` y no
 * llega nada — y no hay error que lo delate. Por eso el script lo IMPRIME al
 * final en vez de dejarlo en un runbook que nadie abre.
 *
 * ── DRY-RUN POR DEFAULT ───────────────────────────────────────────────────
 * Sin `--aplicar` no manda un solo POST: lista qué páginas están suscritas, a
 * qué campos, y qué se cambiaría. Es la regla de la casa (`reparto:rueda`,
 * `hechos:sembrar`, `wa:permiso-llamada`), y acá pesa más que en otros lados
 * porque suscribir 12 Páginas abre un caño de eventos hacia producción.
 */

/**
 * LOS CAMPOS, Y POR QUÉ SOLO ÉSTOS.
 *
 * `feed` trae todo el muro (posts, reacciones, compartidos) y de eso el receptor
 * se queda solo con los comentarios — no hay un campo `comments` para Páginas,
 * así que el recorte se hace de nuestro lado (`webhook/metaPayload.ts`).
 *
 * Lo que deliberadamente NO se pide: `mention`, `ratings`, `feature_access_list`
 * y los treinta y pico restantes. Un campo suscrito que nadie interpreta es
 * tráfico que se guarda a medias o se tira en silencio; se agregan cuando haya
 * quién los lea.
 */
export const CAMPOS_PAGINA = ["feed", "messages", "messaging_postbacks"] as const;

/**
 * Instagram va por la MISMA Página (su `subscribed_apps`), no por la cuenta de
 * IG: es el error que cuesta media hora descubrir, porque el endpoint de la
 * cuenta de IG existe y devuelve otra cosa. Los campos sí son propios.
 */
export const CAMPOS_INSTAGRAM = ["comments", "messages"] as const;

export interface EstadoPagina {
  id: string;
  nombre: string;
  /** El id de la cuenta de Instagram vinculada, si tiene. */
  instagramId: string | null;
  /** Los campos a los que YA está suscrita esta Página, hoy. */
  suscritaA: string[];
  /** Lo que falta suscribir. Vacío = no hay nada que hacer. */
  faltan: string[];
  /** Solo con `--aplicar`: qué respondió Meta. */
  resultado?: "suscrita" | "sin_cambios" | string;
  error?: string;
}

/** Los campos que esta Página debería tener, según tenga o no Instagram. */
export function camposEsperados(instagramId: string | null): string[] {
  const campos = new Set<string>(CAMPOS_PAGINA);
  if (instagramId) for (const c of CAMPOS_INSTAGRAM) campos.add(c);
  return [...campos];
}

/**
 * Qué falta suscribir. **Es una UNIÓN, nunca un reemplazo**: `subscribed_apps`
 * pisa el set entero, así que mandar solo lo que falta desuscribiría lo que ya
 * estaba. Si alguien suscribió `mention` a mano desde el dashboard, se conserva.
 */
export function loQueFalta(suscritaA: readonly string[], esperados: readonly string[]): string[] {
  const ya = new Set(suscritaA);
  return esperados.filter((c) => !ya.has(c));
}

/** El set completo que hay que mandar: lo que ya estaba MÁS lo que falta. */
export function setCompleto(suscritaA: readonly string[], esperados: readonly string[]): string[] {
  return [...new Set([...suscritaA, ...esperados])].sort();
}

/**
 * Lee el estado de todas las Páginas del token. Solo lectura: es lo que corre el
 * dry-run, y lo que se imprime antes de tocar nada.
 */
export async function leerEstado(token: string): Promise<EstadoPagina[]> {
  const client = new MetaGraphClient(token);
  const pages = await client.getAll("me/accounts", {
    fields: "id,name,access_token,instagram_business_account",
    limit: "100",
  });

  const estados: EstadoPagina[] = [];
  for (const page of pages) {
    const instagramId = page.instagram_business_account?.id ?? null;
    const esperados = camposEsperados(instagramId);
    const base: EstadoPagina = {
      id: String(page.id),
      nombre: page.name ?? "(sin nombre)",
      instagramId,
      suscritaA: [],
      faltan: esperados,
    };

    try {
      // El token de PÁGINA, no el del usuario: `subscribed_apps` lo exige.
      const suscritas = await new MetaGraphClient(page.access_token).getAll(
        `${page.id}/subscribed_apps`,
        { fields: "subscribed_fields" },
      );
      base.suscritaA = (suscritas[0]?.subscribed_fields ?? []).map(String);
      base.faltan = loQueFalta(base.suscritaA, esperados);
    } catch (err) {
      base.error = err instanceof MetaGraphError ? err.message : (err as Error).message;
    }
    estados.push(base);
  }
  return estados;
}

/**
 * Suscribe UNA Página al set completo. Devuelve el estado actualizado.
 *
 * `POST /{page-id}/subscribed_apps` con el token de la Página. Necesita
 * `pages_manage_metadata`, que el token de producción ya tenía concedido el
 * 7-ago-2026 — o sea que esto NO pasa por revisión de app.
 */
export async function suscribirPagina(
  pageToken: string,
  pageId: string,
  campos: readonly string[],
): Promise<void> {
  const json = await new MetaGraphClient(pageToken).post(`${pageId}/subscribed_apps`, {
    subscribed_fields: campos.join(","),
  });

  // ⚠️ Meta puede responder **200 con `success: false`**. Un `res.ok` no alcanza,
  // y confiarse ahí dejaría el script diciendo «suscrita» sobre una Página que
  // sigue sin mandar nada — el mismo falso verde que ya costó un deploy acá
  // (los 32 MB de wasm que faltaban y el `curl -f` que pasaba igual).
  if (json?.success !== true) {
    throw new MetaGraphError(`Meta respondió 200 sin success: ${JSON.stringify(json)}`);
  }
}

/** Aplica lo que falta, Página por Página. `token` es el del usuario/system user. */
export async function aplicar(token: string, estados: EstadoPagina[]): Promise<EstadoPagina[]> {
  const client = new MetaGraphClient(token);

  for (const estado of estados) {
    if (estado.error) continue;
    if (estado.faltan.length === 0) {
      estado.resultado = "sin_cambios";
      continue;
    }
    try {
      // `get` y no `getAll`: esto devuelve UN objeto, no una lista — `getAll`
      // leería `data[]`, que acá no existe, y daría `[]` sin error.
      const pagina = await client.get(estado.id, { fields: "access_token" });
      const pageToken = pagina?.access_token;
      if (!pageToken) throw new MetaGraphError("la Página no devolvió access_token");

      const completo = setCompleto(estado.suscritaA, camposEsperados(estado.instagramId));
      await suscribirPagina(pageToken, estado.id, completo);
      estado.suscritaA = completo;
      estado.faltan = [];
      estado.resultado = "suscrita";
    } catch (err) {
      estado.error = err instanceof MetaGraphError ? err.message : (err as Error).message;
    }
  }
  return estados;
}
