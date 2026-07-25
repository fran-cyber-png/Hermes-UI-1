import { sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import type { ConversacionCandidata } from './decidir.js';

/**
 * DE DÓNDE SALEN LOS CANDIDATOS — una consulta de LECTURA, y nada más.
 *
 * Devuelve las conversaciones de WhatsApp cuyo último mensaje es de la persona
 * (nadie contestó todavía), con lo que la decisión necesita para juzgarlas: hace
 * cuánto esperan, qué dijeron, si ya le escribimos alguna vez, si ya recibieron
 * una auto-respuesta hoy y qué curso les interesa.
 *
 * La conversación se agrupa como en toda la casa —por `(canal, persona, número
 * propio)`, la clave de la cola— y no por fila de `interactions`: dos números
 * propios hablándole a la misma persona son DOS conversaciones (ver
 * `cola/consultarCola.ts`).
 *
 * Es un seam: recibe `base` inyectado, así el test con base le pasa la suya.
 */

/**
 * Hasta dónde se mira hacia atrás. 3 días, no 30 como la cola: acá solo
 * interesa la noche que acaba de pasar. Cuanto más chica la ventana, más barata
 * la consulta y menos chance de despertar una conversación vieja.
 */
const VENTANA_DIAS = 3;

/** Cuántos mensajes de la persona se leen para detectar un rechazo. */
const TEXTOS_PARA_RECHAZO = 10;

interface FilaCandidata extends Record<string, unknown> {
  clave: string;
  canal: string;
  telefono: string;
  numero_propio: string;
  persona_nombre: string | null;
  ultimo_entrante_at: string | Date;
  ultimo_saliente_at: string | Date | null;
  textos_cliente: (string | null)[] | null;
  salientes: number;
  auto_hoy: number;
  curso: string | null;
}

export async function consultarCandidatos(
  base: typeof db,
  diaLima: string,
): Promise<ConversacionCandidata[]> {
  const filas = await base.execute<FilaCandidata>(sql`
    WITH msg AS (
      SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.canal = 'whatsapp'
        AND i.persona_id IS NOT NULL
        AND i.occurred_at > now() - interval '${sql.raw(String(VENTANA_DIAS))} days'
    ),
    conv AS (
      SELECT
        'conv:' || canal || ':' || persona_id || ':' || numero_propio        AS clave,
        canal,
        persona_id                                                          AS telefono,
        numero_propio,
        (array_agg(persona_nombre) FILTER (WHERE persona_nombre IS NOT NULL))[1] AS persona_nombre,
        max(occurred_at) FILTER (WHERE direccion = 'entrante')              AS ultimo_entrante_at,
        max(occurred_at) FILTER (WHERE direccion = 'saliente')              AS ultimo_saliente_at,
        count(*) FILTER (WHERE direccion = 'saliente')::int                 AS salientes,
        (array_agg(texto ORDER BY occurred_at DESC)
           FILTER (WHERE direccion = 'entrante' AND texto IS NOT NULL)
        )[1:${sql.raw(String(TEXTOS_PARA_RECHAZO))}]                        AS textos_cliente
      FROM msg
      GROUP BY canal, persona_id, numero_propio
    )
    SELECT c.*,
      (SELECT count(*)::int FROM auto_respuestas_pendientes a
        WHERE a.clave = c.clave AND a.dia_lima = ${diaLima}
          AND a.estado IN ('pendiente', 'enviada'))                         AS auto_hoy,
      (SELECT i2.curso FROM intereses i2
        WHERE i2.clave = c.clave ORDER BY i2.creado_at DESC LIMIT 1)        AS curso
    FROM conv c
    WHERE c.ultimo_entrante_at IS NOT NULL
      AND c.numero_propio <> ''
      AND (c.ultimo_saliente_at IS NULL OR c.ultimo_saliente_at < c.ultimo_entrante_at)
    ORDER BY c.ultimo_entrante_at ASC
  `);

  return filas.map((f) => ({
    clave: f.clave,
    telefono: f.telefono,
    numeroPropio: f.numero_propio,
    personaNombre: f.persona_nombre,
    ultimoEntranteEn: new Date(f.ultimo_entrante_at),
    ultimoSalienteEn: f.ultimo_saliente_at ? new Date(f.ultimo_saliente_at) : null,
    textosDelCliente: f.textos_cliente ?? [],
    autoRespuestasHoy: f.auto_hoy,
    salientes: f.salientes,
    curso: f.curso,
  }));
}
