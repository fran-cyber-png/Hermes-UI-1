import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { aUsd } from "./geo.js";

/**
 * Ventas reales por país del cliente, en USD, desde el espejo de Cerberus.
 *
 * Es la mitad de ventas del cruce geográfico. La otra mitad (gasto por país de audiencia) viene
 * del snapshot de pauta de Meta. Juntas dan el ROAS real por país — con el lazo cerrado debajo,
 * que es lo que el dashboard no tiene.
 *
 * Las tres reglas de Cerberus, aplicadas:
 *   · Solo ventas realmente cobradas (estado 1 Pagado, 9 Pagado por crédito).
 *   · Monto a USD con la tasa CONGELADA de la venta (radio_multiplicador_usado), no la de hoy.
 *   · País del CLIENTE (tb_cliente → tb_pais), no de la sede que registró la venta.
 */

export type VentaPaisUsd = { pais: string; ventasUsd: number; ventas: number };

/**
 * Ventas por país, en USD. Sin `desde`/`hasta` es el ACUMULADO real (las barras de COMPRA). Con
 * ventana (ISO) se acota por `fecha_venta` — necesario para el ROAS por país, que tiene que comparar
 * ventas y gasto del MISMO intervalo; si no, dividir ventas de todo el histórico por el gasto de 90
 * días da un ROAS inflado y falso. El ROAS pasa AMBAS cotas (las del snapshot) para que numerador y
 * denominador cubran exactamente el mismo período.
 */
export async function ventasPorPais(
  desde: string | null = null,
  hasta: string | null = null,
): Promise<VentaPaisUsd[]> {
  const fDesde = desde ? sql`AND (v.payload->>'fecha_venta')::timestamp >= ${desde}::timestamp` : sql``;
  const fHasta = hasta ? sql`AND (v.payload->>'fecha_venta')::timestamp <= ${hasta}::timestamp` : sql``;
  const filas = (await db.execute(sql`
    SELECT pa.payload->>'nombre_pais'                         AS pais,
           v.payload->>'monto_total'                          AS monto,
           v.payload->>'radio_multiplicador_usado'           AS radio,
           m.payload->>'radio_multiplicador'                  AS radio_moneda,
           m.payload->>'nombre_moneda'                        AS moneda_iso
    FROM fuentes.registro v
    LEFT JOIN fuentes.registro cl
      ON cl.fuente='cerberus' AND cl.tabla='tb_cliente' AND cl.clave = v.payload->>'codigo_cliente'
    LEFT JOIN fuentes.registro pa
      ON pa.fuente='cerberus' AND pa.tabla='tb_pais' AND pa.clave = cl.payload->>'id_pais'
    LEFT JOIN fuentes.registro m
      ON m.fuente='cerberus' AND m.tabla='tb_moneda' AND m.clave = v.payload->>'codigo_moneda'
    WHERE v.fuente='cerberus' AND v.tabla='tb_venta'
      AND (v.payload->>'estado')::int IN (1, 9)   -- solo cobradas de verdad
      ${fDesde} ${fHasta}
  `)) as unknown as {
    pais: string | null;
    monto: string;
    radio: string | null;
    radio_moneda: string | null;
    moneda_iso: string | null;
  }[];

  const porPais = new Map<string, { ventasUsd: number; ventas: number }>();

  for (const f of filas) {
    const pais = f.pais?.trim() || "Sin país";
    // USD pasa DERECHO: su monto ya está en dólares. Es el 36% de las ventas y en Cerberus no traen
    // radio (2.306 de 2.307 vienen sin él); sin este passthrough se descartaban TODAS en silencio.
    let usd: number | null;
    if ((f.moneda_iso ?? "").trim().toUpperCase() === "USD") {
      usd = Number(f.monto);
    } else {
      // El radio congelado en la venta manda; si falta (viejas migradas), cae al de la moneda.
      const radio = Number(f.radio) || Number(f.radio_moneda) || null;
      usd = aUsd(Number(f.monto), radio);
    }
    if (usd == null || !Number.isFinite(usd)) continue; // sin tasa no se inventa: se descarta

    const prev = porPais.get(pais) ?? { ventasUsd: 0, ventas: 0 };
    prev.ventasUsd += usd;
    prev.ventas += 1;
    porPais.set(pais, prev);
  }

  return [...porPais.entries()]
    .map(([pais, v]) => ({ pais, ventasUsd: Math.round(v.ventasUsd), ventas: v.ventas }))
    .sort((a, b) => b.ventasUsd - a.ventasUsd);
}
