import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

/**
 * Ventas por país, en USD. Ahora lee de la CAPA CANÓNICA (`ontologia.venta`), no del jsonb crudo.
 *
 * Toda la semántica difícil —USD passthrough, estado cobrado, país del cliente, tasa congelada— ya
 * está resuelta en la proyección (`ontologia/proyectar.ts`), en un solo lugar. Este análisis quedó
 * trivial: filtra cobradas, agrupa por país, suma. Antes eran 40 líneas de jsonb y un bug de USD que
 * perdía el 36% de las ventas; ahora no puede divergir, porque no re-resuelve nada.
 *
 * Sin `desde`/`hasta` es el ACUMULADO real (las barras de COMPRA). Con ventana (ISO) se acota por
 * `fecha_venta` — necesario para el ROAS por país, que compara ventas y gasto del MISMO intervalo.
 */

export type VentaPaisUsd = { pais: string; ventasUsd: number; ventas: number };

export async function ventasPorPais(
  desde: string | null = null,
  hasta: string | null = null,
): Promise<VentaPaisUsd[]> {
  const fDesde = desde ? sql`AND fecha_venta >= ${desde}::timestamptz` : sql``;
  const fHasta = hasta ? sql`AND fecha_venta <= ${hasta}::timestamptz` : sql``;
  const filas = (await db.execute(sql`
    SELECT coalesce(pais_cliente, 'Sin país') AS pais,
           round(sum(monto_usd))::int         AS ventas_usd,
           count(*)::int                       AS ventas
    FROM ontologia.venta
    WHERE cobrada AND monto_usd IS NOT NULL
      ${fDesde} ${fHasta}
    GROUP BY 1
    ORDER BY 2 DESC
  `)) as unknown as { pais: string; ventas_usd: number; ventas: number }[];

  return filas.map((f) => ({ pais: f.pais, ventasUsd: f.ventas_usd, ventas: f.ventas }));
}
