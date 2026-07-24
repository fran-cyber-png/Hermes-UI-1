import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { corteDiasAtras, diaLimaISO } from "../lib/horaLima.js";

/**
 * LAS SERIES DE 14 DÍAS DEL DASHBOARD — extraídas de `routes/dashboard.ts` a
 * este seam para poder testearlas contra una base de verdad (harness #33,
 * mismo patrón que `cola/consultarCola.ts`): reciben `db` INYECTADO — la ruta
 * le pasa el singleton, el test su base de prueba.
 *
 * EL BUG QUE ESTO ARREGLA (#4): las series usaban `now()::date` — el corte de
 * día en UTC, no en hora de Lima donde vive el negocio. Entre las 19:00 y la
 * medianoche de Lima (00:00–05:00 UTC del día siguiente), un lead de HOY se
 * contaba como de MAÑANA: el gráfico de columnas y "esta semana vs. la
 * pasada" mentían justo en la punta más caliente del día.
 *
 * El fix: el "hoy" y el corte de "N días atrás" se calculan UNA vez en JS
 * (`lib/horaLima.ts`, puro y testeado aparte) a partir de un solo `ahora` —el
 * mismo reloj que ya usa `ordenarRadar` en `routes/dashboard.ts`, para que el
 * radar y las series nunca miren dos "hoy" distintos— y viajan como
 * parámetros bindeados. Del lado de la columna, `(col AT TIME ZONE
 * 'America/Lima')::date` hace el mismo corte para cada fila, sin importar en
 * qué zona horaria esté configurada la sesión de Postgres.
 *
 * Sigue sin haber índice por expresión sobre estas columnas (son btree planas
 * sobre el timestamptz — ver `db/schema.ts`), así que el corte por IGUALDAD
 * (`... ::date = ...`) no lo usa, ni antes ni ahora: no se rompe nada que ya
 * funcionara. Los filtros de RANGO (`occurred_at > corte`) sí siguen pudiendo
 * usar el índice, porque el corte es un valor de columna (timestamptz)
 * bindeado, no una expresión sobre `now()`.
 */

// `type`, no `interface`: drizzle exige que el genérico de `execute<T>` sea
// asignable a `Record<string, unknown>`, y TS solo le da ese índice implícito
// a los tipos objeto — una `interface` con las mismas propiedades lo rechaza.
export type PuntoDia = {
  dia: string;
  n: number;
};

export type PuntoLeadsDia = {
  dia: string;
  chats: number;
  comentarios: number;
  formularios: number;
};

export interface SeriesDashboard {
  leads_dia: PuntoLeadsDia[];
  envios_dia: PuntoDia[];
  ventas_dia: PuntoDia[];
}

/** Los 14 puntos (hoy y los 13 días previos, calendario de Lima) para un `generate_series`. */
function rangoDias(hoy: string) {
  return sql`generate_series(${hoy}::date - 13, ${hoy}::date, interval '1 day')::date`;
}

export async function consultarSeriesDashboard(base: typeof db, ahora: Date): Promise<SeriesDashboard> {
  const hoy = diaLimaISO(ahora);
  // postgres.js serializa un `Date` crudo distinto según el camino: el `sql`
  // TAGGED de la librería `postgres` lo detecta y lo formatea solo, pero el
  // `execute()` de drizzle (el que usamos acá) baja los params por el bind de
  // `unsafe()`, que espera texto/Buffer — un `Date` ahí revienta con
  // `ERR_INVALID_ARG_TYPE` en `Buffer.byteLength` (se vio recién en CI: los
  // params $1/$2 —strings— andaban bien, $3-$5 —objetos Date— no). El resto
  // del repo ya resuelve esto así (`analisis/ventasPorPais.ts`): el corte
  // viaja como STRING ISO, con el cast explícito `::timestamptz` puesto acá,
  // no confiado a la inferencia de Postgres.
  const corte = corteDiasAtras(ahora, 13).toISOString();

  const leadsDia = await base.execute<PuntoLeadsDia>(sql`
    WITH dias AS (
      SELECT ${rangoDias(hoy)} AS dia
    ),
    c AS (
      SELECT (occurred_at AT TIME ZONE 'America/Lima')::date AS dia, count(DISTINCT (canal, persona_id))::int AS n
      FROM interactions
      WHERE tipo = 'mensaje' AND direccion = 'entrante' AND persona_id IS NOT NULL
        AND occurred_at > ${corte}::timestamptz
      GROUP BY 1
    ),
    co AS (
      SELECT (occurred_at AT TIME ZONE 'America/Lima')::date AS dia, count(*)::int AS n
      FROM interactions
      WHERE tipo = 'comentario' AND occurred_at > ${corte}::timestamptz
      GROUP BY 1
    ),
    f AS (
      SELECT (created_time AT TIME ZONE 'America/Lima')::date AS dia, count(*)::int AS n
      FROM leads
      WHERE created_time > ${corte}::timestamptz
      GROUP BY 1
    )
    SELECT d.dia::text AS dia,
           COALESCE(c.n, 0) AS chats,
           COALESCE(co.n, 0) AS comentarios,
           COALESCE(f.n, 0) AS formularios
    FROM dias d
    LEFT JOIN c ON c.dia = d.dia
    LEFT JOIN co ON co.dia = d.dia
    LEFT JOIN f ON f.dia = d.dia
    ORDER BY d.dia
  `);

  const enviosDia = await base.execute<PuntoDia>(sql`
    WITH dias AS (
      SELECT ${rangoDias(hoy)} AS dia
    )
    SELECT d.dia::text AS dia, COALESCE(e.n, 0) AS n
    FROM dias d
    LEFT JOIN (
      SELECT (creado_at AT TIME ZONE 'America/Lima')::date AS dia, count(*)::int AS n
      FROM envios_wa WHERE estado = 'enviado' AND creado_at > ${corte}::timestamptz
      GROUP BY 1
    ) e ON e.dia = d.dia
    ORDER BY d.dia
  `);

  const ventasDia = await base.execute<PuntoDia>(sql`
    WITH dias AS (
      SELECT ${rangoDias(hoy)} AS dia
    )
    SELECT d.dia::text AS dia, COALESCE(v.n, 0) AS n
    FROM dias d
    LEFT JOIN (
      SELECT (iniciada_at AT TIME ZONE 'America/Lima')::date AS dia, count(*)::int AS n
      FROM conversiones_wa WHERE iniciada_at > ${corte}::timestamptz
      GROUP BY 1
    ) v ON v.dia = d.dia
    ORDER BY d.dia
  `);

  return { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia };
}
