import { createHash } from "node:crypto";

/**
 * LA VERSIÓN DE UNA PIEZA — un hash de lo que se manda, no un contador.
 *
 * ══ POR QUÉ HACE FALTA ══════════════════════════════════════════════════════
 *
 * El lazo de resultados va a registrar de qué pieza salió cada mensaje. Si ese
 * registro guarda el `id` y no la versión del TEXTO, el día que alguien mejore
 * una frase todos los resultados históricos de esa pieza se mezclan entre dos
 * textos distintos: una pieza que rendía 12 % y subió a 30 % se reporta como
 * 21 % para siempre y nadie ve que el cambio funcionó. El lazo mide un blanco
 * móvil y no lo dice (pedido (a) de Ivi, el único irreparable hacia atrás).
 *
 * ══ POR QUÉ UN HASH Y NO UN `version integer` ═══════════════════════════════
 *
 * Las dos formas son «estables y comparables», que es lo que Ivi pidió. El hash
 * gana por tres razones concretas de ESTE repo:
 *
 *   1. **Dos de los cuatro catálogos viven en código** (los acuses de
 *      `autorespuesta/plantillas.ts` y los ganchos de `campana.ts`): no tienen
 *      fila donde incrementar un contador. Un hash del texto los versiona igual
 *      que a los de tabla, sin inventarles una tabla.
 *   2. **No se puede olvidar.** Un contador hay que acordarse de subirlo; si
 *      alguien edita el texto y no lo sube, el lazo vuelve a mezclar dos textos
 *      bajo la misma versión — el bug exacto que esto viene a evitar, ahora
 *      silencioso. El hash se deriva del contenido: no hay «acordarse».
 *   3. **No hace falta migración.** Cero `db:push`, cero coordinación con las
 *      ramas que están tocando el schema en paralelo.
 *
 * El precio, dicho: dos ediciones que dejan el texto igual que antes vuelven a
 * la versión vieja (A → B → A colapsa a dos versiones, no tres). Para medir
 * rendimiento por texto eso es lo correcto: es el MISMO texto.
 *
 * ══ EL CONTRATO CON EL LAZO ═════════════════════════════════════════════════
 *
 * Quien registre `envios_wa` debe estampar la versión con ESTA función, no con
 * una copia: es una cadena opaca (`sha256:` + 16 hex) y lo único que importa es
 * que los dos lados la calculen igual. Si el lazo la guarda con otra receta, el
 * join no cierra y nadie se entera hasta que el reporte esté mal.
 */

export const PREFIJO_VERSION = "sha256:";

/** 16 hex = 64 bits. Alcanza de sobra para distinguir textos y entra en un log. */
const LARGO_HEX = 16;

/**
 * La versión de un contenido, a partir de sus partes en orden.
 *
 * Las partes van separadas por un byte nulo a propósito: sin separador,
 * `["ab", "c"]` y `["a", "bc"]` darían el mismo hash, y dos plantillas distintas
 * quedarían con la misma versión.
 */
export function versionDeContenido(partes: readonly (string | null | undefined)[]): string {
  const h = createHash("sha256");
  for (const parte of partes) {
    h.update(parte ?? "");
    h.update("\u0000");
  }
  return PREFIJO_VERSION + h.digest("hex").slice(0, LARGO_HEX);
}
