import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { nivelUrgenciaSql, ordenUrgenciaSql, seguimientosPendientesSql } from "./urgenciaSql.js";

/**
 * LA COLA UNIFICADA — una fila por CONVERSACIÓN, no por mensaje. Extraída de la
 * ruta (`routes/conversaciones.ts`) a este seam para poder testear el SQL contra
 * una base de verdad (harness #33): recibe `db` INYECTADO — la ruta le pasa el
 * singleton, el test su base de prueba.
 *
 *   · Comentarios FB/IG → una fila por comentario.
 *   · Mensajes (WhatsApp/Messenger) → una fila por (canal, persona, número propio).
 *
 * `respondida` es DERIVADA (hay un saliente posterior al último entrante), no un
 * estado de fila. El orden es la urgencia de SEIS niveles de `cola/urgencia.ts`,
 * proyectada a SQL en `cola/urgenciaSql.ts` (#37): esta consulta no define
 * ningún criterio propio, y el test de paridad (`urgencia.paridad.test.db.ts`)
 * falla si la cola y el radar vuelven a ordenar distinto.
 *
 * `ultima_clase` (nuevo): la clase de media del ÚLTIMO mensaje. Cuando el preview
 * no tiene texto (media-only), el front la usa para mostrar «📷 Foto» en vez de
 * «(sin texto)» (#55). Sale del payload del evento (`media.clase`), que ya se
 * guarda al proyectar; no agrega JOIN — `events` ya se une por el número propio.
 */

/** ¿Pide que la contacten? Misma heurística que la bandeja de comentarios. */
const PIDE_INFO = sql`texto ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle)'`;

/** La ventana de 7 días de Meta para el privado. IG también la tiene, no solo FB. */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal IN ('facebook','instagram') AND occurred_at > now() - interval '7 days')`;

/**
 * LA VENTANA DE LA COLA — hasta dónde mira «el trabajo pendiente». 30 días: es el
 * ciclo de venta de la Escuela, no una razón técnica. Sin esta cota el planner ni
 * usa el índice (escanea `events` entero). Medido: 482 ms → 3,4 ms.
 */
const ventanaCola = (columna: SQL) => sql`${columna} > now() - interval '30 days'`;

export interface OpcionesCola {
  canal?: string;
  intencion?: string;
  limit?: number;
  offset?: number;
}

export interface ResultadoCola {
  conversaciones: unknown[];
  total?: number;
  hayMas: boolean;
}

export async function consultarCola(
  base: typeof db,
  opciones: OpcionesCola = {},
): Promise<ResultadoCola> {
  const canal = opciones.canal ?? "";
  const intencion = opciones.intencion ?? "";
  const limit = Math.min(opciones.limit || 40, 100);
  const offset = opciones.offset || 0;

  const filtroCanal = canal ? sql`AND canal = ${canal}` : sql``;

  /** Los comentarios: una fila por interacción. Sin media → `ultima_clase` NULL. */
  const comentarios = sql`
    SELECT
      'int:' || id::text                          AS clave,
      canal, tipo, persona_id, persona_nombre,
      NULL::text                                  AS numero_propio,
      texto, contexto_texto,
      NULL::text                                  AS ultima_clase,
      NULL::jsonb                                 AS ultima_origen,
      occurred_at                                 AS referencia,
      occurred_at                                 AS ultimo_at,
      (status <> 'nuevo')                         AS respondida,
      (${VENTANA_ABIERTA})                        AS ventana_abierta,
      (${PIDE_INFO})                              AS pide_info,
      1                                           AS n
    FROM interactions
    WHERE tipo = 'comentario' AND (${ventanaCola(sql`occurred_at`)}) ${filtroCanal}
  `;

  /** Cada mensaje con su número propio y la CLASE de su media, sacados del evento. */
  const msgCte = sql`
    SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
           COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
           e.payload->'media'->>'clase'             AS clase,
           e.payload->'origen'                      AS origen
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.tipo = 'mensaje' AND (${ventanaCola(sql`i.occurred_at`)}) ${filtroCanal}
  `;

  /** Los mensajes agrupados en conversación por (canal, persona, número propio). */
  const conversaciones = sql`
    SELECT
      'conv:' || canal || ':' || persona_id || ':' || numero_propio  AS clave,
      canal, 'mensaje'::text AS tipo, persona_id,
      (array_agg(persona_nombre) FILTER (WHERE persona_nombre IS NOT NULL))[1] AS persona_nombre,
      NULLIF(numero_propio, '')                                       AS numero_propio,
      (array_agg(texto ORDER BY occurred_at DESC))[1]                 AS texto,
      NULL::text                                                      AS contexto_texto,
      -- La clase del ÚLTIMO mensaje: si no hay texto (media-only), el front la usa
      -- para mostrar «📷 Foto» en vez de «(sin texto)».
      (array_agg(clase ORDER BY occurred_at DESC))[1]                 AS ultima_clase,
      -- El origen del ÚLTIMO mensaje: si vino de un anuncio y no tiene texto, el
      -- front muestra «📣 Vino del anuncio» en vez de «(sin texto)».
      (array_agg(origen ORDER BY occurred_at DESC))[1]                AS ultima_origen,
      CASE
        WHEN max(occurred_at) FILTER (WHERE direccion = 'saliente') IS NOT NULL
         AND max(occurred_at) FILTER (WHERE direccion = 'saliente')
             >= COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), '-infinity'::timestamptz)
        THEN max(occurred_at)
        ELSE COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), max(occurred_at))
      END                                                             AS referencia,
      max(occurred_at)                                                AS ultimo_at,
      (max(occurred_at) FILTER (WHERE direccion = 'saliente') IS NOT NULL
        AND max(occurred_at) FILTER (WHERE direccion = 'saliente')
            >= COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), '-infinity'::timestamptz))
                                                                      AS respondida,
      false                                                          AS ventana_abierta,
      bool_or(texto ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle)') AS pide_info,
      count(*)::int                                                  AS n
    FROM msg
    GROUP BY canal, persona_id, numero_propio
  `;

  let filtroIntencion: SQL = sql``;
  if (intencion === "pide-info") filtroIntencion = sql`WHERE pide_info`;
  if (intencion === "puedo-escribirle") filtroIntencion = sql`WHERE (ventana_abierta OR tipo = 'mensaje')`;

  // El orden es la urgencia canónica (cola/urgenciaSql.ts): nivel 0–5 y su
  // desempate, los mismos que el radar. `seguimiento_en` llega de la agenda —
  // sin él, VENCIDO no existiría acá (issue #38).
  const filas = await base.execute(sql`
    WITH msg AS (
      ${msgCte}
    ),
    todo AS (
      ${comentarios}
      UNION ALL
      ${conversaciones}
    ),
    seguimientos AS (
      ${seguimientosPendientesSql}
    )
    SELECT clave, canal, tipo, persona_id, persona_nombre, numero_propio,
           texto, contexto_texto, ultima_clase, ultima_origen, respondida, ventana_abierta, pide_info, n,
           referencia, ultimo_at, seguimiento_en,
           extract(day from now() - referencia)::int AS dias,
           (${nivelUrgenciaSql}) AS nivel,
           (${ordenUrgenciaSql}) AS orden
    FROM todo
    LEFT JOIN seguimientos USING (clave)
    ${filtroIntencion}
    ORDER BY nivel ASC, orden ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total solo en la primera página: recontar en cada scroll no aporta.
  let total: number | undefined;
  if (offset === 0) {
    const [r] = await base.execute<{ n: number }>(sql`
      WITH msg AS (${msgCte}),
      todo AS (${comentarios} UNION ALL ${conversaciones})
      SELECT count(*)::int AS n FROM todo ${filtroIntencion}
    `);
    total = r?.n;
  }

  return { conversaciones: filas as unknown[], total, hayMas: filas.length === limit };
}
