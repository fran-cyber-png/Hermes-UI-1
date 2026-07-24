import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { diaLimaISO } from "../lib/horaLima.js";

/**
 * «HOY» Y «7 DÍAS» POR VENDEDORA — extraído de `routes/dashboard.ts` (mismo
 * motivo que `dashboard/series.ts`: testear el SQL contra una base de
 * verdad, harness #33).
 *
 * Solo el corte de «hoy» tenía el bug de #4 (`e.creado_at::date = now()::date`
 * comparaba en UTC). El de «7 días» (`creado_at > now() - interval '7 days'`)
 * es una ventana RODANTE, no un corte de calendario — no depende de en qué
 * zona horaria cae la medianoche, así que se queda tal cual (evaluado y
 * descartado a propósito, no un olvido).
 *
 * SEGUNDO BUG, heredado del SQL viejo de `routes/dashboard.ts` y que este
 * seam heredó sin querer: `envios` y `ventas` entraban CRUDAS (una fila por
 * envío / por venta) y las dos se unían a `v` por `vendedora_id` — un
 * producto cartesiano. Una vendedora con 10 envíos y 3 ventas históricas
 * (¡ni siquiera de hoy: las CTEs no filtraban fecha!) veía 10×3 = 30 filas
 * antes de agregar. `count(DISTINCT …)` sobrevive a eso (colapsa los
 * duplicados), pero `count(e.*)` — sin DISTINCT, usado para `mensajes_hoy` y
 * `mensajes_7d` — no: reportaba 30 en vez de 10.
 *
 * El fix es pre-agregar por `vendedora_id` DENTRO de cada CTE, así cada una
 * ya llega con una sola fila por vendedora y el `LEFT JOIN` final es 1-a-1
 * — no hay cartesiano posible porque no hay nada que multiplicar.
 */

// `type`, no `interface` — ver la nota en `dashboard/series.ts` (execute<T>
// exige un T asignable a Record<string, unknown>).
export type FilaPorVendedora = {
  vendedora: string;
  conversaciones_hoy: number;
  mensajes_hoy: number;
  ventas_hoy: number;
  conversaciones_7d: number;
  mensajes_7d: number;
  ventas_7d: number;
};

export async function consultarPorVendedora(base: typeof db, ahora: Date): Promise<FilaPorVendedora[]> {
  const hoy = diaLimaISO(ahora);

  return base.execute<FilaPorVendedora>(sql`
    WITH envios AS (
      -- Ya agregada por vendedora: UNA fila por vendedora_id, no una por envío.
      SELECT
        vendedora_id,
        count(DISTINCT telefono) FILTER (WHERE (creado_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int AS conversaciones_hoy,
        count(*) FILTER (WHERE (creado_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int                 AS mensajes_hoy,
        count(DISTINCT telefono) FILTER (WHERE creado_at > now() - interval '7 days')::int AS conversaciones_7d,
        count(*) FILTER (WHERE creado_at > now() - interval '7 days')::int                 AS mensajes_7d
      FROM envios_wa
      WHERE estado = 'enviado'
      GROUP BY vendedora_id
    ),
    ventas AS (
      -- Ídem: UNA fila por vendedora_id.
      SELECT
        vendedora_id,
        count(*) FILTER (WHERE (iniciada_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int AS ventas_hoy,
        count(*) FILTER (WHERE iniciada_at > now() - interval '7 days')::int                         AS ventas_7d
      FROM conversiones_wa
      GROUP BY vendedora_id
    )
    SELECT
      v.vendedora_id                        AS vendedora,
      COALESCE(e.conversaciones_hoy, 0)     AS conversaciones_hoy,
      COALESCE(e.mensajes_hoy, 0)           AS mensajes_hoy,
      COALESCE(vt.ventas_hoy, 0)            AS ventas_hoy,
      COALESCE(e.conversaciones_7d, 0)      AS conversaciones_7d,
      COALESCE(e.mensajes_7d, 0)            AS mensajes_7d,
      COALESCE(vt.ventas_7d, 0)             AS ventas_7d
    FROM (SELECT DISTINCT vendedora_id FROM envios_wa
          UNION SELECT DISTINCT vendedora_id FROM conversiones_wa) v
    -- 1-a-1: cada CTE ya trae una sola fila por vendedora_id, así que este JOIN
    -- no puede multiplicar nada (el bug del cartesiano era estructural, no un
    -- descuido puntual del FILTER).
    LEFT JOIN envios e ON e.vendedora_id = v.vendedora_id
    LEFT JOIN ventas vt ON vt.vendedora_id = v.vendedora_id
    ORDER BY mensajes_7d DESC
  `);
}
