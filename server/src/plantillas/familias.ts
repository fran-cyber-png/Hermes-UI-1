import type { ProductoCatalogo } from "../cerberus/productos.js";

/**
 * LA FAMILIA DE UN CURSO — el mínimo de #129 que una plantilla necesita.
 *
 * El catálogo tiene **111 productos activos en 38 familias**: «Diploma de
 * Especialización en Inteligencia y Contrainteligencia **14**», «Diploma
 * Internacional… **26**» y «diploma de inteligencia **11**» son **el mismo
 * diploma** en tres ediciones y con tres redacciones distintas del nombre.
 *
 * Por eso una plantilla NO se ata a un producto: se ata a una **familia**, y el
 * `{precio}` se resuelve contra la **última edición activa** en el momento de
 * expandir. Así, cuando la Escuela abre la edición 27, ninguna plantilla queda
 * cotizando la 26 — el problema de «actualizar todas las plantillas» no existe.
 *
 * **La identidad real es el PREFIJO DEL SKU**, no el nombre: `DIPICOT011`,
 * `DIPICOT014` y `DIPICOT026` comparten `DIPICOT` aunque sus nombres no se
 * parezcan. El nombre es el fallback, no la fuente.
 */

export interface Familia {
  /** El prefijo del SKU, en mayúsculas: `DIPICOT`. La identidad. */
  familia: string;
  /** El sufijo numérico del SKU: 26. `null` cuando el producto no tiene edición. */
  edicion: number | null;
  /** El nombre sin el número final, para que la lista se lea. */
  nombreCorto: string;
}

/**
 * Los SKUs genéricos (`GEN9000F6`, `GEN5C2G3`) NO siguen el patrón
 * `<PREFIJO><NNN>`: agrupar por «GEN» juntaría cosas que no tienen nada que ver.
 * Cada uno es su propia familia.
 */
const PREFIJO_GENERICO = "GEN";

/** Quita el número de edición del final del nombre, y los separadores sueltos. */
function sinNumeroFinal(nombre: string): string {
  return nombre
    .trim()
    .replace(/[\s\-–—:]*\b(?:n[°º.]?\s*)?\d{1,3}\s*$/i, "")
    .replace(/[\s\-–—:]+$/, "")
    .trim();
}

/** El fallback cuando no hay SKU: el nombre normalizado, sin acentos ni número. */
function familiaDelNombre(nombre: string): string {
  return sinNumeroFinal(nombre)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function familiaDeProducto(sku: string, nombre: string): Familia {
  const limpio = (sku ?? "").trim().toUpperCase();
  const nombreCorto = sinNumeroFinal(nombre ?? "") || (nombre ?? "").trim();

  if (!limpio) {
    return { familia: familiaDelNombre(nombre ?? ""), edicion: null, nombreCorto };
  }

  if (limpio.startsWith(PREFIJO_GENERICO)) {
    // Genérico: es su propia familia y no tiene edición que comparar.
    return { familia: limpio, edicion: null, nombreCorto };
  }

  // `DIPICOT014`, y también `DIPICOT003-6B5D`: cuando Cerberus tuvo que
  // desambiguar dos filas del mismo producto le pegó un sufijo al SKU. Sin
  // aceptarlo, esa edición se quedaba afuera de su familia (familia = el SKU
  // entero) y `ultimaEdicion` no la veía nunca.
  const m = /^([A-Z]+)(\d+)(?:-[A-Z0-9]+)?$/.exec(limpio);
  if (m) return { familia: m[1], edicion: Number(m[2]), nombreCorto };

  // Sin sufijo numérico (30 productos del catálogo): la familia es el SKU entero.
  return { familia: limpio, edicion: null, nombreCorto };
}

/**
 * La ÚLTIMA edición activa de una familia: la de mayor `edicion`. Empate o
 * ausencia de número ⇒ gana el primero del listado (Cerberus ya devuelve los
 * activos, y sin número no hay orden que inventar).
 *
 * Devuelve `null` cuando la familia no tiene ningún producto activo — y ese
 * `null` es lo que hace que `{precio}` salga como hueco en vez de mentir.
 */
export function ultimaEdicion(
  productos: readonly ProductoCatalogo[],
  familia: string,
): ProductoCatalogo | null {
  const objetivo = familia.trim().toUpperCase();
  let mejor: ProductoCatalogo | null = null;
  let mejorEdicion = -1;

  for (const p of productos) {
    const f = familiaDeProducto(p.sku, p.nombre);
    if (f.familia !== objetivo) continue;
    const e = f.edicion ?? 0;
    if (mejor === null || e > mejorEdicion) {
      mejor = p;
      mejorEdicion = e;
    }
  }

  return mejor;
}

/** El precio que la plantilla debe cotizar: el de promoción si existe. */
export function precioVigente(p: ProductoCatalogo): number {
  return p.precioPromocion > 0 ? p.precioPromocion : p.precioNormal;
}

/**
 * Agrupa un catálogo en familias, cada una con su última edición. Es lo que el
 * selector de curso de una plantilla muestra: **una fila por diploma**, no cinco
 * «Diploma de Especializaci…» truncadas e indistinguibles (el bug de #129).
 */
export function agruparEnFamilias(
  productos: readonly ProductoCatalogo[],
): { familia: string; nombreCorto: string; ultima: ProductoCatalogo; ediciones: number }[] {
  const porFamilia = new Map<string, ProductoCatalogo[]>();
  for (const p of productos) {
    const { familia } = familiaDeProducto(p.sku, p.nombre);
    const lote = porFamilia.get(familia);
    if (lote) lote.push(p);
    else porFamilia.set(familia, [p]);
  }

  return [...porFamilia.entries()]
    .map(([familia, lote]) => {
      const ultima = ultimaEdicion(lote, familia)!;
      return {
        familia,
        nombreCorto: familiaDeProducto(ultima.sku, ultima.nombre).nombreCorto,
        ultima,
        ediciones: lote.length,
      };
    })
    .sort((a, b) => a.nombreCorto.localeCompare(b.nombreCorto, "es"));
}
