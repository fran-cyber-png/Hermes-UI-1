import { Router } from 'express';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';

/**
 * LA COLA UNIFICADA — una fila por CONVERSACIÓN, no por mensaje.
 *
 * `/api/interactions` devuelve una fila por interacción cruda. Servía para
 * comentarios (cada comentario ES un ítem), pero con el stream de WhatsApp un
 * chat de 20 mensajes serían 20 filas en la bandeja, con los propios salientes
 * mezclados. Esta ruta agrupa:
 *
 *   · Comentarios FB/IG → una fila por comentario (como siempre).
 *   · Mensajes (WhatsApp/Messenger) → una fila por (canal, persona, número propio):
 *     el último texto, si tiene un entrante sin responder, cuánto hace que espera.
 *
 * "Respondida" es DERIVADA (existe un saliente posterior al último entrante), no
 * un estado de fila — la misma lección que ya está aprendida en la bandeja.
 *
 * El orden es la urgencia de dos niveles de `cola/urgencia.ts`, acá expresada en
 * SQL: nivel 0 lo que EXPIRA (ventana Meta abierta), nivel 1 lo que ESPERA
 * (mensaje sin responder), nivel 2 el resto (reciente primero).
 */
export const conversacionesRouter = Router();

/** ¿Pide que la contacten? Misma heurística que la bandeja de comentarios. */
const PIDE_INFO = sql`texto ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle)'`;

/** La ventana de 7 días de Meta para el privado. IG también la tiene, no solo FB. */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal IN ('facebook','instagram') AND occurred_at > now() - interval '7 days')`;

conversacionesRouter.get('/', async (req, res) => {
 try {
  const canal = typeof req.query.canal === 'string' ? req.query.canal : '';
  const intencion = typeof req.query.intencion === 'string' ? req.query.intencion : '';
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Number(req.query.offset) || 0;

  const filtroCanal = canal ? sql`AND canal = ${canal}` : sql``;

  /**
   * Los comentarios: una fila por interacción, como hoy. `respondida` sale de
   * `status` (que ya lo persiste `responder.ts`). `referencia` = cuándo comentó.
   */
  const comentarios = sql`
    SELECT
      'int:' || id::text                          AS clave,
      canal, tipo, persona_id, persona_nombre,
      NULL::text                                  AS numero_propio,
      texto, contexto_texto,
      occurred_at                                 AS referencia,
      occurred_at                                 AS ultimo_at,
      (status <> 'nuevo')                         AS respondida,
      (${VENTANA_ABIERTA})                        AS ventana_abierta,
      (${PIDE_INFO})                              AS pide_info,
      1                                           AS n
    FROM interactions
    WHERE tipo = 'comentario' ${filtroCanal}
  `;

  /**
   * El cuerpo del CTE de mensajes: cada mensaje con su `numero_propio` sacado del
   * payload del evento. Va como CTE al tope de la consulta final (un `WITH` no
   * puede vivir adentro de una rama de UNION ALL — Postgres lo rechaza).
   */
  const msgCte = sql`
    SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
           COALESCE(e.payload->>'numeroPropio', '') AS numero_propio
    FROM interactions i
    JOIN events e ON e.id = i.event_id
    WHERE i.tipo = 'mensaje' ${filtroCanal}
  `;

  /**
   * Los mensajes, agrupados en conversación por (canal, persona, número propio) —
   * así dos números hablándole a la misma persona no se mezclan en un hilo.
   * `respondida` = hay un saliente igual o posterior al último entrante.
   */
  const conversaciones = sql`
    SELECT
      'conv:' || canal || ':' || persona_id || ':' || numero_propio  AS clave,
      canal, 'mensaje'::text AS tipo, persona_id,
      (array_agg(persona_nombre) FILTER (WHERE persona_nombre IS NOT NULL))[1] AS persona_nombre,
      NULLIF(numero_propio, '')                                       AS numero_propio,
      (array_agg(texto ORDER BY occurred_at DESC))[1]                 AS texto,
      NULL::text                                                      AS contexto_texto,
      -- Si espera respuesta, la referencia es el entrante sin contestar; si ya se
      -- respondió, el último mensaje (cae al nivel del resto, reciente primero).
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

  // Unimos las dos mitades y ordenamos por la urgencia de cuatro niveles
  // (espejo de cola/urgencia.ts): vivo, expira, espera, resto.
  const nivel = sql`
    CASE
      WHEN tipo = 'mensaje' AND NOT respondida AND referencia > now() - interval '24 hours' THEN 0
      WHEN tipo = 'comentario' AND ventana_abierta AND NOT respondida THEN 1
      WHEN tipo = 'mensaje' AND NOT respondida THEN 2
      ELSE 3
    END`;

  // Filtro de intención aplicado sobre la unión (comentarios y conversaciones ya
  // traen pide_info / ventana_abierta calculados).
  let filtroIntencion: SQL = sql``;
  if (intencion === 'pide-info') filtroIntencion = sql`WHERE pide_info`;
  // "Les puedo escribir" = a quién puedo contactar AHORA. Un comentario, si la
  // ventana de 7 días de Meta sigue abierta; un mensaje (WhatsApp/Messenger),
  // SIEMPRE — no tiene ventana que se cierre. Sin esto, los chats de WhatsApp
  // quedaban escondidos bajo el filtro por defecto, que es justo el canal que
  // más importa.
  if (intencion === 'puedo-escribirle') filtroIntencion = sql`WHERE (ventana_abierta OR tipo = 'mensaje')`;

  const filas = await db.execute(sql`
    WITH msg AS (
      ${msgCte}
    ),
    todo AS (
      ${comentarios}
      UNION ALL
      ${conversaciones}
    )
    SELECT clave, canal, tipo, persona_id, persona_nombre, numero_propio,
           texto, contexto_texto, respondida, ventana_abierta, pide_info, n,
           referencia, ultimo_at,
           extract(day from now() - referencia)::int AS dias,
           (${nivel}) AS nivel
    FROM todo
    ${filtroIntencion}
    ORDER BY (${nivel}) ASC,
             -- Vivo (0) y resto (3): lo más reciente arriba. Expira (1) y espera
             -- (2): lo más viejo arriba (deadline / antigüedad). Espejo de urgencia.ts.
             CASE WHEN (${nivel}) IN (1, 2) THEN referencia END ASC,
             referencia DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total solo en la primera página: recontar en cada scroll no aporta.
  let total: number | undefined;
  if (offset === 0) {
    const [r] = await db.execute<{ n: number }>(sql`
      WITH msg AS (${msgCte}),
      todo AS (${comentarios} UNION ALL ${conversaciones})
      SELECT count(*)::int AS n FROM todo ${filtroIntencion}
    `);
    total = r?.n;
  }

  res.json({ conversaciones: filas, total, hayMas: filas.length === limit });
 } catch (err) {
  res.status(500).json({ ok: false, message: (err as Error).message });
 }
});
