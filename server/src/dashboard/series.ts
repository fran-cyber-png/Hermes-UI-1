import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { corteDiasAtras, diaLimaISO } from "../lib/horaLima.js";
import { diaLimaSql } from "../lib/horaLimaSql.js";
import { clavesAsignadasSql, mismaVendedoraSql } from "./personal.js";
import { sinLineaVedadaSql } from "../numeros/campana.js";

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
 * funcionara. Los filtros de RANGO (`occurred_at >= corte`) sí siguen pudiendo
 * usar el índice, porque el corte es un valor de columna (timestamptz)
 * bindeado, no una expresión sobre `now()`.
 *
 * `corte` es la MEDIANOCHE de Lima del día más viejo de la ventana (hace 13
 * días) — ese instante exacto SÍ pertenece al bucket más viejo (`dias` lo
 * genera igual, a partir de `hoy`, no de `corte`). El filtro tiene que ser
 * `>=`, no `>`: con `>` estricto, un evento que ocurre justo en esa
 * medianoche desaparecía de una serie que sí tiene el día para recibirlo.
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

/**
 * EL RECORTE PERSONAL, APLICADO A LAS TRES SERIES (Dashboard personal, 5-ago-2026).
 *
 * Cada una se acota por donde se puede acotar, y no todas por lo mismo:
 *
 *  · **leads/día** por la CLAVE de la conversación asignada. Eso obliga a mirar
 *    el `numeroPropio`, que vive en el payload del evento — o sea el join a
 *    `events` que la versión entera no necesita. Se paga **solo cuando hay
 *    recorte**: sin él la consulta queda idéntica a la de siempre.
 *  · **envíos/día** y **ventas/día** por `vendedora_id`, que es lo que esas dos
 *    tablas guardan. No es la misma pregunta que «mis conversaciones» y hay que
 *    saberlo: son los mensajes que MANDÉ y las ventas que REGISTRÉ, aunque la
 *    conversación fuera de otra. Acotarlas por clave sería más consistente y más
 *    falso — `envios_wa` no tiene clave de conversación, tiene teléfono.
 *
 * Los comentarios de FB/IG y los formularios se van a cero con el recorte puesto:
 * no tienen dueño posible (ver `dashboard/personal.ts`).
 */
export async function consultarSeriesDashboard(
  base: typeof db,
  ahora: Date,
  soloAsignadasA: string | null = null,
  /**
   * QUIÉN MIRA — la frontera de campaña (`numeros/campana.ts`), que **no la abre
   * ningún rol**. Es otra pregunta que `soloAsignadasA` («¿de quién es esta
   * conversación?»), y por eso viaja aparte. `undefined` veda toda campaña.
   */
  quienMira?: string,
): Promise<SeriesDashboard> {
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

  // Sin recorte, la rama de siempre: un solo escaneo de `interactions`, sin join.
  const chatsPorDia =
    soloAsignadasA === null
      ? sql`
      SELECT ${diaLimaSql("i.occurred_at")} AS dia, count(DISTINCT (i.canal, i.persona_id))::int AS n
      FROM interactions i
      WHERE i.tipo = 'mensaje' AND i.direccion = 'entrante' AND i.persona_id IS NOT NULL
        AND i.occurred_at >= ${corte}::timestamptz
        AND ${sinLineaVedadaSql(sql`i.numero_propio`, quienMira)}
      GROUP BY 1`
      : sql`
      SELECT ${diaLimaSql("i.occurred_at")} AS dia, count(DISTINCT (i.canal, i.persona_id))::int AS n
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje' AND i.direccion = 'entrante' AND i.persona_id IS NOT NULL
        AND i.occurred_at >= ${corte}::timestamptz
        AND ('conv:' || i.canal || ':' || i.persona_id || ':' ||
             COALESCE(e.payload->>'numeroPropio', '')) IN (${clavesAsignadasSql(soloAsignadasA)})
        AND ${sinLineaVedadaSql(sql`i.numero_propio`, quienMira)}
      GROUP BY 1`;

  // Comentarios y formularios NO tienen dueño posible: con recorte, la serie dice
  // cero de verdad. `WHERE false` y no borrar la CTE, así el SELECT de abajo no
  // cambia de forma según quién pregunte.
  const sinDuenoPosible = soloAsignadasA === null ? sql`TRUE` : sql`FALSE`;

  const leadsDia = await base.execute<PuntoLeadsDia>(sql`
    WITH dias AS (
      SELECT ${rangoDias(hoy)} AS dia
    ),
    c AS (${chatsPorDia}),
    co AS (
      SELECT ${diaLimaSql("occurred_at")} AS dia, count(*)::int AS n
      FROM interactions
      WHERE ${sinDuenoPosible} AND tipo = 'comentario' AND occurred_at >= ${corte}::timestamptz
      GROUP BY 1
    ),
    f AS (
      SELECT ${diaLimaSql("created_time")} AS dia, count(*)::int AS n
      FROM leads
      WHERE ${sinDuenoPosible} AND created_time >= ${corte}::timestamptz
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
      SELECT ${diaLimaSql("creado_at")} AS dia, count(*)::int AS n
      FROM envios_wa
      WHERE estado = 'enviado' AND creado_at >= ${corte}::timestamptz
        AND ${mismaVendedoraSql(sql`vendedora_id`, soloAsignadasA)}
        -- envios_wa sí sabe por qué línea salió cada mensaje (numero_propio),
        -- así que la serie de envíos de la Escuela no cuenta los de la campaña.
        -- Medido el 18-ago-2026: 80 envíos por 51963139984 en 30 días.
        AND ${sinLineaVedadaSql(sql`envios_wa.numero_propio`, quienMira)}
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
      SELECT ${diaLimaSql("iniciada_at")} AS dia, count(*)::int AS n
      FROM conversiones_wa
      WHERE iniciada_at >= ${corte}::timestamptz
        AND ${mismaVendedoraSql(sql`vendedora_id`, soloAsignadasA)}
      GROUP BY 1
    ) v ON v.dia = d.dia
    ORDER BY d.dia
  `);

  return { leads_dia: leadsDia, envios_dia: enviosDia, ventas_dia: ventasDia };
}
