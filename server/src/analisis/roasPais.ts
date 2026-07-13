import { cruzarPorPais, type GastoPais } from "./geo.js";
import { clasificar, confianza, oportunidadUsd, safeDiv, type Accion, type Confianza } from "./roas.js";
import type { VentaPaisUsd } from "./ventasPorPais.js";

/**
 * EL ROAS REAL POR PAÍS — lo que el dashboard nunca tuvo junto: gasto y ventas, bien atribuidos.
 *
 * Gasto por país de la AUDIENCIA (Meta) × ventas por país del CLIENTE (Cerberus), cruzados por país
 * normalizado, y pasados por el cerebro de ROAS ya probado: escalar / recortar / mantener / observar
 * / sin_ventas / sin_gasto, con el portón de volumen mínimo (el caso Uruguay $0,56 → 641×) para no
 * accionar sobre ruido. Se ordena por PLATA EN JUEGO (oportunidad), no por el ROAS crudo: un país
 * con ROAS 8 y $20 mueve menos aguja que uno con ROAS 3 y $5.000.
 *
 * `roas` es `null`, no 0, cuando no se puede dividir (gasto 0): "no medible" y "cero" son cosas
 * distintas, y confundirlas es el bug clásico que pinta de verde un margen que no existe.
 */

export type RoasPais = {
  pais: string;
  gastoUsd: number;
  ventasUsd: number;
  ventas: number;
  /** null cuando no hay gasto: no medible ≠ cero. */
  roas: number | null;
  accion: Accion;
  confianza: Confianza;
  /** La plata en juego, en USD. Es el criterio de orden, no el ROAS. */
  oportunidadUsd: number;
};

export function roasPorPais(gasto: GastoPais[], ventas: VentaPaisUsd[]): RoasPais[] {
  const segmentos = cruzarPorPais(
    gasto,
    ventas.map((v) => ({ pais: v.pais, ventasUsd: v.ventasUsd, ventas: v.ventas })),
  );

  return segmentos
    .map((s) => ({
      pais: s.nombre,
      gastoUsd: Math.round(s.gastoUsd),
      ventasUsd: Math.round(s.ventasUsd),
      ventas: s.ventas,
      roas: safeDiv(s.ventasUsd, s.gastoUsd),
      accion: clasificar(s),
      confianza: confianza(s.ventas, s.gastoUsd),
      oportunidadUsd: Math.round(oportunidadUsd(s)),
    }))
    .sort((a, b) => b.oportunidadUsd - a.oportunidadUsd);
}
