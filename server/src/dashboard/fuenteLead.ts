import { sql, type SQL } from "drizzle-orm";

/**
 * DE DÓNDE VINO UN LEAD DE FORMULARIO, Y DE QUÉ — dicho bien.
 *
 * ── Los tres defectos que esto cierra (medidos el 8-ago-2026) ─────────────
 * El radar del Dashboard mostraba filas que decían literalmente **«icarus:landing»**
 * y las etiquetaba **«Lead Ad»**. Las dos cosas eran falsas, y salían de una sola
 * línea de `routes/dashboard.ts`.
 *
 *   platform | filas  | qué es
 *   ---------|--------|---------------------------------------------
 *   web      | 25.511 | los de LANDING (todos con form_name icarus:*), con datos de HOY
 *   ig / fb  | 651    | los Lead Ads reales de Meta, muertos desde el 19-may-2026
 *   landing  | **0**  | lo que el CASE buscaba
 *
 * 🔴 **`platform = 'landing'` no existe en ninguna fila de la tabla.** Lo escribe
 * `webhook/landing.ts` (el webhook de Bravo), que nunca recibió nada; lo que sí
 * escribe todos los días es `icarus/mapeo.ts`, con `platform: "web"`. Resultado:
 * el chip «Landings» del Dashboard estaba en cero permanente y los 25.511 leads
 * de landing se contaban como Lead Ads — o sea, el panel decía que el canal
 * muerto era el que traía gente y el vivo no traía nada.
 *
 * ── Y el rótulo: el COALESCE elegía el peor de los dos ───────────────────
 * `COALESCE(form_name, campaign_name)`. `form_name` **siempre** existe para los
 * de icarus (`icarus:landing`, un placeholder con namespace) y por eso tapaba a
 * `campaign_name`, que es donde vive el dato que sirve: «Diploma Élite
 * Internacional de Director de Seguridad Corporativo», «Diploma Internacional del
 * Consultor Político». El nombre del curso estaba guardado y no se mostraba.
 *
 * ── Por qué vive acá, puro y con espejo SQL ──────────────────────────────
 * Porque son dos reglas que el Dashboard aplica en SQL (pagina y agrupa en la
 * base) y que la pantalla necesita poder explicar. El patrón de la casa: la
 * definición canónica es la función, el SQL es su proyección, y el test las cruza.
 */

/** Las fuentes que el radar distingue. */
export type FuenteLead = "landing" | "lead-ad";

/**
 * ¿ES UN LEAD DE LANDING? — por `platform`, con los DOS escritores contemplados.
 *
 * `web` lo escribe `icarus/mapeo.ts` (el caño vivo) y `landing` lo escribiría
 * `webhook/landing.ts` (el de Bravo, sin tráfico todavía). Los dos son la misma
 * cosa para quien mira el panel: alguien llenó un formulario en una landing.
 *
 * ⚠️ **No se unifica el valor en la base**, y es a propósito: son 25.511 filas
 * históricas y reescribirlas para arreglar una lectura es cambiar el hecho para
 * no cambiar la consulta. La traducción vive acá, donde se puede leer.
 */
export function esDeLanding(platform: string | null | undefined): boolean {
  return platform === "web" || platform === "landing";
}

export function fuenteDeLead(platform: string | null | undefined): FuenteLead {
  return esDeLanding(platform) ? "landing" : "lead-ad";
}

/**
 * EL PLACEHOLDER DE ICARUS. `icarus/mapeo.ts` estampa el namespace `icarus:`
 * delante del formulario, y cuando la fila no trae ni `form_name` ni
 * `landing_page` deja `icarus:landing` — que es el 100 % de los casos medidos.
 *
 * Se reconoce por el PREFIJO y no por la cadena exacta: `icarus:algo` sigue
 * siendo un identificador interno, no algo que una vendedora deba leer.
 */
export const NAMESPACE_ICARUS = "icarus:";

export function esPlaceholderDeFormulario(formName: string | null | undefined): boolean {
  return typeof formName === "string" && formName.startsWith(NAMESPACE_ICARUS);
}

/**
 * QUÉ PIDIÓ ESTA PERSONA — el rótulo que la fila muestra.
 *
 * La campaña le gana al formulario **cuando el formulario es un identificador
 * interno**; en cualquier otro caso manda el formulario, que es más específico
 * (un Lead Ad de Meta tiene un `form_name` de verdad, escrito por una persona).
 *
 * `null` cuando no hay ninguno de los dos: la pantalla dice «sin dato» y no
 * inventa un nombre — es preferible el hueco a mostrar un id.
 */
export function productoDeLead(
  formName: string | null | undefined,
  campaignName: string | null | undefined,
): string | null {
  const campana = campaignName?.trim() || null;
  const formulario = formName?.trim() || null;
  if (esPlaceholderDeFormulario(formulario)) return campana ?? null;
  return formulario ?? campana ?? null;
}

// ── Las MISMAS reglas, dichas en SQL ─────────────────────────────────────────

/** Espejo de `fuenteDeLead(...)`. */
export const fuenteLeadSql: SQL = sql`(CASE WHEN platform IN ('web', 'landing') THEN 'landing' ELSE 'lead-ad' END)`;

/** Espejo de `productoDeLead(...)`. */
export const productoLeadSql: SQL = sql`(CASE
  WHEN form_name LIKE ${NAMESPACE_ICARUS + "%"} THEN NULLIF(btrim(campaign_name), '')
  ELSE COALESCE(NULLIF(btrim(form_name), ''), NULLIF(btrim(campaign_name), ''))
END)`;
