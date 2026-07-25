/**
 * EL CATÁLOGO DE CERBERUS — el mapeo puro de una fila del payload público
 * (`/productos/api/public/productos-cursos/`) al producto que consume el front.
 *
 * Extraído de la ruta (`routes/venta.ts`) al patrón puro+wrapper (arquitectura
 * §5.3) para poder fijarlo con tests sin red ni base.
 *
 * MONEDA (#43): un `{precio}` sin moneda en LATAM es plata perdida — pero una
 * moneda INVENTADA es peor. El payload vivo (verificado 2026-07-23, 111
 * productos) hoy NO trae ninguna key de moneda; este mapeo busca las candidatas
 * (`moneda`, `simbolo_moneda`, `codigo_moneda`) y, si no hay, devuelve `''`:
 * el consumidor muestra un hueco antes que una moneda equivocada. El faltante
 * está escalado en el issue #43 — la cotización necesita moneda sí o sí.
 */

export interface ProductoCatalogo {
  id: string;
  sku: string;
  nombre: string;
  precioNormal: number;
  precioPromocion: number;
  /** Símbolo o código («S/», «USD», «PEN») — `''` cuando Cerberus no la trae. */
  moneda: string;
}

/**
 * Solo una PRIMITIVA sirve como moneda: un `String(objeto)` da
 * `'[object Object]'`, y eso viajando como moneda es peor que el hueco.
 */
function primitiva(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/**
 * La primera key de moneda presente y con valor; si ninguna, `''`. Contempla
 * también la forma ANIDADA — el patrón real de Cerberus: `categoria`/`negocio`/
 * `division` vienen como `{codigo_*, nombre_*}`, así que una futura `moneda`
 * bien puede llegar como `{simbolo_moneda, codigo_moneda}`.
 */
function monedaDe(p: Record<string, unknown>): string {
  for (const key of ['moneda', 'simbolo_moneda', 'codigo_moneda'] as const) {
    const v = p[key];
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const anidada = primitiva(o.simbolo_moneda) || primitiva(o.codigo_moneda);
      if (anidada !== '') return anidada;
      continue; // objeto sin nada usable: se sigue buscando, jamás se stringifica
    }
    const s = primitiva(v);
    if (s !== '') return s;
  }
  return '';
}

const BASE = (process.env.CERBERUS_BASE_URL ?? "https://app.goberna.us").replace(/\/$/, "");

/**
 * EL CATÁLOGO VIVO — la API pública de Cerberus, solo lectura, sin sesión.
 *
 * Vive acá y no en la ruta porque tiene DOS consumidores: el buscador de cursos
 * del front (`routes/venta.ts`) y la confirmación del interés derivado
 * (`cursos/confirmar.ts`), que necesita el catálogo entero para saber qué
 * edición de la familia se vende hoy. Sin `q` devuelve los ~111 productos
 * activos, que es un payload chico y una sola llamada.
 *
 * Tira `Error` si Cerberus no responde: quien llama decide qué hacer, pero
 * NUNCA se degrada a una lista vacía — «no hay productos» y «Cerberus está
 * caído» son cosas distintas y confundirlas registra interés equivocado.
 */
export async function buscarProductos(q = ""): Promise<ProductoCatalogo[]> {
  const r = await fetch(
    `${BASE}/productos/api/public/productos-cursos/?estado=1${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const d = (await r.json()) as { results?: Array<Record<string, unknown>> };
  return (d.results ?? []).map(mapearProducto);
}

export function mapearProducto(p: Record<string, unknown>): ProductoCatalogo {
  return {
    id: String(p.codigo_producto),
    sku: String(p.sku_producto ?? ''),
    nombre: String(p.nombre_producto ?? ''),
    precioNormal: Number(p.precio_normal ?? 0),
    precioPromocion: Number(p.precio_promocion ?? p.precio_normal ?? 0),
    moneda: monedaDe(p),
  };
}
