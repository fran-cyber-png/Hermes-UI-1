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
      SELECT vendedora_id, telefono, creado_at FROM envios_wa WHERE estado = 'enviado'
    ),
    ventas AS (
      SELECT vendedora_id, iniciada_at FROM conversiones_wa
    )
    SELECT
      v.vendedora_id AS vendedora,
      count(DISTINCT e.telefono) FILTER (WHERE (e.creado_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int AS conversaciones_hoy,
      count(e.*) FILTER (WHERE (e.creado_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int                 AS mensajes_hoy,
      count(DISTINCT vt.iniciada_at) FILTER (WHERE (vt.iniciada_at AT TIME ZONE 'America/Lima')::date = ${hoy}::date)::int AS ventas_hoy,
      count(DISTINCT e.telefono) FILTER (WHERE e.creado_at > now() - interval '7 days')::int AS conversaciones_7d,
      count(e.*) FILTER (WHERE e.creado_at > now() - interval '7 days')::int         AS mensajes_7d,
      count(DISTINCT vt.iniciada_at) FILTER (WHERE vt.iniciada_at > now() - interval '7 days')::int AS ventas_7d
    FROM (SELECT DISTINCT vendedora_id FROM envios_wa
          UNION SELECT DISTINCT vendedora_id FROM conversiones_wa) v
    LEFT JOIN envios e ON e.vendedora_id = v.vendedora_id
    LEFT JOIN ventas vt ON vt.vendedora_id = v.vendedora_id
    GROUP BY v.vendedora_id
    ORDER BY mensajes_7d DESC
  `);
}
