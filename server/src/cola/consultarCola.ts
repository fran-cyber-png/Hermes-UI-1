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
 * ESTADO PERSONAL (#49, ADR 0014): `fijada` (pin, banda arriba de todo aun fuera
 * de la ventana), `favorita`, `no_leido` (derivado del cursor `leido_hasta`) y
 * `categorias` conviven con la etapa efectiva en el MISMO SELECT — ninguno pisa
 * al otro. El estado sale de `estado_conversacion` (tabla con `db:push` manual):
 * si todavía no existe, la cola DEGRADA (sirve sin pin/no-leído) en vez de 500.
 */

/** La ventana de 7 días de Meta para el privado. IG también la tiene, no solo FB. */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND canal IN ('facebook','instagram') AND occurred_at > now() - interval '7 days')`;

/**
 * LA VENTANA DE LA COLA — hasta dónde mira «el trabajo pendiente». 30 días: es el
 * ciclo de venta de la Escuela, no una razón técnica. Sin esta cota el planner ni
 * usa el índice (escanea `events` entero). Medido: 482 ms → 3,4 ms.
 */
const ventanaCola = (columna: SQL) => sql`${columna} > now() - interval '30 days'`;

/**
 * La conversación fijada IGNORA la ventana (#49): `incluir` agrega un `OR clave
 * IN (pins)` para que una fijada vieja siga apareciendo. Se usa solo en la página
 * y el total (la vendedora las tiene ahí), nunca en los conteos del embudo (#89),
 * que son la foto de 30 días.
 */
const orEnPins = (clave: SQL, incluir: boolean) =>
  incluir ? sql` OR (${clave}) IN (SELECT clave FROM pins)` : sql``;

/** Los comentarios: una fila por interacción. Sin media → `ultima_clase` NULL. */
const comentariosCte = (filtroCanal: SQL, incluirPins: boolean) => sql`
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
    AND ((${ventanaCola(sql`occurred_at`)})${orEnPins(sql`'int:' || id::text`, incluirPins)})
    ${filtroCanal}
`;

/** Cada mensaje con su número propio y la CLASE de su media, sacados del evento. */
const msgCte = (filtroCanal: SQL, incluirPins: boolean) => sql`
  SELECT i.canal, i.persona_id, i.persona_nombre, i.texto, i.direccion, i.occurred_at,
         COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
         e.payload->'media'->>'clase'             AS clase,
         e.payload->'origen'                      AS origen
  FROM interactions i
  JOIN events e ON e.id = i.event_id
  WHERE i.tipo = 'mensaje'
    AND ((${ventanaCola(sql`i.occurred_at`)})${orEnPins(
      sql`'conv:' || i.canal || ':' || i.persona_id || ':' || COALESCE(e.payload->>'numeroPropio', '')`,
      incluirPins,
    )})
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
    max(occurred_at) FILTER (WHERE direccion = 'entrante')          AS ultimo_entrante_at,
    (${respondidaSql})                                              AS respondida,
    false                                                          AS ventana_abierta,
    -- «Pide info» del ÚLTIMO entrante con texto, no un bool_or histórico (#49):
    -- mismo fragmento que el radar — una sola semántica (ADR 0014).
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
 * `pins` (opcional, #49): cuando se pasa, las conversaciones fijadas entran
 * aunque estén fuera de la ventana de 30 días. Los conteos del embudo lo pasan
 * en `null` — su universo es la ventana, sin excepciones personales.
 */
const conTodo = (filtroCanal: SQL, pins: SQL | null) => sql`
  WITH ${pins ? sql`pins AS (${pins}),
  ` : sql``}msg AS (
    ${msgCte(filtroCanal, pins != null)}
  ),
  todo AS (
    ${comentariosCte(filtroCanal, pins != null)}
    UNION ALL
    ${conversacionesCte}
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
  /** true = la cola vino SIN estado personal (la tabla no existe todavía, #49). */
  sinEstado?: boolean;
}

/**
 * La cola, con degradación honesta (#49, ADR 0014): si `estado_conversacion`
 * todavía no existe (el `db:push` es manual), reintenta SIN el estado personal
 * en vez de tirar 500 y dejar a la vendedora sin mesa de trabajo.
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
      "[cola] `estado_conversacion` no existe: sirvo la cola SIN pin/favorita/no-leído. " +
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
  // Solo hay pins que respetar si hay vendedora Y la tabla existe.
  const pins = conEstado && vendedoraId ? pinsCteSql(vendedoraId) : null;

  // Las condiciones se acumulan y se dicen UNA vez: la intención (como siempre)
  // y la etapa efectiva (#89). `condicionesBase` es lo que comparten la página,
  // el total y los conteos; el filtro de etapa/tab/categoría solo recorta la
  // página y el total (los conteos son del embudo, no de la vendedora).
  const condicionesBase: SQL[] = [];
  if (intencion === "pide-info") condicionesBase.push(sql`pide_info`);
  if (intencion === "por-vencer") condicionesBase.push(sql`ventana_abierta`);
  // Compat: la cola vieja mandaba `puedo-escribirle`; el front nuevo usa tabs.
  if (intencion === "puedo-escribirle") condicionesBase.push(sql`(ventana_abierta OR tipo = 'mensaje')`);

  const condiciones = [...condicionesBase];
  if (etapa) condiciones.push(sql`(${etapaEfectivaSql}) = ${etapa}`);
  // Los tabs personales (#49) solo con la tabla presente; la categoría vive en
  // `etiquetas`, así que filtra igual aunque el estado personal no exista.
  if (conEstado && tab === "no-leidos") condiciones.push(sql`(${noLeidoSql})`);
  if (conEstado && tab === "favoritos") condiciones.push(sql`COALESCE(ec.favorita, false)`);
  if (categoria) condiciones.push(sql`${categoria} = ANY(COALESCE(cats.categorias, '{}'::text[]))`);

  const donde = (c: SQL[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);

  // El orden es la urgencia canónica (cola/urgenciaSql.ts) con la BANDA DE PIN
  // encima (#49): las fijadas arriba de todo, dentro de la banda sigue mandando
  // el nivel 0–5. `etapa_manual` llega de la última gestión (etapaEfectivaSql.ts);
  // el estado personal, del LEFT JOIN a `estado_conversacion`.
  const filas = await base.execute(sql`
    ${conTodo(filtroCanal, pins)},
    seguimientos AS (
      ${seguimientosPendientesSql}
    ),
    ultimas_gestiones AS (
      ${ultimasGestionesSql}
    ),
    cats AS (
      ${categoriasCteSql}
    )
    SELECT todo.clave AS clave, canal, tipo, persona_id, persona_nombre, numero_propio,
           texto, contexto_texto, ultima_clase, ultima_origen, respondida, ventana_abierta, pide_info, n,
           referencia, ultimo_at, seguimiento_en,
           etapa_manual,
           (${etapaEfectivaSql}) AS etapa_efectiva,
           extract(day from now() - referencia)::int AS dias,
           (${nivelUrgenciaSql}) AS nivel,
           (${ordenUrgenciaSql}) AS orden,
           COALESCE(ec.fijada, false)   AS fijada,
           ec.fijada_at,
           COALESCE(ec.favorita, false) AS favorita,
           (${noLeidoSql})              AS no_leido,
           COALESCE(cats.categorias, '{}'::text[]) AS categorias
    FROM todo
    LEFT JOIN seguimientos USING (clave)
    LEFT JOIN ultimas_gestiones USING (clave)
    ${estadoJoinSql(vendedoraId, conEstado)}
    LEFT JOIN cats ON cats.clave = todo.clave
    ${donde(condiciones)}
    ORDER BY ${bandaPinOrdenSql}, nivel ASC, orden ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total y los conteos solo en la primera página: recontar en cada scroll
  // no aporta. Con `?etapa=`/tab/categoría el total ES el del recorte — la carga
  // incremental por columna del tablero (#90) es honesta por construcción.
  let total: number | undefined;
  let conteos: Record<string, number> | undefined;
  if (offset === 0) {
    const [r] = await base.execute<{ n: number }>(sql`
      ${conTodo(filtroCanal, pins)},
      ultimas_gestiones AS (${ultimasGestionesSql}),
      cats AS (${categoriasCteSql})
      SELECT count(*)::int AS n
      FROM todo
      LEFT JOIN ultimas_gestiones USING (clave)
      ${estadoJoinSql(vendedoraId, conEstado)}
      LEFT JOIN cats ON cats.clave = todo.clave
      ${donde(condiciones)}
    `);
    total = r?.n;
    conteos = await conteosPorEtapa(base, filtroCanal, condicionesBase);
  }

  return { conversaciones: filas as unknown[], total, conteos, hayMas: filas.length === limit };
}

/** El GROUP BY del embudo: una pasada, la misma definición y la misma ventana. */
async function conteosPorEtapa(
  base: typeof db,
  filtroCanal: SQL,
  condiciones: SQL[],
): Promise<Record<string, number>> {
  const donde = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``;
  const filas = await base.execute<{ etapa: string; n: number }>(sql`
    ${conTodo(filtroCanal, null)},
    ultimas_gestiones AS (${ultimasGestionesSql})
    SELECT (${etapaEfectivaSql}) AS etapa, count(*)::int AS n
    FROM todo
    LEFT JOIN ultimas_gestiones USING (clave)
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
 */
export async function contarPorEtapaEfectiva(base: typeof db): Promise<Record<string, number>> {
  return conteosPorEtapa(base, sql``, []);
}
