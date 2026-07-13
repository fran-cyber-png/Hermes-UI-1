/**
 * El cerebro de decisiones de pauta.
 *
 * Portado fielmente de `goberna-dashboard/core/services/roas_analysis.py` — no reinventado. Es
 * criterio humano sedimentado en producción, con umbrales que nacieron de incidentes reales. Lo
 * único que cambia es el lenguaje (Python → TS) y que acá vive desde el día uno, no en una rama
 * sin pushear.
 *
 * La lección central (commit `5240ec9`, "Uruguay $0.56 → 641× ROAS"): CUALQUIER recomendación
 * sobre un segmento necesita un umbral de VOLUMEN MÍNIMO antes de accionar, o vas a mandar
 * presupuesto hacia ruido estadístico.
 */

/** Umbrales de accionabilidad. Salidos del incidente de Uruguay: por debajo, "observar". */
export const MIN_GASTO_USD = 50;
export const MIN_VENTAS = 3;

/** Los cortes de ROAS. Estos son los del CÓDIGO real (≥4 / <2), no los de la prosa (≥3 / <1). */
export const ROAS_ESCALAR = 4;
export const ROAS_RECORTAR = 2;

/** El ROAS objetivo, para calcular cuánta plata hay en juego en un segmento. */
const ROAS_OBJETIVO = 4;

export type Segmento = {
  /** País, producto, campaña… lo que se esté cortando. */
  nombre: string;
  gastoUsd: number;
  ventasUsd: number;
  /** Cantidad de ventas — el volumen que decide la confianza. */
  ventas: number;
};

export type Accion =
  | "escalar" //     ROAS alto, con volumen: subir presupuesto
  | "recortar" //    ROAS bajo, con volumen: bajar presupuesto
  | "mantener" //    ROAS medio: no tocar
  | "observar" //    volumen insuficiente: mirar, NO accionar (el caso Uruguay)
  | "sin_ventas" //  gasta y no vende: posible problema de atribución, no "recortá" a ciegas
  | "sin_gasto"; //  vende sin gastar: demanda orgánica

export type Confianza = "alta" | "media" | "baja";

/**
 * Divide, pero devuelve `null` —nunca 0— cuando el denominador es 0.
 *
 * Un ROAS de "0" y un ROAS de "no medible" son cosas distintas. Confundirlos es el bug exacto que
 * el dashboard tiene en producción: `inversion = agg or 0` → si el sync no corrió, la utilidad da
 * igual a las ventas y la pantalla muestra un badge verde de 100% de margen.
 */
export function safeDiv(a: number, b: number): number | null {
  return b === 0 ? null : a / b;
}

/**
 * ¿Qué hacer con este segmento?
 *
 * El orden importa: primero los casos de "no hay con qué decidir" (sin gasto, sin ventas, volumen
 * insuficiente), y recién después el ROAS. Un ROAS espectacular con 4 ventas NO es accionable.
 */
export function clasificar(s: Segmento): Accion {
  if (s.gastoUsd === 0) return s.ventasUsd > 0 ? "sin_gasto" : "observar";
  if (s.ventas === 0 || s.ventasUsd === 0) return "sin_ventas";

  // El portón de Uruguay: sin volumen mínimo, no se acciona — pase lo que pase el ROAS.
  if (s.gastoUsd < MIN_GASTO_USD || s.ventas < MIN_VENTAS) return "observar";

  const roas = s.ventasUsd / s.gastoUsd;
  if (roas >= ROAS_ESCALAR) return "escalar";
  if (roas < ROAS_RECORTAR) return "recortar";
  return "mantener";
}

/**
 * Cuánto podemos creerle al número. Entra al score como MULTIPLICADOR (en el dashboard), no como
 * sumando — así un ROAS altísimo con 2 ventas nunca se ve accionable.
 */
export function confianza(ventas: number, gastoUsd: number): Confianza {
  if (ventas >= 30 && gastoUsd >= 500) return "alta";
  if (ventas >= 5 && gastoUsd >= 100) return "media";
  return "baja";
}

/**
 * La plata en juego, en dólares de PRESUPUESTO. Es lo que hay que priorizar — no el ROAS crudo.
 *
 * Un país con ROAS 8 pero $20 de gasto mueve menos aguja que uno con ROAS 3 y $5.000. Rankear por
 * ROAS persigue el ratio lindo de bajo volumen; rankear por esto persigue la plata.
 *
 * ── EL BUG DIMENSIONAL QUE ESTO ARREGLA ──
 * La fórmula era `|objetivo − roas| × gasto`. Eso NO tiene unidades de presupuesto: son unidades de
 * FACTURACIÓN. Desarmándola:
 *
 *     |objetivo − roas| × gasto  =  |objetivo·gasto − ventas|  =  objetivo × |gasto − ventas/objetivo|
 *
 * O sea: era exactamente CUATRO VECES la cifra correcta. Y en `recortar` producía imposibles —
 * un país con $5.000 de gasto y ROAS 0,5 daba «$17.500 de desperdicio», más plata de la que
 * existió jamás. No se puede desperdiciar más de lo que se gastó. La pantalla imprimía ese número
 * como plata recuperable.
 *
 * ── La fórmula correcta, y es UNA SOLA para los dos lados ──
 * El nivel de gasto en el que este segmento rendiría justo el objetivo es `ventas / objetivo`.
 * La distancia entre ese techo y el gasto real ES la plata en juego:
 *
 *     margen = ventas/objetivo − gasto
 *       > 0  → ESCALAR:  cabe ese presupuesto más antes de caer al objetivo.
 *       < 0  → RECORTAR: ese presupuesto está de más. Y su tope natural es el gasto entero:
 *                        con ventas = 0 el desperdicio es exactamente el gasto, nunca más.
 *
 * Sigue siendo una estimación LINEAL —no modela rendimientos decrecientes— y eso se dice en el
 * texto de cada recomendación (`analisis/explicar.ts`), no en una nota al pie.
 */
export function oportunidadUsd(s: Segmento): number {
  if (s.gastoUsd === 0) return 0;
  return Math.abs(s.ventasUsd / ROAS_OBJETIVO - s.gastoUsd);
}
