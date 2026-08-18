import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { soloMisClavesSql } from "../dashboard/personal.js";
import { ordenarRadar } from "./radar.js";
import { preguntoAgrupadoSql, preguntoSql, soloClicAgrupadoSql } from "./pregunta.js";
import { sinLineaVedadaSql } from "../numeros/campana.js";
import {
  referenciaSql,
  respondidaSql,
  seguimientosPendientesSql,
  VENTANA_META_DIAS,
  ventanaAbiertaSql,
  ventanaDiasSql,
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
  /**
   * La clase de media y el origen del MISMO mensaje que `texto` —el último
   * ENTRANTE, no el último del hilo— para poder decir «📷 Foto» o «📣 Vino del
   * anuncio» en vez de dejar la fila en blanco (#20). NULL en comentarios.
   */
  texto_clase: string | null;
  texto_origen: { fuente?: string } | null;
  contexto_texto: string | null;
  telefono: string | null;
  pais_dato: string | null;
  pregunto: boolean;
  solo_clic: boolean;
  /**
   * Los días que quedan de la ventana de Meta (#22). NULL donde no hay ventana
   * —WhatsApp y todo lo que no sea un comentario de FB/IG—, 0 cuando ya se
   * cerró. NULL y 0 NO son lo mismo: «no aplica» contra «se te pasó».
   */
  ventana_dias: number | null;
  ventana_abierta: boolean;
  respondida: boolean;
  referencia: string;
  cayo_at: string;
  /** El pendiente más viejo de la agenda para esta clave — NULL si no hay. */
  seguimiento_en: string | null;
  /**
   * DE QUÉ se trata ese compromiso (#23). Es la nota de la MISMA fila que dio
   * `seguimiento_en`. Sin esto la fila solo puede decir «vencido», que no le
   * dice a la vendedora qué prometió.
   */
  seguimiento_nota: string | null;
};

export async function consultarRadar(
  base: typeof db,
  ahora: Date = new Date(),
  /**
   * A quién se le acota el radar (Dashboard personal, 5-ago-2026). `null` = todo.
   *
   * ⚠️ El recorte es **estricto**: se queda con las conversaciones asignadas a
   * esa vendedora y con nada más. Los **comentarios** de FB/IG se caen enteros,
   * y no es un olvido — su clave es `int:<id>` y nunca se asigna, así que no hay
   * forma de que sean «de alguien». El porqué de la decisión está en
   * `dashboard/personal.ts`.
   */
  soloAsignadasA: string | null = null,
  /**
   * QUIÉN MIRA — para la frontera de campaña (`numeros/campana.ts`), y **no es
   * `soloAsignadasA`**: aquél es `null` para un supervisor («no recortes por
   * dueña») y ésta pregunta otra cosa, «¿quién está del otro lado de la
   * pantalla?». Sin él, el radar de un supervisor de ventas incluía las
   * conversaciones de la línea de campaña, que son de otro negocio.
   *
   * `undefined` veda TODA línea de campaña: el olvido ve de menos.
   */
  quienMira?: string,
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
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
             -- Para el caso «llegó una foto, no texto» (#20). Salen del payload
             -- del evento, que ya se lee acá arriba: no agregan ni un JOIN.
             e.payload->'media'->>'clase'             AS clase,
             e.payload->'origen'                      AS origen
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
        -- Qué llegó cuando NO llegó texto (#20). El mismo FILTER de entrante que
        -- texto, y no es un detalle: sin él la fila podría decir «📷 Foto»
        -- describiendo una foto que mandó LA VENDEDORA. Las tres columnas tienen
        -- que hablar del MISMO mensaje o la fila miente sobre quién dijo qué.
        (array_agg(clase ORDER BY occurred_at DESC) FILTER (WHERE direccion = 'entrante'))[1] AS texto_clase,
        (array_agg(origen ORDER BY occurred_at DESC) FILTER (WHERE direccion = 'entrante'))[1] AS texto_origen,
        NULL::text AS contexto_texto,
        CASE WHEN canal = 'whatsapp' THEN persona_id ELSE NULL END AS telefono,
        NULL::text AS pais_dato,
        -- Lo que pide la persona es lo ÚLTIMO que dijo, no todo lo que dijo
        -- alguna vez (#49): el bool_or de antes dejaba el chip pegado para
        -- siempre. Mismo fragmento que la cola — una sola semántica.
        (${preguntoAgrupadoSql})                                      AS pregunto,
        (${soloClicAgrupadoSql})                                      AS solo_clic,
        -- En WhatsApp no hay ventana: el número está vinculado como dispositivo de
        -- un teléfono real, no como cuenta de negocio (ver CONTEXT.md). NULL es
        -- «no aplica» — la fila no muestra cuenta regresiva ninguna.
        NULL::int AS ventana_dias,
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
        i.texto,
        -- Un comentario público es texto; no hay media ni referral de anuncio que
        -- leer. Van en NULL para que las dos ramas del UNION cuadren.
        NULL::text AS texto_clase, NULL::jsonb AS texto_origen,
        i.contexto_texto,
        NULL::text AS telefono, NULL::text AS pais_dato,
        (${preguntoSql("i.texto")}) AS pregunto,
        false AS solo_clic,
        (${ventanaDiasSql("i.occurred_at", "i.canal")}) AS ventana_dias,
        -- Misma fuente que la cola: status lo persiste responder.ts.
        (i.status <> 'nuevo')                       AS respondida,
        i.occurred_at                               AS referencia,
        i.occurred_at AS cayo_at
      FROM interactions i
      -- UN DÍA MÁS que la ventana, a propósito: si el scan cortara justo en 7
      -- días, un comentario con la ventana YA CERRADA no llegaría nunca al radar
      -- y ventana_dias = 0 sería un estado inalcanzable — la pantalla no podría
      -- decir «se te cerró» ni aunque supiera. Ese día de gracia es lo que hace
      -- observable el cierre; no es una ventana de 8 días.
      WHERE i.tipo = 'comentario'
        AND i.occurred_at > now() - ${VENTANA_META_DIAS + 1} * interval '1 day'
    ),
    -- La agenda entra al radar por acá (#38): sin este JOIN, el nivel VENCIDO
    -- no se dispara nunca y los seguimientos no influyen en el orden de nada.
    seguimientos AS (
      ${seguimientosPendientesSql}
    )
    -- ventana_abierta se DERIVA de los días que quedan, no se calcula aparte:
    -- así el booleano que ordena (nivel EXPIRA) y el número que se muestra no
    -- pueden decir cosas distintas sobre la misma fila.
    SELECT t.*, (${ventanaAbiertaSql(sql`t.ventana_dias`)}) AS ventana_abierta,
           s.seguimiento_en, s.seguimiento_nota
    FROM (SELECT * FROM conv UNION ALL SELECT * FROM comentarios) t
    LEFT JOIN seguimientos s USING (clave)
    -- El recorte del Dashboard personal. Va DESPUÉS del UNION y no adentro de
    -- la CTE conv: así se aplica a las dos ramas con una sola condición, y que
    -- los comentarios queden afuera es una consecuencia visible del criterio
    -- (no tienen dueño posible) y no un filtro escondido en una de las mitades.
    WHERE ${soloMisClavesSql(sql`t.clave`, soloAsignadasA)}
      -- La frontera de los dos planos de Goberna (numeros/campana.ts). Va acá
      -- por lo mismo que el recorte de arriba: DESPUÉS del UNION, así alcanza a
      -- las dos ramas con una sola condición. Los comentarios pasan solos — su
      -- numero_propio es NULL, o sea que no llegaron por ninguna línea nuestra.
      AND ${sinLineaVedadaSql(sql`t.numero_propio`, quienMira)}
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
