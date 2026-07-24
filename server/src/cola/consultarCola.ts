import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import {
  nivelUrgenciaSql,
  ordenUrgenciaSql,
  pideInfoAgrupadoSql,
  pideInfoSql,
  referenciaSql,
  respondidaSql,
  seguimientosPendientesSql,
} from "./urgenciaSql.js";
import { etapaEfectivaSql, ultimasGestionesSql } from "./etapaEfectivaSql.js";
import {
  bandaPinOrdenSql,
  categoriasCteSql,
  esTablaAusente,
  estadoJoinSql,
  favoritaSql,
  noLeidoSql,
  pinsCteSql,
} from "./estadoSql.js";

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
 * ningún criterio propio (`respondida`, `referencia` y `pide_info` también salen
 * de ahí, #96), y el test de paridad (`urgencia.paridad.test.db.ts`) falla si la
 * cola y el radar vuelven a ordenar distinto.
 *
 * `ultima_clase` (nuevo): la clase de media del ÚLTIMO mensaje. Cuando el preview
 * no tiene texto (media-only), el front la usa para mostrar «📷 Foto» en vez de
 * «(sin texto)» (#55). Sale del payload del evento (`media.clase`), que ya se
 * guarda al proyectar; no agrega JOIN — `events` ya se une por el número propio.
 *
 * `etapa_efectiva` / `etapa_manual` (#88, ADR 0013): la etapa del embudo, dicha
 * por el server — max(manual, derivada) con `perdido` terminal, calculada por el
 * seam `cola/etapaEfectivaSql.ts` sobre esta MISMA ventana de 30 días. El front
 * NO la recalcula ni cae a ningún fallback: la paridad SQL≡TS la fija
 * `etapaEfectiva.paridad.test.db.ts`. El filtro `?etapa=` y los `conteos` (#89)
 * salen de la misma definición: un universo, no tres.
 *
 * `fijada` / `favorita` / `no_leido` / `categorias` (#49, ADR 0014): el estado
 * PERSONAL de la vendedora, unido con un LEFT JOIN a `estado_conversacion` (los
 * fragmentos viven en `cola/estadoSql.ts`). La banda de pin va ARRIBA de la
 * urgencia sin reemplazarla, y las fijadas entran aunque se hayan caído de la
 * ventana de 30 días. Si esa tabla todavía no existe, la cola DEGRADA en vez de
 * reventar (ver `consultarCola` abajo).
 */

/** La ventana de 7 días de Meta para el privado. IG también la tiene, no solo FB. */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal IN ('facebook','instagram') AND occurred_at > now() - interval '7 days')`;

/**
 * LA VENTANA DE LA COLA — hasta dónde mira «el trabajo pendiente». 30 días: es el
 * ciclo de venta de la Escuela, no una razón técnica. Sin esta cota el planner ni
 * usa el índice (escanea `events` entero). Medido: 482 ms → 3,4 ms.
 *
 * La excepción son las FIJADAS (#49): entran aunque queden fuera. Sin eso, fijar
 * tres y dejarlas envejecer las volvía invisibles pero seguían ocupando el tope,
 * y no había forma de soltarlas. El conjunto de pines es diminuto (≤3), así que
 * el OR no arruina el plan.
 */
const ventanaCola = (columna: SQL) => sql`${columna} > now() - interval '30 days'`;

/** Los comentarios: una fila por interacción. Sin media → `ultima_clase` NULL. */
const comentariosCte = (filtroCanal: SQL) => sql`
  SELECT
    'int:' || id::text                          AS clave,
    canal, tipo, persona_id, persona_nombre,
    NULL::text                                  AS numero_propio,
    texto, contexto_texto,
    NULL::text                                  AS ultima_clase,
    NULL::jsonb                                 AS ultima_origen,
    occurred_at                                 AS referencia,
    occurred_at                                 AS ultimo_at,
    occurred_at                                 AS ultimo_entrante_at,
    (status <> 'nuevo')                         AS respondida,
    (${VENTANA_ABIERTA})                        AS ventana_abierta,
    (${pideInfoSql("texto")})                    AS pide_info,
    1                                           AS n
  FROM interactions
  WHERE tipo = 'comentario'
    AND ((${ventanaCola(sql`occurred_at`)}) OR ('int:' || id::text) IN (SELECT clave FROM pins))
    ${filtroCanal}
`;

/** Cada mensaje con su número propio y la CLASE de su media, sacados del evento. */
const msgCte = (filtroCanal: SQL) => sql`
  SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
         COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
         e.payload->'media'->>'clase'             AS clase,
         e.payload->'origen'                      AS origen
  FROM interactions i
  JOIN events e ON e.id = i.event_id
  WHERE i.tipo = 'mensaje'
    AND ((${ventanaCola(sql`i.occurred_at`)})
         OR ('conv:' || i.canal || ':' || i.persona_id || ':' ||
             COALESCE(e.payload->>'numeroPropio', '')) IN (SELECT clave FROM pins))
    ${filtroCanal}
`;

/** Los mensajes agrupados en conversación por (canal, persona, número propio). */
const conversacionesCte = sql`
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
    (${referenciaSql})                                              AS referencia,
    max(occurred_at)                                                AS ultimo_at,
    -- El último ENTRANTE: de acá sale «no leído» (contra el cursor de lectura).
    max(occurred_at) FILTER (WHERE direccion = 'entrante')          AS ultimo_entrante_at,
    (${respondidaSql})                                              AS respondida,
    false                                                          AS ventana_abierta,
    -- «Pide info» del ÚLTIMO ENTRANTE CON TEXTO, no un bool_or histórico (#49):
    -- si lo último que dijo fue «no gracias», el chip NO se prende aunque semanas
    -- atrás pidiera precio. Mismo fragmento que el radar — una sola semántica.
    (${pideInfoAgrupadoSql})                                        AS pide_info,
    count(*)::int                                                  AS n
  FROM msg
  GROUP BY canal, persona_id, numero_propio
`;

/**
 * El `WITH` común — `todo` (comentarios + conversaciones) para un filtro de
 * canal. Extraído a módulo para que la página, el total y los conteos (#89)
 * COMPARTAN la definición en vez de espejarla: la lección de #37.
 *
 * `pins` va PRIMERO porque los dos CTEs de arriba lo consultan para dejar entrar
 * a las conversaciones fijadas que ya se cayeron de la ventana de 30 días (#49).
 */
const conTodo = (filtroCanal: SQL, vendedoraId: string | undefined, conEstado: boolean) => sql`
  WITH pins AS (
    ${pinsCteSql(vendedoraId, conEstado)}
  ),
  msg AS (
    ${msgCte(filtroCanal)}
  ),
  todo AS (
    ${comentariosCte(filtroCanal)}
    UNION ALL
    ${conversacionesCte}
  ),
  cats AS (
    ${categoriasCteSql}
  )
`;

/**
 * El FROM compartido: `todo` con todo lo que se le cuelga. Los tres caminos
 * (página, total, conteos) lo usan igual, así ninguna condición vale en uno y
 * no en otro. Incluye el estado personal (#49) y la última gestión (#89).
 */
const desdeTodo = (vendedoraId: string | undefined, conEstado: boolean) => sql`
  FROM todo
  LEFT JOIN seguimientos USING (clave)
  LEFT JOIN ultimas_gestiones USING (clave)
  ${estadoJoinSql(vendedoraId, conEstado)}
  LEFT JOIN cats ON cats.clave = todo.clave
`;

/** Los CTEs que dependen de `todo` y se repiten en los tres caminos. */
const colgados = sql`
  seguimientos AS (
    ${seguimientosPendientesSql}
  ),
  ultimas_gestiones AS (
    ${ultimasGestionesSql}
  )
`;

export interface OpcionesCola {
  canal?: string;
  intencion?: string;
  /** Filtra por ETAPA EFECTIVA (#89, ADR 0013): la del seam, no la asentada a mano. */
  etapa?: string;
  /** El tab de la cola potenciada (#49): `todo` (default) · `no-leidos` · `favoritos`. */
  tab?: string;
  /** Filtra por una categoría asignada (modo Listas de #49). Se compara en minúsculas. */
  categoria?: string;
  /** La vendedora del token: sin ella el estado personal (pin/fav/leído) queda en defaults. */
  vendedoraId?: string;
  limit?: number;
  offset?: number;
}

export interface ResultadoCola {
  conversaciones: unknown[];
  total?: number;
  hayMas: boolean;
  /**
   * Conteos REALES por etapa efectiva sobre la MISMA ventana y el MISMO filtro
   * de canal/intención (sin el de etapa: son el total de cada columna). Solo en
   * la primera página, como `total`.
   */
  conteos?: Record<string, number>;
  /** true = la cola vino SIN estado personal (la tabla no existe todavía). El
   *  front lo dice en voz alta en vez de fingir que nadie fijó nada. */
  sinEstado?: boolean;
}

/**
 * La cola, con degradación honesta: si `estado_conversacion` todavía no existe
 * (el `db:push` es manual, ver ADR 0014), la consulta reintenta SIN el estado
 * personal en vez de tirar 500 y dejar a la vendedora sin mesa de trabajo.
 */
export async function consultarCola(
  base: typeof db,
  opciones: OpcionesCola = {},
): Promise<ResultadoCola> {
  try {
    return await ejecutarCola(base, opciones, true);
  } catch (e) {
    if (!esTablaAusente(e)) throw e;
    console.warn(
      "[cola] estado_conversacion no existe: sirvo la cola SIN pin/favorita/no-leído. " +
        "Corré `npm run db:push` (ADR 0014).",
    );
    return { ...(await ejecutarCola(base, opciones, false)), sinEstado: true };
  }
}

async function ejecutarCola(
  base: typeof db,
  opciones: OpcionesCola,
  conEstado: boolean,
): Promise<ResultadoCola> {
  const canal = opciones.canal ?? "";
  const intencion = opciones.intencion ?? "";
  const etapa = opciones.etapa ?? "";
  const tab = opciones.tab ?? "";
  const categoria = (opciones.categoria ?? "").trim().toLowerCase();
  const vendedoraId = opciones.vendedoraId;
  const limit = Math.min(opciones.limit || 40, 100);
  const offset = opciones.offset || 0;

  const filtroCanal = canal ? sql`AND canal = ${canal}` : sql``;

  // Las condiciones se acumulan y se dicen UNA vez: la intención (como siempre),
  // los ejes personales de la cola potenciada (#49) y la etapa efectiva (#89).
  // `condicionesBase` es lo que comparten la página, el total y los conteos; el
  // filtro de etapa solo recorta la página y el total (los conteos son POR etapa:
  // filtrarlos por etapa sería contarse a sí mismos).
  //
  // Se escriben como EXPRESIONES, no como aliases del SELECT: así valen igual en
  // los tres caminos, incluido el `GROUP BY` de los conteos.
  const condicionesBase: SQL[] = [];
  if (intencion === "pide-info") condicionesBase.push(sql`pide_info`);
  if (intencion === "puedo-escribirle") condicionesBase.push(sql`(ventana_abierta OR tipo = 'mensaje')`);
  // «Por vencer» es la reencarnación de `puedo-escribirle` en la cola potenciada:
  // lo que tiene la ventana de Meta corriendo (#49).
  if (intencion === "por-vencer") condicionesBase.push(sql`ventana_abierta`);
  // En modo degradado los tabs personales NO filtran: sin la tabla no hay estado
  // que consultar, y devolver «Nada sin leer» sería mentir. Se sirve la cola
  // entera y el `sinEstado: true` de la respuesta lo dice en voz alta.
  if (conEstado && tab === "no-leidos") condicionesBase.push(noLeidoSql);
  if (conEstado && tab === "favoritos") condicionesBase.push(favoritaSql);
  if (categoria) condicionesBase.push(sql`${categoria} = ANY(COALESCE(cats.categorias, '{}'::text[]))`);

  const condiciones = [...condicionesBase];
  if (etapa) condiciones.push(sql`(${etapaEfectivaSql}) = ${etapa}`);

  const donde = (c: SQL[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);

  // El orden es la urgencia canónica (cola/urgenciaSql.ts): nivel 0–5 y su
  // desempate, los mismos que el radar. `seguimiento_en` llega de la agenda —
  // sin él, VENCIDO no existiría acá (issue #38). `etapa_manual` llega de la
  // última gestión por clave (cola/etapaEfectivaSql.ts). La BANDA DE PIN va
  // delante de la urgencia: las fijadas arriba de todo, y dentro de la banda
  // sigue mandando el nivel 0–5 (#49). Postgres permite ordenar por los alias
  // del SELECT, así que `fijada`/`fijada_at` se nombran una sola vez.
  const filas = await base.execute(sql`
    ${conTodo(filtroCanal, vendedoraId, conEstado)},
    ${colgados}
    SELECT todo.clave, canal, tipo, persona_id, persona_nombre, numero_propio,
           texto, contexto_texto, ultima_clase, ultima_origen, respondida, ventana_abierta, pide_info, n,
           referencia, ultimo_at, seguimiento_en,
           etapa_manual,
           (${etapaEfectivaSql}) AS etapa_efectiva,
           extract(day from now() - referencia)::int AS dias,
           (${nivelUrgenciaSql}) AS nivel,
           (${ordenUrgenciaSql}) AS orden,
           COALESCE(ec.fijada, false)              AS fijada,
           ec.fijada_at,
           (${favoritaSql})                        AS favorita,
           (${noLeidoSql})                         AS no_leido,
           COALESCE(cats.categorias, '{}'::text[]) AS categorias
    ${desdeTodo(vendedoraId, conEstado)}
    ${donde(condiciones)}
    ORDER BY ${bandaPinOrdenSql}, nivel ASC, orden ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total y los conteos solo en la primera página: recontar en cada scroll
  // no aporta. Con `?etapa=`, el total ES el de la columna — la carga
  // incremental por columna del tablero (#90) es honesta por construcción.
  let total: number | undefined;
  let conteos: Record<string, number> | undefined;
  if (offset === 0) {
    const [r] = await base.execute<{ n: number }>(sql`
      ${conTodo(filtroCanal, vendedoraId, conEstado)},
      ${colgados}
      SELECT count(*)::int AS n
      ${desdeTodo(vendedoraId, conEstado)}
      ${donde(condiciones)}
    `);
    total = r?.n;
    conteos = await conteosPorEtapa(base, filtroCanal, condicionesBase, vendedoraId, conEstado);
  }

  return { conversaciones: filas as unknown[], total, conteos, hayMas: filas.length === limit };
}

/** El GROUP BY del embudo: una pasada, la misma definición y la misma ventana. */
async function conteosPorEtapa(
  base: typeof db,
  filtroCanal: SQL,
  condiciones: SQL[],
  vendedoraId: string | undefined,
  conEstado: boolean,
): Promise<Record<string, number>> {
  const donde = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``;
  const filas = await base.execute<{ etapa: string; n: number }>(sql`
    ${conTodo(filtroCanal, vendedoraId, conEstado)},
    ${colgados}
    SELECT (${etapaEfectivaSql}) AS etapa, count(*)::int AS n
    ${desdeTodo(vendedoraId, conEstado)}
    ${donde}
    GROUP BY 1
  `);
  return Object.fromEntries(filas.map((f) => [f.etapa, f.n]));
}

/**
 * EL EMBUDO DEL DASHBOARD (#89): conteos por etapa efectiva sobre la ventana de
 * 30 días de la cola. Reemplaza al conteo de toda la historia de `gestiones`
 * sin ventana — la dualidad que hacía incomparable el «N de M» del kanban.
 * Mismo seam que `/api/conversaciones`: si un día dicen cosas distintas, es un
 * bug de verdad, no una diferencia de definición.
 *
 * Sin vendedora: el embudo del Dashboard es del EQUIPO, no de una libreta
 * personal — el estado personal no lo filtra (la cola tampoco se filtra por
 * vendedora, ADR 0010).
 */
export async function contarPorEtapaEfectiva(base: typeof db): Promise<Record<string, number>> {
  return conteosPorEtapa(base, sql``, [], undefined, true);
}
