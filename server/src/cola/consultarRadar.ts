import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { ordenarRadar } from "./radar.js";
import {
  pideInfoAgrupadoSql,
  pideInfoSql,
  referenciaSql,
  respondidaSql,
  seguimientosPendientesSql,
} from "./urgenciaSql.js";

/**
 * LAS CONVERSACIONES DEL RADAR — el seam que la ruta del Dashboard consulta.
 *
 * Extraído de `routes/dashboard.ts` para poder testear el SQL contra una base
 * de verdad (harness #33, ADR 0008): recibe `db` INYECTADO — la ruta le pasa el
 * singleton, el test su base de prueba. Devuelve las filas YA ordenadas por la
 * urgencia canónica (`ordenarRadar`), con su `(nivel, orden)` colgado: la
 * primera fila ES la que el titular recomienda atender.
 */

/** Una conversación del radar, como la devuelve Postgres.
 *  Es un type (no interface) a propósito: `db.execute<T>` exige la index
 *  signature implícita que las interfaces no tienen. */
export type ChatRadar = {
  clave: string;
  fuente: string;
  canal: string;
  tipo: string;
  persona_id: string | null;
  persona_nombre: string | null;
  numero_propio: string | null;
  texto: string | null;
  contexto_texto: string | null;
  telefono: string | null;
  pais_dato: string | null;
  pide_info: boolean;
  ventana_abierta: boolean;
  respondida: boolean;
  referencia: string;
  cayo_at: string;
  /** El pendiente más viejo de la agenda para esta clave — NULL si no hay. */
  seguimiento_en: string | null;
};

export async function consultarRadar(
  base: typeof db,
  ahora: Date = new Date(),
): Promise<(ChatRadar & { nivel: number; orden: number })[]> {
  // Lo que cayó por CHAT (misma clave que la cola, para que Estado/Etiquetas
  // matcheen): conversaciones con su último ENTRANTE de los últimos 7 días.
  const chats = await base.execute<ChatRadar>(sql`
    WITH msgs AS (
      -- Los DOS sentidos, no solo los entrantes: sin los salientes no se puede
      -- derivar respondida, que es lo que separa Deuda de Silencio. La ventana
      -- de 7 días se aplica abajo sobre el último ENTRANTE, así una respuesta
      -- posterior no queda afuera del grupo.
      --
      -- Los 30 días NO son un criterio de producto, son el techo del scan: sin
      -- ellos esto escanea events entero (111 mil filas de JSON para leer UN
      -- campo) y el CTE pasa de 8 ms a 191 ms. Es seguro porque la respuesta a un
      -- entrante es siempre POSTERIOR a ese entrante: si el último entrante entra
      -- en 7 días, su respuesta entra en 30. Medido con EXPLAIN ANALYZE.
      SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje' AND i.persona_id IS NOT NULL
        AND i.occurred_at > now() - interval '30 days'
    ),
    conv AS (
      SELECT
        'conv:' || canal || ':' || persona_id || ':' || numero_propio AS clave,
        'chat'::text AS fuente, canal, 'mensaje'::text AS tipo,
        persona_id,
        (array_agg(persona_nombre) FILTER (WHERE persona_nombre IS NOT NULL))[1] AS persona_nombre,
        NULLIF(numero_propio, '') AS numero_propio,
        -- Lo que dijo la PERSONA, no lo último que se escribió en el hilo: si la
        -- vendedora ya contestó, el mensaje que importa sigue siendo el de ella.
        (array_agg(texto ORDER BY occurred_at DESC) FILTER (WHERE direccion = 'entrante'))[1] AS texto,
        NULL::text AS contexto_texto,
        CASE WHEN canal = 'whatsapp' THEN persona_id ELSE NULL END AS telefono,
        NULL::text AS pais_dato,
        -- Lo que pide la persona es lo ÚLTIMO que dijo, no todo lo que dijo
        -- alguna vez (#49): el bool_or de antes dejaba el chip pegado para
        -- siempre. Mismo fragmento que la cola — una sola semántica.
        (${pideInfoAgrupadoSql})                                       AS pide_info,
        -- En WhatsApp no hay ventana: el número está vinculado como dispositivo de
        -- un teléfono real, no como cuenta de negocio (ver CONTEXT.md).
        false AS ventana_abierta,
        -- Misma definición que la cola (cola/urgenciaSql.ts, #96): hay un
        -- saliente igual o posterior al último entrante.
        (${respondidaSql})                                             AS respondida,
        -- El contrato de referencia del módulo de urgencia: si espera respuesta
        -- es el entrante sin contestar; si ya se respondió, cuándo respondimos —
        -- o sea cuándo empezó el silencio.
        (${referenciaSql})                                             AS referencia,
        max(occurred_at) FILTER (WHERE direccion = 'entrante')         AS cayo_at
      FROM msgs
      GROUP BY canal, persona_id, numero_propio
      HAVING max(occurred_at) FILTER (WHERE direccion = 'entrante') > now() - interval '7 days'
    ),
    comentarios AS (
      SELECT
        'int:' || i.id::text AS clave,
        'comentario'::text AS fuente, i.canal, 'comentario'::text AS tipo,
        i.persona_id, i.persona_nombre, NULL::text AS numero_propio,
        i.texto, i.contexto_texto,
        NULL::text AS telefono, NULL::text AS pais_dato,
        (${pideInfoSql("i.texto")}) AS pide_info,
        (i.occurred_at > now() - interval '7 days') AS ventana_abierta,
        -- Misma fuente que la cola: status lo persiste responder.ts.
        (i.status <> 'nuevo')                       AS respondida,
        i.occurred_at                               AS referencia,
        i.occurred_at AS cayo_at
      FROM interactions i
      WHERE i.tipo = 'comentario' AND i.occurred_at > now() - interval '7 days'
    ),
    -- La agenda entra al radar por acá (#38): sin este JOIN, el nivel VENCIDO
    -- no se dispara nunca y los seguimientos no influyen en el orden de nada.
    seguimientos AS (
      ${seguimientosPendientesSql}
    )
    SELECT t.*, s.seguimiento_en
    FROM (SELECT * FROM conv UNION ALL SELECT * FROM comentarios) t
    LEFT JOIN seguimientos s USING (clave)
    -- Este orden NO es el que ve la vendedora: solo elige QUÉ 60 filas viajan.
    -- El orden real lo decide ordenarRadar abajo, con el módulo de urgencia.
    -- El tope de 60 se hereda tal cual: hoy el front ya ordenaba estas mismas 60,
    -- así que mover el orden al server no cambia qué llega. Hacerlo honesto (o
    -- sacarlo) es el ticket #24 — hasta entonces, una urgencia vieja que quede
    -- fuera de las 60 más recientes sigue sin aparecer, igual que hoy.
    ORDER BY cayo_at DESC
    LIMIT 60
  `);

  // El orden del radar, una sola vez y del lado del server: la primera fila ES
  // la que el titular tiene que recomendar.
  return ordenarRadar(chats, ahora);
}
