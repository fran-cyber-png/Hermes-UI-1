import type { ProductoCatalogo } from "../cerberus/productos.js";

/**
 * DE LA FAMILIA AL PRODUCTO QUE SE VENDE HOY (#129).
 *
 * El chip de la propuesta dice «Inteligencia y Contrainteligencia» porque eso es
 * lo que se entiende de un vistazo; pero `intereses.curso` guarda **el nombre
 * del producto tal como está en Cerberus** (lo dice el comentario de la tabla), y
 * eso es lo que después se cotiza y se factura. Registrar el nombre corto sería
 * poner en la ficha un curso que no existe en el catálogo.
 *
 * Este módulo es el puente: dada una familia (`DIPICOT`) y el catálogo vivo,
 * devuelve **la última edición activa**. Se pregunta en el momento de confirmar,
 * no se guarda: cuando la Escuela abre la edición 27, la propuesta apunta sola a
 * la 27 sin tocar la tabla de alias.
 *
 * ⚠️ La edición sale del **SKU**, no del nombre: `DIPICOT014` se llama «Diploma
 * Internacional de Inteligencia y Contrainteligencia», sin número — leerla del
 * nombre lo dejaría empatado con una edición vieja que sí lo trae.
 *
 * Es PURO (recibe el catálogo ya traído). El fetch a Cerberus vive en
 * `cerberus/productos.ts`, su borde.
 */

/**
 * El prefijo alfabético del SKU es la familia — salvo los `GEN*`, SKUs genéricos
 * sin familia (`GEN9000F6`, `GEN5C2G3`): colapsarlos juntaría cosas que no
 * tienen nada que ver, así que cada uno es su propia familia.
 *
 * Es la misma regla que `familiaDeProducto` del front (`src/lib/producto.ts`,
 * #129). No se importa de allá porque el server compila con `rootDir: src` y no
 * puede alcanzar el árbol del front; lo que se repite es el prefijo del SKU, la
 * mitad trivial y estable —el parseo de NOMBRES, que es la parte delicada, sigue
 * viviendo una sola vez.
 */
export function familiaDeSku(sku: string | null | undefined): string | null {
  const limpio = (sku ?? "").trim().toUpperCase();
  const m = /^([A-Z]+)/.exec(limpio);
  if (!m) return null;
  return m[1] === "GEN" ? limpio : m[1];
}

/** El número de edición del SKU: `DIPICOT026` → 26. Sin sufijo numérico, `null`. */
function edicionDeSku(sku: string): number | null {
  const m = /(\d+)$/.exec(sku.trim());
  return m ? Number(m[1]) : null;
}

/**
 * La última edición activa de una familia, o `null` si el catálogo no tiene
 * ninguna. **`null` no se reemplaza por nada**: si Cerberus no tiene el producto,
 * el interés se registra a mano — inventar un nombre parecido es peor.
 *
 * Desempate cuando ninguna trae número: el `codigo_producto` más alto, que es el
 * alta más reciente en Cerberus.
 */
export function elegirUltimaEdicion(
  productos: readonly ProductoCatalogo[],
  familia: string,
): ProductoCatalogo | null {
  const objetivo = familia.trim().toUpperCase();
  const deLaFamilia = productos.filter((p) => familiaDeSku(p.sku) === objetivo);
  if (deLaFamilia.length === 0) return null;

  return deLaFamilia.reduce((mejor, p) => {
    const a = edicionDeSku(p.sku) ?? -1;
    const b = edicionDeSku(mejor.sku) ?? -1;
    if (a !== b) return a > b ? p : mejor;
    return Number(p.id) > Number(mejor.id) ? p : mejor;
  });
}
