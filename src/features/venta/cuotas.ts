/**
 * CUÁNTO CAE EN CADA CUOTA — Y LA AUTORIDAD NO ES ESTE ARCHIVO.
 *
 * 🔴 **El reparto lo hace Cerberus.** Su backend recalcula el monto de cada cuota
 * en la creación (`_distribuir_monto_en_cuotas`, `ceberusapp/sales/views.py:860`,
 * llamada en `views.py:1143`) y Hermes solo le manda **cuántas cuotas son y
 * cuándo vence cada una** (`server/src/cerberus/venta.ts`, `CuotaVenta`). Lo de
 * acá es un **ESPEJO** para que la vendedora vea el cronograma antes de apretar:
 * si el reparto de allá cambia, el que miente es éste, y se arregla acá.
 *
 * Por qué existe igual, siendo un espejo: sin mostrar el reparto, «3 cuotas» es
 * una promesa que la vendedora hace sin saber qué le va a llegar al cliente por
 * escrito. Con centavos que no dividen exacto —100 en 3— la diferencia entre la
 * primera y la última es real y la tiene que poder decir.
 *
 * La regla, copiada de Python: se trabaja en **centavos**, `base = total // n`, y
 * **el sobrante va a las PRIMERAS** cuotas (una unidad cada una). Nunca al final:
 * lo contrario dejaría la última cuota más cara que las demás.
 */

/**
 * El total, en centavos enteros, con el mismo redondeo que Python.
 *
 * ⚠️ **Se pasa por el TEXTO, no por `monto * 100`.** La multiplicación binaria da
 * `861.4999999999999` para 8.615, y ahí `Math.round` devuelve 861 mientras
 * Cerberus —que multiplica con `Decimal` sobre la representación decimal— llega a
 * 862. Un centavo de diferencia en la cuota que el cliente ve escrita.
 */
function aCentavos(monto: number): number {
  if (!Number.isFinite(monto) || monto <= 0) return 0;
  const [entero, decimales = ''] = monto.toFixed(6).split('.');
  const centavos = Number(entero) * 100 + Number(decimales.slice(0, 2) || '0');
  // ROUND_HALF_UP sobre el tercer decimal: es exactamente «la parte fraccionaria
  // del centavo llegó a la mitad».
  return Number(decimales[2] ?? '0') >= 5 ? centavos + 1 : centavos;
}

/**
 * Reparte `montoTotal` en `cantidad` cuotas, en unidades de la moneda.
 *
 * Con `cantidad` 0 (o basura) devuelve `[]`, igual que Python: es «todavía no hay
 * cronograma», no un error.
 */
export function repartirEnCuotas(montoTotal: number, cantidad: number): number[] {
  const n = Math.max(Math.trunc(cantidad) || 0, 0);
  if (n === 0) return [];
  const total = Math.max(aCentavos(montoTotal), 0);
  const base = Math.floor(total / n);
  const resto = total - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}
