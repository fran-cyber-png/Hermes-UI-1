import { mapearProducto, type ProductoCatalogo } from "../cerberus/productos.js";
import { precioVigente, ultimaEdicion } from "./familias.js";

/**
 * EL PRECIO EN VIVO, en el instante de expandir.
 *
 * El cuerpo guardado dice `{precio}`; el número sale de Cerberus **ahora**. Así,
 * cuando la Escuela sube un precio, ninguna plantilla queda desactualizada — el
 * problema de «actualizar todas las plantillas» no llega a existir.
 *
 * Y por eso esto vive en el SERVER y no en el front: el caché de consultas se
 * persiste en IndexedDB (ADR 0007) y rehidrata precios de ayer. Un precio de
 * ayer en una cotización es plata perdida o un cliente enojado.
 */

const BASE = (process.env.CERBERUS_BASE_URL ?? "https://app.goberna.us").replace(/\/$/, "");

export interface CursoResuelto {
  nombre: string;
  precio: number;
  moneda: string;
}

/** El catálogo público de Cerberus (solo lectura, sin sesión). */
export async function catalogoActivo(): Promise<ProductoCatalogo[]> {
  const r = await fetch(`${BASE}/productos/api/public/productos-cursos/?estado=1`, {
    signal: AbortSignal.timeout(15_000),
  });
  const d = (await r.json()) as { results?: Array<Record<string, unknown>> };
  return (d.results ?? []).map(mapearProducto);
}

/**
 * El curso vigente de una familia: la ÚLTIMA edición activa con su precio.
 *
 * Devuelve `null` —y `{curso}`/`{precio}` quedan como hueco— cuando: no hay
 * familia atada, Cerberus no responde, o la familia no tiene ningún producto
 * activo. **Fallar acá nunca inventa un precio**: deja el hueco visible.
 */
export async function resolverCurso(familia: string | null): Promise<CursoResuelto | null> {
  if (!familia) return null;
  try {
    const productos = await catalogoActivo();
    const p = ultimaEdicion(productos, familia);
    if (!p) return null;
    return { nombre: p.nombre, precio: precioVigente(p), moneda: p.moneda };
  } catch {
    // Cerberus caído: hueco, no número viejo. El front lo avisa suave.
    return null;
  }
}
