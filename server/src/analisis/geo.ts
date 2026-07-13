import type { Segmento } from "./roas.js";

/**
 * Atribución geográfica, portada de `goberna-dashboard/core/services/geo_report.py`.
 *
 * Dos decisiones que el dashboard aprendió a los golpes (caso México: ROAS 1,59 mal atribuido →
 * 4,06 bien atribuido, casi recortan el mejor país):
 *
 *   1. Gasto → por país de la AUDIENCIA alcanzada (breakdown de Meta), no de la cuenta. La cuenta
 *      "Perú" gasta ~45% en audiencias no peruanas.
 *   2. Ventas → por país del CLIENTE (`tb_cliente → tb_pais`), no de la sede que registró la venta.
 */

/** Normaliza un nombre de país para unir 'Perú' / 'peru' / 'PERÚ'. Sin tildes, minúsculas, trim. */
export function normalizarPais(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // saca las tildes
    .trim()
    .toLowerCase();
}

/**
 * Convierte a USD con la tasa CONGELADA de la venta (Cerberus la guarda en `radio_multiplicador`).
 *
 * NO recalcula con la tasa de hoy: una venta vieja daría un monto distinto al que realmente entró.
 * Y un radio 0 —caso real y recurrente en Cerberus, moneda mal configurada— cae a null en vez de
 * dividir por cero o multiplicar por cero en silencio.
 */
export function aUsd(monto: number, radioMultiplicador: number | null): number | null {
  if (!radioMultiplicador) return null; // 0, null o undefined: no se puede convertir
  return Math.round((monto / radioMultiplicador) * 100) / 100;
}

export type GastoPais = { pais: string; gastoUsd: number };
export type VentaPais = { pais: string; ventasUsd: number; ventas: number };

/**
 * Cruza el gasto (por país de audiencia) con las ventas (por país de cliente), uniendo por país
 * normalizado. Devuelve un `Segmento` por país, listo para el cerebro de ROAS.
 *
 * Un país con gasto y sin ventas aparece igual, con ventas en 0 — para VERLO (puede ser un
 * problema de atribución), no para esconderlo detrás de un promedio.
 */
export function cruzarPorPais(gasto: GastoPais[], ventas: VentaPais[]): Segmento[] {
  const porPais = new Map<string, { nombre: string; gastoUsd: number; ventasUsd: number; ventas: number }>();

  for (const g of gasto) {
    const k = normalizarPais(g.pais);
    const prev = porPais.get(k) ?? { nombre: g.pais, gastoUsd: 0, ventasUsd: 0, ventas: 0 };
    prev.gastoUsd += g.gastoUsd;
    porPais.set(k, prev);
  }

  for (const v of ventas) {
    const k = normalizarPais(v.pais);
    // El nombre "bonito" lo pone el lado del gasto (Meta) si existe; si no, el de la venta.
    const prev = porPais.get(k) ?? { nombre: v.pais, gastoUsd: 0, ventasUsd: 0, ventas: 0 };
    prev.ventasUsd += v.ventasUsd;
    prev.ventas += v.ventas;
    porPais.set(k, prev);
  }

  return [...porPais.values()];
}
