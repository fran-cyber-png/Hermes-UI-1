import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { VentaConfirmada } from "../lazo/evento.js";
import type { Pais } from "../lazo/normalizar.js";

/**
 * De `fuentes.registro` (el espejo crudo de Cerberus) a la forma que el lazo necesita.
 *
 * Acá se aplica NUESTRA opinión: qué es una compra, cuándo ocurrió, quién la hizo. El espejo no
 * opina; este módulo sí, y por eso está separado y es reconstruible.
 *
 * Los nombres de columna son los REALES del dump — Cerberus usa `codigo_*`, no `id`.
 *
 * ── Las tres trampas de Cerberus, verificadas en su historia de git ──
 *
 * 1. `monto_pagado` NO se suma con SQL ingenuo. Un pago DENEGADO (estado 3/4) seguía contando
 *    como cobrado — bug real que ya los mordió (commit `c8da797`). Filtramos por estado. Siempre.
 *
 * 2. La compra NO es `estado = 1 (Pagado)`. Ese estado solo aparece cuando se pagan TODAS las
 *    cuotas, y el 9,9% paga en cuotas (meses). El gatillo es la PRIMERA cuota confirmada.
 *
 * 3. `fecha_pago` la TIPEA EL ASESOR (mediana 0 días — autoreportada). El único timestamp
 *    confiable es `fecha_confirmacion`: cuando Tesorería miró el voucher y lo aceptó.
 */

/** Estados de `tb_pago` que cuentan como dinero real (1 Procesando, 2 Completado). Los demás NO. */
const PAGO_VALIDO = sql`(p.payload->>'estado')::int IN (1, 2)`;

/** Nombre de país en Cerberus → código ISO. Solo los que a Meta le importan para normalizar tel. */
const PAISES: Record<string, Pais> = {
  Perú: "PE",
  Bolivia: "BO",
  México: "MX",
  Chile: "CL",
  Colombia: "CO",
  Ecuador: "EC",
  Guatemala: "GT",
  Honduras: "HN",
  Panamá: "PA",
  "República Dominicana": "DO",
  Paraguay: "PY",
  Uruguay: "UY",
  Argentina: "AR",
  "Estados Unidos": "US",
};

type FilaVenta = {
  folio: string;
  estado: string;
  monto_total: string;
  moneda: string | null;
  confirmada_at: string | null;
  email: string | null;
  telefono: string | null;
  pais: string | null;
};

/**
 * Las ventas listas para el lazo.
 *
 * El país sale del CLIENTE (`tb_cliente → tb_pais`), NUNCA de una columna de la venta: en Cerberus
 * el país de la venta suele ser la sede que la registró, no de dónde es el comprador.
 * goberna-dashboard aprendió esto de la peor forma — México pasó de ROAS 1,59 a 4,06 al corregirlo.
 *
 * `tb_moneda.nombre_moneda` ya viene en ISO-4217 (USD, PEN, BOB…), así que no hay que convertir.
 */
export async function ventasParaElLazo(): Promise<VentaConfirmada[]> {
  const filas = (await db.execute(sql`
    WITH confirmacion AS (
      -- La confirmación de Tesorería es la fecha de compra. Pero 5.228 pagos viejos, migrados del
      -- Excel, no tienen fecha_confirmacion (son de 2024). Para esos usamos fecha_pago como
      -- respaldo: igual son históricos, así que caen en "historico" y van a la audiencia de valor,
      -- no al lazo con ventana. Sin el respaldo aparecían como "sin confirmar" (71% de las ventas),
      -- lo cual es falso: sí se cobraron, solo les falta el timestamp.
      SELECT c.payload->>'codigo_venta'                              AS venta,
             min(coalesce(
               (p.payload->>'fecha_confirmacion')::timestamptz,
               (p.payload->>'fecha_pago')::timestamptz
             ))                                                       AS confirmada_at
      FROM fuentes.registro p
      JOIN fuentes.registro c
        ON c.fuente='cerberus' AND c.tabla='tb_cuotas'
       AND c.clave = p.payload->>'codigo_cuota'
      WHERE p.fuente='cerberus' AND p.tabla='tb_pago'
        AND ${PAGO_VALIDO}                                       -- ← trampa #1
      GROUP BY 1
    )
    SELECT v.payload->>'folio_venta'  AS folio,
           v.payload->>'estado'       AS estado,
           v.payload->>'monto_total'  AS monto_total,
           m.payload->>'nombre_moneda' AS moneda,
           cf.confirmada_at::text     AS confirmada_at,
           (SELECT co.payload->>'nombre_correo' FROM fuentes.registro co
             WHERE co.fuente='cerberus' AND co.tabla='tb_correo'
               AND co.payload->>'codigo_cliente' = v.payload->>'codigo_cliente' LIMIT 1)  AS email,
           (SELECT concat(te.payload->>'prefijo', te.payload->>'numero_telefono')
              FROM fuentes.registro te
             WHERE te.fuente='cerberus' AND te.tabla='tb_telefono'
               AND te.payload->>'codigo_cliente' = v.payload->>'codigo_cliente' LIMIT 1)  AS telefono,
           pa.payload->>'nombre_pais' AS pais
    FROM fuentes.registro v
    LEFT JOIN confirmacion cf ON cf.venta = v.clave
    LEFT JOIN fuentes.registro m
      ON m.fuente='cerberus' AND m.tabla='tb_moneda' AND m.clave = v.payload->>'codigo_moneda'
    LEFT JOIN fuentes.registro cl
      ON cl.fuente='cerberus' AND cl.tabla='tb_cliente' AND cl.clave = v.payload->>'codigo_cliente'
    LEFT JOIN fuentes.registro pa
      ON pa.fuente='cerberus' AND pa.tabla='tb_pais' AND pa.clave = cl.payload->>'codigo_pais'
    WHERE v.fuente='cerberus' AND v.tabla='tb_venta'
  `)) as unknown as FilaVenta[];

  return filas.map((f) => ({
    folio: f.folio,
    estado: Number(f.estado),
    montoTotal: Number(f.monto_total),
    // `nombre_moneda` ya es ISO. Si faltara, mandamos "" para que Meta rechace con error claro,
    // nunca un `?? 'USD'` que convertiría 1.400.000 pesos colombianos en 1.400.000 dólares.
    moneda: f.moneda ?? "",
    confirmadaAt: f.confirmada_at ? new Date(f.confirmada_at) : null,
    cliente: {
      email: f.email,
      telefono: f.telefono,
      pais: f.pais ? (PAISES[f.pais.trim()] ?? null) : null,
    },
  }));
}
