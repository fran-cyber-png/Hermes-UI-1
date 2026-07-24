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

/** La primera key de moneda presente y con valor; si ninguna, `''`. */
function monedaDe(p: Record<string, unknown>): string {
  for (const key of ['moneda', 'simbolo_moneda', 'codigo_moneda'] as const) {
    const v = p[key];
    if (v != null && String(v) !== '') return String(v);
  }
  return '';
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
