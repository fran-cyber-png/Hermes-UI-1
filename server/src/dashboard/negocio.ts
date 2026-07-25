import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { respondidaSql } from "../cola/urgenciaSql.js";
import { etapaEfectivaSql, ultimasGestionesSql } from "../cola/etapaEfectivaSql.js";
import { sufijoTelefonoSql } from "../gente/leadDeTelefono.js";
import { horaDelDiaLimaSql } from "../lib/horaLimaSql.js";
import { HORA_APERTURA, HORA_CIERRE, horasDelDia } from "./horarioAtencion.js";

/**
 * EL PANEL DEL NEGOCIO — la otra pregunta del Dashboard (#128, #126).
 *
 * El radar responde «¿a quién atiendo AHORA?». Esto responde la del que pone la
 * plata: **«¿qué curso se está vendiendo, cuál estoy dejando pasar, y en qué
 * anuncio conviene invertir?»** — por período, por número propio, por curso o
 * por anuncio.
 *
 * TODO ES DERIVADO EN CONSULTA. No hay tabla de métricas, no hay job nocturno,
 * no hay backfill: los mismos hechos que ya están en `interactions` + `events` +
 * `leads` + `gestiones`, leídos de otra manera. Si mañana entra un mensaje, el
 * panel lo refleja sin migrar nada — y nunca puede quedar «desincronizado» con
 * la cola, porque no hay dos copias del dato.
 *
 * NO REESCRIBE NINGUNA DEFINICIÓN QUE YA EXISTA. Eso no es prolijidad, es la
 * lección de #37 (la urgencia escrita dos veces divergió en silencio) y de #96:
 *   · `respondida`   ← `cola/urgenciaSql.ts`
 *   · etapa efectiva ← `cola/etapaEfectivaSql.ts` (ADR 0013) + `ultimasGestionesSql`
 *   · sufijo de match ← `gente/leadDeTelefono.ts`
 *   · corte de día / hora de Lima ← `lib/horaLimaSql.ts` (#4)
 * Lo único que este módulo define por su cuenta —y lo define UNA vez, acá— es
 * «primera respuesta», «precio mencionado» y el curso de un lead.
 *
 * COSTO: el CTE `msgs` escanea `interactions` entero (join a `events` por el
 * `numeroPropio`, que es parte de la clave de conversación). Es a propósito:
 * «llegaron» significa PRIMER entrante de esa conversación, y con un piso de
 * scan el mismo hilo se contaría como nuevo en cada período. Es una consulta de
 * panel, no de la cola: se pide cuando alguien mira, no en cada tecla. Si algún
 * día molesta, el lugar es #29 (rendimiento), no bajar la exactitud.
 */

// ── Las definiciones nuevas, cada una en un solo lugar ───────────────────────

/**
 * ¿ESTE SALIENTE MENCIONÓ UN PRECIO? — el proxy honesto de «se cotizó».
 *
 * Existe porque los datos dijeron algo incómodo: hay **611 conversaciones con
 * precio enviado y UN solo interés registrado** en toda la base. La compuerta de
 * Cotizado exige que alguien tipee el curso, así que la columna «Cotizados» del
 * embudo marca casi cero aunque el trabajo se hizo. Un panel que mostrara solo
 * «Cotizados: 3» estaría dando un número que parece verdad y no lo es.
 *
 * Esto NO reemplaza la etapa efectiva: la acompaña. La pantalla muestra los dos
 * y dice cuál es cuál — «3 cotizados asentados · 611 con precio mencionado
 * (estimado por el texto)». Es una estimación por texto y se rotula como tal:
 * un «te paso el precio» sin monto también cae acá, y una imagen con la lista de
 * precios no cae. Sirve para medir el HUECO de registro, no para reemplazarlo.
 */
const PRECIO_REGEX_SQL = `'(s/\\.?\\s*[0-9]|us\\$|usd|\\$\\s*[0-9]|precio|costo|inversi[óo]n|matr[íi]cula)'`;

/**
 * EL CURSO QUE LA PERSONA ELIGIÓ, según su formulario.
 *
 * `campaign_name` primero porque es donde cae el curso en las dos fuentes que
 * hoy tienen volumen: en las landings de icarus el ingestor mapea ahí el
 * `product_name` (`icarus/mapeo.ts`), y en los lead-forms de Meta la campaña es
 * la que nombra el diploma. `form_name` es el respaldo, sin el namespace
 * `icarus:` —que es plomería, no un curso— para que no aparezca como si lo fuera.
 *
 * Es el nombre CRUDO del formulario, no un id canónico: dos escrituras del mismo
 * diploma son hoy dos filas. La tabla de alias hacia el `producto_id` de Cerberus
 * es el T1 de #128; hasta entonces la pantalla muestra lo que dice el dato.
 */
const CURSO_DE_LEAD = sql`NULLIF(
  btrim(COALESCE(
    NULLIF(btrim(campaign_name), ''),
    regexp_replace(COALESCE(form_name, ''), '^icarus:', '')
  )),
  ''
)`;

// ── El contrato ──────────────────────────────────────────────────────────────

export const DIMENSIONES = ["curso", "anuncio"] as const;
export type Dimension = (typeof DIMENSIONES)[number];

/** Una fila de la tabla del negocio: un curso o un anuncio, y qué pasó con su gente. */
export type FilaNegocio = {
  /** Nombre del curso o título del anuncio. `null` = no se pudo atribuir. */
  clave: string | null;
  /** El `adId` de Meta cuando la dimensión es anuncio; `null` en la de curso. */
  ad_id: string | null;
  llegaron: number;
  respondidos: number;
  nunca_respondidos: number;
  /** La última palabra es de la persona: el número que duele. */
  esperan: number;
  /** Minutos hasta la primera respuesta, mediana. `null` si nadie respondió nunca. */
  demora_mediana_min: number | null;
  cotizados: number;
  cerrados: number;
  precio_mencionado: number;
};

export type PuntoCobertura = { hora: number; entran: number; salen: number };

export interface Atencion {
  /** Conversaciones cuyo PRIMER entrante cayó en el período. */
  conversaciones: number;
  esperan: number;
  nunca_respondidos: number;
  sin_atender_24h: number;
  demora_mediana_en_horario_min: number | null;
  demora_mediana_fuera_min: number | null;
  llegaron_fuera_de_horario: number;
  /** 24 puntos, siempre: mensajes que ENTRAN vs. mensajes que SALEN por hora de Lima. */
  cobertura: PuntoCobertura[];
}

export interface Negocio {
  rango: { desde: string; hasta: string };
  /** Los números propios con actividad en el período (+ los activos declarados). */
  numeros: string[];
  numero_propio: string | null;
  dimension: Dimension;
  atencion: Atencion;
  filas: FilaNegocio[];
  /** Conversaciones del período que ninguna fila pudo nombrar. La cobertura, dicha. */
  sin_atribuir: number;
  /** El hueco de registro del embudo: lo asentado contra lo que dice el texto. */
  subregistro: { cotizados: number; precio_mencionado: number };
}

export interface OpcionesNegocio {
  desde: Date;
  hasta: Date;
  ahora: Date;
  dimension: Dimension;
  numeroPropio?: string | null;
}

// ── El SQL ───────────────────────────────────────────────────────────────────

/**
 * EL CTE COMPARTIDO: una fila por conversación NACIDA en el período, con todo lo
 * que las tres lecturas necesitan. Se arma una vez y lo consumen las dos
 * consultas de abajo — así la tabla por curso y el bloque de atención no pueden
 * contar universos distintos (que es exactamente lo que pasaba entre el embudo
 * del Dashboard y la cola antes del ADR 0013).
 */
function conversacionesDelPeriodo(o: OpcionesNegocio): SQL {
  const desde = o.desde.toISOString();
  const hasta = o.hasta.toISOString();
  const filtroNumero = o.numeroPropio
    ? sql`AND COALESCE(e.payload->>'numeroPropio', '') = ${o.numeroPropio}`
    : sql``;

  return sql`
    WITH msgs AS (
      SELECT i.canal, i.persona_id, i.direccion, i.occurred_at, i.texto,
             COALESCE(e.payload->>'numeroPropio', '') AS numero_propio,
             e.payload->'origen'                      AS origen
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje' AND i.persona_id IS NOT NULL
      ${filtroNumero}
    ),
    conv AS (
      SELECT
        'conv:' || canal || ':' || persona_id || ':' || numero_propio AS clave,
        canal, persona_id,
        NULLIF(numero_propio, '')                                    AS numero_propio,
        numero_propio                                                AS numero_crudo,
        min(occurred_at) FILTER (WHERE direccion = 'entrante')        AS llego_at,
        max(occurred_at) FILTER (WHERE direccion = 'entrante')        AS ultimo_entrante,
        -- La MISMA definición que la cola y el radar (cola/urgenciaSql.ts):
        -- hay un saliente igual o posterior al último entrante.
        (${respondidaSql})                                            AS respondida,
        -- El origen del PRIMER mensaje: por dónde entró esta persona. Los
        -- mensajes siguientes ya no traen anuncio, así que el primero es el que
        -- sabe (y el que no cambia si la conversación sigue).
        (array_agg(origen ORDER BY occurred_at)
           FILTER (WHERE origen IS NOT NULL))[1]                      AS origen,
        bool_or(direccion = 'saliente' AND texto ~* ${sql.raw(PRECIO_REGEX_SQL)}) AS precio_mencionado
      FROM msgs
      GROUP BY canal, persona_id, numero_propio
      -- «Llegaron» = el PRIMER entrante cae en el período. Una conversación de
      -- hace un mes que escribe hoy NO es un lead nuevo de hoy.
      HAVING min(occurred_at) FILTER (WHERE direccion = 'entrante') >= ${desde}::timestamptz
         AND min(occurred_at) FILTER (WHERE direccion = 'entrante') <  ${hasta}::timestamptz
    ),
    -- LA PRIMERA RESPUESTA: el primer saliente POSTERIOR al primer entrante. No
    -- alcanza con min(saliente): cuando la vendedora escribió primero
    -- (prospección), ese saliente es anterior y la demora daría negativa o nula.
    primera_respuesta AS (
      SELECT c.clave, min(m.occurred_at) AS respondido_at
      FROM conv c
      JOIN msgs m
        ON m.canal = c.canal AND m.persona_id = c.persona_id AND m.numero_propio = c.numero_crudo
      WHERE m.direccion = 'saliente' AND m.occurred_at > c.llego_at
      GROUP BY c.clave
    ),
    base AS (
      SELECT c.*, pr.respondido_at, g.etapa_manual,
             (${etapaEfectivaSql}) AS etapa_efectiva,
             (extract(epoch from (pr.respondido_at - c.llego_at)) / 60)::float8 AS demora_min,
             (${horaDelDiaLimaSql("c.llego_at")}) AS hora_llegada
      FROM conv c
      LEFT JOIN primera_respuesta pr USING (clave)
      LEFT JOIN (${ultimasGestionesSql}) g USING (clave)
    )
  `;
}

/** `interval` de 24 h expresado sobre el reloj que manda (`ahora`), no `now()`. */
const HACE_24H = (ahora: Date): SQL => sql`(${ahora.toISOString()}::timestamptz - interval '24 hours')`;

/** La mediana en minutos, redondeada a un decimal. `null` cuando no hay muestras. */
const medianaSql = (filtro: SQL): SQL =>
  sql`round((percentile_cont(0.5) WITHIN GROUP (ORDER BY demora_min) FILTER (WHERE ${filtro}))::numeric, 1)::float8`;

const EN_HORARIO = sql`(hora_llegada >= ${HORA_APERTURA} AND hora_llegada < ${HORA_CIERRE})`;

/** Las columnas de embudo que comparten la tabla por curso y la por anuncio. */
const METRICAS_DE_FILA: SQL = sql`
  count(*)::int                                                        AS llegaron,
  count(*) FILTER (WHERE b.respondido_at IS NOT NULL)::int              AS respondidos,
  count(*) FILTER (WHERE b.respondido_at IS NULL)::int                  AS nunca_respondidos,
  count(*) FILTER (WHERE NOT b.respondida)::int                         AS esperan,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY b.demora_min))::numeric, 1)::float8 AS demora_mediana_min,
  count(*) FILTER (WHERE b.etapa_efectiva = 'cotizado')::int            AS cotizados,
  count(*) FILTER (WHERE b.etapa_efectiva = 'cierre')::int              AS cerrados,
  count(*) FILTER (WHERE b.precio_mencionado)::int                      AS precio_mencionado
`;

// ── El seam ──────────────────────────────────────────────────────────────────

export async function consultarNegocio(base: typeof db, o: OpcionesNegocio): Promise<Negocio> {
  const desde = o.desde.toISOString();
  const hasta = o.hasta.toISOString();
  const conBase = conversacionesDelPeriodo(o);

  // ── 1 · La atención: los cuatro números y las dos medianas (#126) ──────────
  const [atencion] = await base.execute<{
    conversaciones: number;
    esperan: number;
    nunca_respondidos: number;
    sin_atender_24h: number;
    demora_en_horario: number | null;
    demora_fuera: number | null;
    llegaron_fuera: number;
    cotizados: number;
    precio_mencionado: number;
  }>(sql`
    ${conBase}
    SELECT
      count(*)::int                                                       AS conversaciones,
      count(*) FILTER (WHERE NOT respondida)::int                         AS esperan,
      count(*) FILTER (WHERE respondido_at IS NULL)::int                  AS nunca_respondidos,
      count(*) FILTER (WHERE NOT respondida
                         AND ultimo_entrante < ${HACE_24H(o.ahora)})::int AS sin_atender_24h,
      ${medianaSql(EN_HORARIO)}                                           AS demora_en_horario,
      ${medianaSql(sql`NOT ${EN_HORARIO}`)}                               AS demora_fuera,
      count(*) FILTER (WHERE NOT ${EN_HORARIO})::int                      AS llegaron_fuera,
      count(*) FILTER (WHERE etapa_efectiva = 'cotizado')::int            AS cotizados,
      count(*) FILTER (WHERE precio_mencionado)::int                      AS precio_mencionado
    FROM base
  `);

  // ── 2 · La cobertura horaria: entran vs. salen, hora por hora (#126) ───────
  // Escaneo propio y acotado al período: acá el sujeto son los MENSAJES (el
  // tráfico), no las conversaciones nuevas — es lo que muestra el agujero de la
  // noche. Las 24 horas salen de `generate_series`, no de los datos: una hora
  // sin un solo mensaje tiene que dibujarse igual, porque ese hueco ES el dato.
  const filtroNumeroCobertura = o.numeroPropio
    ? sql`AND COALESCE(e.payload->>'numeroPropio', '') = ${o.numeroPropio}`
    : sql``;
  const cobertura = await base.execute<PuntoCobertura>(sql`
    WITH horas AS (SELECT generate_series(0, 23) AS hora),
    m AS (
      SELECT i.direccion, ${horaDelDiaLimaSql("i.occurred_at")} AS hora
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.occurred_at >= ${desde}::timestamptz
        AND i.occurred_at <  ${hasta}::timestamptz
      ${filtroNumeroCobertura}
    )
    SELECT h.hora,
           count(*) FILTER (WHERE m.direccion = 'entrante')::int AS entran,
           count(*) FILTER (WHERE m.direccion = 'saliente')::int AS salen
    FROM horas h
    LEFT JOIN m ON m.hora = h.hora
    GROUP BY h.hora
    ORDER BY h.hora
  `);

  // ── 3 · La tabla del negocio: por curso o por anuncio ──────────────────────
  const filas = await base.execute<FilaNegocio>(
    o.dimension === "curso"
      ? sql`
        ${conBase},
        -- El lead que nombra el curso, uno por teléfono. El desempate es
        -- DISTINTO al de la ficha (gente/emparejar.ts, que prioriza el EMAIL) y
        -- es a propósito: acá la pregunta es «¿qué diploma quería?», no «¿con
        -- qué lo cotizo?». Primero el que dice un curso, después el más reciente.
        leads_curso AS (
          SELECT DISTINCT ON (sufijo) sufijo, curso
          FROM (
            SELECT ${sufijoTelefonoSql("phone")} AS sufijo,
                   ${CURSO_DE_LEAD}              AS curso,
                   created_time
            FROM leads
            WHERE phone IS NOT NULL
          ) x
          WHERE length(sufijo) = 9
          ORDER BY sufijo, (curso IS NOT NULL) DESC, created_time DESC
        )
        SELECT lc.curso AS clave, NULL::text AS ad_id, ${METRICAS_DE_FILA}
        FROM base b
        -- Solo WhatsApp: en Messenger/Instagram el persona_id es un id de
        -- plataforma, y sacarle «los últimos 9 dígitos» produciría un match por
        -- casualidad. Un cruce falso es peor que un «sin atribuir» honesto.
        LEFT JOIN leads_curso lc
          ON b.canal = 'whatsapp' AND lc.sufijo = ${sufijoTelefonoSql("b.persona_id")}
        GROUP BY lc.curso
        ORDER BY llegaron DESC, clave NULLS LAST
      `
      : sql`
        ${conBase}
        SELECT b.origen->>'titulo' AS clave, b.origen->>'adId' AS ad_id, ${METRICAS_DE_FILA}
        FROM base b
        GROUP BY b.origen->>'titulo', b.origen->>'adId'
        ORDER BY llegaron DESC, clave NULLS LAST
      `,
  );

  // ── 4 · Los números propios que existen en este período (#50) ─────────────
  // Sin filtrar por el número elegido a propósito: el selector tiene que poder
  // volver a los otros. `numeros_wa` entra por si un número declarado todavía no
  // tuvo tráfico — que aparezca vacío también es información.
  const numeros = await base.execute<{ numero: string }>(sql`
    SELECT DISTINCT numero FROM (
      SELECT NULLIF(e.payload->>'numeroPropio', '') AS numero
      FROM interactions i
      JOIN events e ON e.id = i.event_id
      WHERE i.tipo = 'mensaje'
        AND i.occurred_at >= ${desde}::timestamptz
        AND i.occurred_at <  ${hasta}::timestamptz
      UNION
      SELECT numero FROM numeros_wa WHERE activo
    ) x
    WHERE numero IS NOT NULL
    ORDER BY numero
  `);

  const sinAtribuir = filas.filter((f) => f.clave === null).reduce((n, f) => n + f.llegaron, 0);

  return {
    rango: { desde, hasta },
    numeros: numeros.map((n) => n.numero),
    numero_propio: o.numeroPropio ?? null,
    dimension: o.dimension,
    atencion: {
      conversaciones: atencion?.conversaciones ?? 0,
      esperan: atencion?.esperan ?? 0,
      nunca_respondidos: atencion?.nunca_respondidos ?? 0,
      sin_atender_24h: atencion?.sin_atender_24h ?? 0,
      demora_mediana_en_horario_min: atencion?.demora_en_horario ?? null,
      demora_mediana_fuera_min: atencion?.demora_fuera ?? null,
      llegaron_fuera_de_horario: atencion?.llegaron_fuera ?? 0,
      // Las 24 horas siempre, incluso si la consulta volviera corta.
      cobertura: horasDelDia().map(
        (hora) => cobertura.find((c) => c.hora === hora) ?? { hora, entran: 0, salen: 0 },
      ),
    },
    filas,
    sin_atribuir: sinAtribuir,
    subregistro: {
      cotizados: atencion?.cotizados ?? 0,
      precio_mencionado: atencion?.precio_mencionado ?? 0,
    },
  };
}
