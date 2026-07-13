import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { VentaConfirmada } from "../lazo/evento.js";
import type { Pais } from "../lazo/normalizar.js";

/**
 * De `fuentes.registro` (el espejo crudo de Cerberus) a la forma que el lazo necesita.
 *
 * Acá es donde se aplica NUESTRA opinión: qué es una compra, cuándo ocurrió, quién la hizo.
 * El espejo no opina; este módulo sí, y por eso está separado y es reconstruible.
 *
 * ── Las tres trampas de Cerberus, todas verificadas en su historia de git ──
 *
 * 1. `Cuota.monto_pagado` NO es un campo ni un `Sum` — es una property de Python que toma el
 *    último `Pago` con estado en {1 Procesando, 2 Completado}, excluyendo {3 No Validado,
 *    4 Denegado}. Un `SUM()` de SQL ingenuo sobre `tb_pago` reintroduce un bug que ya los mordió
 *    (commit `c8da797`): cuotas que Tesorería DENEGÓ seguían contando como cobradas.
 *    → Acá filtramos por estado del pago. Siempre.
 *
 * 2. La compra NO es `Venta.estado = 1 (Pagado)`. Ese estado solo aparece cuando se pagan TODAS
 *    las cuotas, y el 9,9% paga en cuotas (meses). El gatillo es la PRIMERA CUOTA CONFIRMADA.
 *
 * 3. `Pago.fecha_pago` la TIPEA EL ASESOR (mediana: 0 días — es autoreportada, no verificada).
 *    El único timestamp confiable es `Pago.fecha_confirmacion`: cuando alguien de Tesorería miró
 *    el voucher y lo aceptó.
 */

/** Estados de `Pago` que cuentan como dinero real. Los demás (3, 4) NO. */
const PAGO_VALIDO = sql`(p.payload->>'estado')::int IN (1, 2)`;

/** El país del CLIENTE, no el de la sede que registró la venta. */
const PAISES: Record<string, Pais> = {
  Perú: "PE",
  Peru: "PE",
  México: "MX",
  Mexico: "MX",
  Chile: "CL",
  Bolivia: "BO",
  Colombia: "CO",
  Ecuador: "EC",
  Guatemala: "GT",
  Honduras: "HN",
  Panamá: "PA",
  Panama: "PA",
  "República Dominicana": "DO",
  Paraguay: "PY",
  Uruguay: "UY",
  Argentina: "AR",
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
 * El país del cliente sale de `tb_cliente` → `tb_pais`, NUNCA de `tb_venta.pais` (que suele ser
 * la sede que registró la operación, no de dónde es el comprador). goberna-dashboard aprendió
 * esto de la peor forma: **México aparentaba ROAS 1,59 cuando por comprador real era 4,06+.**
 */
export async function ventasParaElLazo(): Promise<VentaConfirmada[]> {
  const filas = (await db.execute(sql`
    WITH pagos AS (
      -- La PRIMERA confirmación de Tesorería de cada venta. Es el momento de la compra.
      SELECT (c.payload->>'id_venta')                          AS venta_id,
             min((p.payload->>'fecha_confirmacion')::timestamptz) AS confirmada_at
      FROM fuentes.registro p
      JOIN fuentes.registro c
        ON c.fuente = 'cerberus' AND c.tabla = 'tb_cuotas'
       AND c.clave = (p.payload->>'id_cuota')
      WHERE p.fuente = 'cerberus' AND p.tabla = 'tb_pago'
        AND ${PAGO_VALIDO}                                  -- ← la trampa #1
        AND p.payload->>'fecha_confirmacion' IS NOT NULL    -- ← la trampa #3
      GROUP BY 1
    ),
    contacto AS (
      -- Un cliente puede tener varios correos y teléfonos (Cerberus ya era un grafo de
      -- identidades). Tomamos el primero de cada uno; la ontología después los guarda todos.
      SELECT cl.clave AS cliente_id,
             (SELECT co.payload->>'nombre_correo' FROM fuentes.registro co
               WHERE co.fuente='cerberus' AND co.tabla='tb_correo'
                 AND co.payload->>'id_cliente' = cl.clave LIMIT 1)  AS email,
             (SELECT concat(te.payload->>'prefijo', te.payload->>'numero')
                FROM fuentes.registro te
               WHERE te.fuente='cerberus' AND te.tabla='tb_telefono'
                 AND te.payload->>'id_cliente' = cl.clave LIMIT 1)  AS telefono,
             (SELECT pa.payload->>'nombre' FROM fuentes.registro pa
               WHERE pa.fuente='cerberus' AND pa.tabla='tb_pais'
                 AND pa.clave = cl.payload->>'id_pais')             AS pais
      FROM fuentes.registro cl
      WHERE cl.fuente='cerberus' AND cl.tabla='tb_cliente'
    )
    SELECT v.payload->>'folio_venta'   AS folio,
           v.payload->>'estado'        AS estado,
           v.payload->>'monto_total'   AS monto_total,
           m.payload->>'nombre'        AS moneda,
           pg.confirmada_at::text      AS confirmada_at,
           ct.email, ct.telefono, ct.pais
    FROM fuentes.registro v
    LEFT JOIN pagos pg ON pg.venta_id = v.clave
    LEFT JOIN contacto ct ON ct.cliente_id = v.payload->>'id_cliente'
    LEFT JOIN fuentes.registro m
      ON m.fuente='cerberus' AND m.tabla='tb_moneda' AND m.clave = v.payload->>'id_moneda'
    WHERE v.fuente='cerberus' AND v.tabla='tb_venta'
  `)) as unknown as FilaVenta[];

  return filas.map((f) => ({
    folio: f.folio,
    estado: Number(f.estado),
    montoTotal: Number(f.monto_total),
    moneda: normalizarMoneda(f.moneda),
    confirmadaAt: f.confirmada_at ? new Date(f.confirmada_at) : null,
    cliente: {
      email: f.email,
      telefono: f.telefono,
      pais: f.pais ? (PAISES[f.pais.trim()] ?? null) : null,
    },
  }));
}

/**
 * Cerberus guarda el nombre de la moneda, no su código ISO. Meta quiere ISO-4217.
 *
 * Si no la reconocemos devolvemos el valor crudo: que Meta rechace el evento con un error claro
 * es mejor que inventarle una moneda que no es. Un `?? 'USD'` acá convertiría 1.400.000 pesos
 * colombianos en 1.400.000 dólares.
 */
function normalizarMoneda(nombre: string | null): string {
  if (!nombre) return "";
  const m: Record<string, string> = {
    Soles: "PEN",
    "Sol Peruano": "PEN",
    Dólares: "USD",
    Dolares: "USD",
    "Peso Mexicano": "MXN",
    Bolivianos: "BOB",
    "Peso Colombiano": "COP",
    "Peso Chileno": "CLP",
    "Peso Dominicano": "DOP",
  };
  const t = nombre.trim();
  return m[t] ?? t;
}
