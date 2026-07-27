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
  vivaSql,
} from "./urgenciaSql.js";
import { etapaEfectivaSql, ultimasGestionesSql } from "./etapaEfectivaSql.js";
import { precioEnviadoSql } from "./precio.js";
import {
  bandaPinOrdenSql,
  categoriasCteSql,
  esTablaAusente,
  estadoJoinSql,
  noLeidoSql,
  pinsCteSql,
} from "./estadoSql.js";
import {
  interesUltimoCteSql,
  leadCursoCteSql,
  leadCursoJoinSql,
  sufijosDeLaColaCteSql,
} from "./cursoSql.js";
import { padronCteSql, padronJoinSql, yaComproSql } from "./clienteSql.js";

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
 *
 * CURSO (#72): `interes_curso` y `lead_curso` son los CANDIDATOS del chip de
 * curso de la fila — el interés más reciente y el curso del formulario que la
 * persona llenó (emparejado por teléfono); `lead_nombre` es el nombre con el que
 * lo llenó, del MISMO lead. Salen del listado, no de un fetch por fila. Los
 * fragmentos viven en `cola/cursoSql.ts`; la PRECEDENCIA entre ellos y el
 * anuncio (`ultima_origen`) la decide el front, puro y testeado. Solo se
 * calculan en la consulta de la PÁGINA: ni el total ni los conteos del embudo
 * pagan el join a `leads`.
 *
 * EX-CLIENTE (#133): `cliente_nivel` y `cliente_compras` dicen si quien escribe
 * YA LE COMPRÓ a Goberna, y cuánto. 140 de las 1.997 conversaciones vivas son de
 * gente que ya pagó y hasta hoy se veían igual que un desconocido. Sale del
 * cruce por teléfono contra la copia local del padrón (`cola/clienteSql.ts`), en
 * ESTA misma pasada — nunca de una llamada a Cerberus por fila, que es
 * exactamente lo que hacía inviable tenerlo en el listado.
 *
 * Son la ÚNICA fuente del curso de una fila (#137). El Pipeline llegó a este
 * mismo dato por otro camino —un cruce contra `leads` después del `LIMIT`, más
 * un `cursos[]` con todos los intereses— y esa segunda escritura se borró antes
 * de nacer: la misma persona no puede salir con un curso en Mensajes y con otro
 * en su tarjeta del Pipeline (la lección de #37, ADR 0016).
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
    NULL::jsonb                                 AS origen_anuncio,
    false                                       AS precio_enviado,
    occurred_at                                 AS referencia,
    occurred_at                                 AS ultimo_at,
    occurred_at                                 AS ultimo_entrante_at,
    (status <> 'nuevo')                         AS respondida,
    (status <> 'nuevo')                         AS ya_le_hablamos,
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
    -- El PRIMER anuncio de la conversación, que es de donde sale el CURSO (#128).
    -- Es distinto de ultima_origen y la diferencia importaba: el referral de
    -- Click-to-WhatsApp viaja SOLO en el primer mensaje, así que en cuanto la
    -- persona escribe una segunda vez ultima_origen es NULL y el chip perdía el
    -- anuncio. El Dashboard siempre miró el primero (dashboard/negocio.ts) —
    -- esta columna es la que hace que los dos cuenten lo mismo.
    (array_agg(origen ORDER BY occurred_at)
       FILTER (WHERE origen->>'fuente' = 'anuncio'))[1]             AS origen_anuncio,
    -- ¿Ya le pasamos el precio? (cola/precio.ts): el hecho comercial que el
    -- embudo no veía — 611 conversaciones con precio enviado y 1 interés
    -- registrado en toda la base. Es derivado de lo escrito, no un estado.
    (${precioEnviadoSql})                                           AS precio_enviado,
    (${referenciaSql})                                              AS referencia,
    max(occurred_at)                                                AS ultimo_at,
    max(occurred_at) FILTER (WHERE direccion = 'entrante')          AS ultimo_entrante_at,
    (${respondidaSql})                                              AS respondida,
    -- ¿Alguna vez le hablamos? Distinto de respondida, que es de quién es el
    -- turno HOY: una persona a la que ya atendimos y que volvió a escribir
    -- vuelve a ser deuda, pero no es una desconocida. La bandeja necesita
    -- separarlas — hoy les dice a las dos «nadie te respondió».
    COALESCE(bool_or(direccion = 'saliente'), false)                 AS ya_le_hablamos,
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
  /** Solo las que YA tienen precio enviado (cola/precio.ts). El recorte del negocio. */
  precio?: boolean;
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
  /**
   * Cuántas filas daría cada filtro secundario DENTRO del recorte actual (tab +
   * categoría + etapa), sin aplicar el filtro mismo. Es lo que hace que el chip
   * diga «Piden info · 311» en vez de ser una lotería: un filtro sin su número
   * obliga a probarlo para saber si vale la pena, y con 1.867 conversaciones eso
   * es un salto al vacío. Sale de la MISMA consulta que el total, sin costo extra.
   */
  conteosFiltro?: { pideInfo: number; sinResponder: number; yaCompraron: number };
  /**
   * La MISMA foto, abierta por las preguntas que el tablero no sabía responder —
   * de una sola pasada. Es lo que hace navegables 1.389 tarjetas: cuántas de la
   * bandeja son gente a la que ya le hablamos, cuántas están escribiendo AHORA,
   * y cuántos silencios ya tienen un precio encima. NO se recorta con el filtro
   * de la columna (si no, la banda diría el tamaño del recorte, no el suyo).
   */
  desglose?: FilaDesglose[];
  /** true = la cola vino SIN estado personal (la tabla no existe todavía, #49). */
  sinEstado?: boolean;
  /** true = la cola vino SIN la marca de ex-cliente (falta el `db:push` de #133). */
  sinPadron?: boolean;
}

/** Una celda del desglose: etapa × ya-le-hablamos × precio × viva, con su conteo. */
export type FilaDesglose = {
  etapa: string;
  /** ¿Alguna vez salió un mensaje nuestro? Distinto de `respondida` (eso es el turno de HOY). */
  yaLeHablamos: boolean;
  precio: boolean;
  /** Nivel 0 de la urgencia: entrante sin responder de menos de 24 h. Alguien está hablando. */
  viva: boolean;
  n: number;
};

/**
 * La cola, con degradación honesta (#49, ADR 0014): las tablas que se crean con
 * un `db:push` manual pueden faltar en un server ya desplegado, y ninguna de
 * ellas vale un 500 que deje a la vendedora sin mesa de trabajo. Se apaga lo que
 * falta —el estado personal, la marca de ex-cliente— y se DICE en la respuesta.
 *
 * El orden importa: primero se apaga lo que el error nombra (así un
 * `clientes_padron` ausente no se lleva puestos el pin y el no-leído, que son de
 * otra tabla), y solo si eso no alcanza se apaga lo demás.
 */
export async function consultarCola(
  base: typeof db,
  opciones: OpcionesCola = {},
): Promise<ResultadoCola> {
  let conEstado = true;
  let conPadron = true;

  // Dos degradaciones posibles ⇒ como mucho tres intentos.
  for (let intento = 0; ; intento++) {
    try {
      const r = await ejecutarCola(base, opciones, conEstado, conPadron);
      return {
        ...r,
        ...(conEstado ? {} : { sinEstado: true }),
        ...(conPadron ? {} : { sinPadron: true }),
      };
    } catch (e) {
      if (!esTablaAusente(e) || intento >= 2) throw e;
      if (conPadron && mencionaTabla(e, "clientes_padron")) {
        console.warn(
          "[cola] `clientes_padron` no existe: sirvo la cola SIN la marca de ex-cliente. " +
            "Corré `npm run db:push` (#133).",
        );
        conPadron = false;
        continue;
      }
      if (conEstado) {
        console.warn(
          "[cola] `estado_conversacion` no existe: sirvo la cola SIN pin/favorita/no-leído. " +
            "Corré `npm run db:push` (ADR 0014).",
        );
        conEstado = false;
        continue;
      }
      conPadron = false;
    }
  }
}

/** ¿El error de tabla ausente habla de ESTA tabla? Decide QUÉ se apaga. */
function mencionaTabla(e: unknown, tabla: string): boolean {
  for (let actual: unknown = e, saltos = 0; actual != null && saltos < 5; saltos++) {
    if (typeof actual !== "object") break;
    const mensaje = (actual as { message?: unknown }).message;
    if (typeof mensaje === "string" && mensaje.includes(tabla)) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

async function ejecutarCola(
  base: typeof db,
  opciones: OpcionesCola,
  conEstado: boolean,
  conPadron: boolean,
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
  // `sin-responder`: la deuda real de la mesa. Reusa la columna `respondida` que
  // ya deriva `urgenciaSql.ts` — no define ningún criterio propio.
  if (intencion === "sin-responder") condicionesBase.push(sql`NOT respondida`);
  // `por-vencer` sigue aceptándose aunque el panel ya no tenga su chip: el
  // contrato de la API no se rompe por un cambio de UI (ver `src/features/canales/cola.ts`).
  if (intencion === "por-vencer") condicionesBase.push(sql`ventana_abierta`);
  // «Ya compraron» (#133): 140 conversaciones que valen oro, a un clic. Reusa el
  // predicado de `cola/clienteSql.ts` — la página, el total, el número del chip
  // y el desglose leen LA MISMA definición.
  if (intencion === "ya-compraron") condicionesBase.push(yaComproSql);
  // Compat: la cola vieja mandaba `puedo-escribirle`; el front nuevo usa tabs.
  if (intencion === "puedo-escribirle") condicionesBase.push(sql`(ventana_abierta OR tipo = 'mensaje')`);

  // El RECORTE (tab, categoría, etapa, precio) es lo que sigue valiendo cuando se
  // apaga el filtro secundario: por eso va aparte, y por eso los conteos de los
  // chips pueden decir «cuántas habría si tocás esto» sin una consulta más.
  const condicionesRecorte: SQL[] = [];
  if (etapa) condicionesRecorte.push(sql`(${etapaEfectivaSql}) = ${etapa}`);
  // El recorte «Con precio» del Pipeline: es una columna más del tablero, no un
  // filtro secundario — el total tiene que decir el tamaño de LO RECORTADO.
  if (opciones.precio) condicionesRecorte.push(sql`precio_enviado`);
  // Los tabs personales (#49) solo con la tabla presente; la categoría vive en
  // `etiquetas`, así que filtra igual aunque el estado personal no exista.
  if (conEstado && tab === "no-leidos") condicionesRecorte.push(sql`(${noLeidoSql})`);
  if (conEstado && tab === "favoritos") condicionesRecorte.push(sql`COALESCE(ec.favorita, false)`);
  if (categoria) condicionesRecorte.push(sql`${categoria} = ANY(COALESCE(cats.categorias, '{}'::text[]))`);

  const condiciones = [...condicionesBase, ...condicionesRecorte];

  const donde = (c: SQL[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);
  const yTodas = (c: SQL[]) => (c.length ? sql.join(c, sql` AND `) : sql`true`);

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
    ),
    interes_ultimo AS (
      ${interesUltimoCteSql}
    ),
    sufijos AS (
      ${sufijosDeLaColaCteSql}
    ),
    lead_curso AS (
      ${leadCursoCteSql}
    ),
    padron AS (
      ${padronCteSql(conPadron)}
    )
    SELECT todo.clave AS clave, canal, tipo, persona_id, persona_nombre, numero_propio,
           texto, contexto_texto, ultima_clase, ultima_origen, origen_anuncio, respondida, ya_le_hablamos,
           precio_enviado, ventana_abierta, pide_info, n,
           referencia, ultimo_at, seguimiento_en,
           etapa_manual,
           iu.curso AS interes_curso,
           lc.curso AS lead_curso,
           lc.nombre AS lead_nombre,
           pc.nivel AS cliente_nivel,
           pc.compras AS cliente_compras,
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
    LEFT JOIN interes_ultimo iu ON iu.clave = todo.clave
    ${leadCursoJoinSql}
    ${padronJoinSql(conPadron)}
    ${donde(condiciones)}
    ORDER BY ${bandaPinOrdenSql}, nivel ASC, orden ASC
    LIMIT ${limit} OFFSET ${offset}
  `);

  // El total y los conteos solo en la primera página: recontar en cada scroll
  // no aporta. Con `?etapa=`/tab/categoría el total ES el del recorte — la carga
  // incremental por columna del tablero (#90) es honesta por construcción.
  let total: number | undefined;
  let conteos: Record<string, number> | undefined;
  let conteosFiltro: ResultadoCola["conteosFiltro"];
  let desglose: FilaDesglose[] | undefined;
  if (offset === 0) {
    // Una sola pasada da las tres cifras: el total del recorte actual (con el
    // filtro secundario puesto) y cuántas daría cada chip dentro del MISMO
    // recorte. El `FILTER` es lo que evita una consulta por chip.
    const [r] = await base.execute<{
      n: number;
      pide_info: number;
      sin_responder: number;
      ya_compraron: number;
    }>(sql`
      ${conTodo(filtroCanal, pins)},
      ultimas_gestiones AS (${ultimasGestionesSql}),
      cats AS (${categoriasCteSql}),
      padron AS (${padronCteSql(conPadron)})
      SELECT count(*) FILTER (WHERE ${yTodas(condicionesBase)})::int AS n,
             count(*) FILTER (WHERE pide_info)::int                 AS pide_info,
             count(*) FILTER (WHERE NOT respondida)::int            AS sin_responder,
             count(*) FILTER (WHERE ${yaComproSql})::int            AS ya_compraron
      FROM todo
      LEFT JOIN ultimas_gestiones USING (clave)
      ${estadoJoinSql(vendedoraId, conEstado)}
      LEFT JOIN cats ON cats.clave = todo.clave
      ${padronJoinSql(conPadron)}
      ${donde(condicionesRecorte)}
    `);
    total = r?.n;
    conteosFiltro = {
      pideInfo: r?.pide_info ?? 0,
      sinResponder: r?.sin_responder ?? 0,
      yaCompraron: r?.ya_compraron ?? 0,
    };
    desglose = await desglosarEmbudo(base, filtroCanal, condicionesBase, conPadron);
    conteos = plegarConteos(desglose);
  }

  return {
    conversaciones: filas as unknown[],
    total,
    conteos,
    conteosFiltro,
    desglose,
    hayMas: filas.length === limit,
  };
}

/**
 * EL GROUP BY DEL EMBUDO: una pasada, la misma definición y la misma ventana.
 *
 * Devuelve el desglose completo (etapa × turno × precio). El `conteos` de toda la
 * vida se pliega de acá — no es otra consulta: si algún día no cerraran, sería un
 * bug de verdad y no una diferencia de definición (la lección de #37).
 */
async function desglosarEmbudo(
  base: typeof db,
  filtroCanal: SQL,
  condiciones: SQL[],
  conPadron: boolean,
): Promise<FilaDesglose[]> {
  const donde = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``;
  const filas = await base.execute<FilaDesglose>(sql`
    ${conTodo(filtroCanal, null)},
    ultimas_gestiones AS (${ultimasGestionesSql}),
    padron AS (${padronCteSql(conPadron)})
    SELECT (${etapaEfectivaSql})        AS etapa,
           ya_le_hablamos               AS "yaLeHablamos",
           precio_enviado               AS precio,
           (${vivaSql})                 AS viva,
           count(*)::int                AS n
    FROM todo
    LEFT JOIN ultimas_gestiones USING (clave)
    ${padronJoinSql(conPadron)}
    ${donde}
    GROUP BY 1, 2, 3, 4
  `);
  return filas.map((f) => ({
    etapa: f.etapa,
    yaLeHablamos: f.yaLeHablamos,
    precio: f.precio,
    viva: f.viva,
    n: f.n,
  }));
}

/** El conteo por etapa, plegado del desglose. El contrato de #89, intacto. */
export function plegarConteos(desglose: readonly FilaDesglose[]): Record<string, number> {
  const conteos: Record<string, number> = {};
  for (const fila of desglose) conteos[fila.etapa] = (conteos[fila.etapa] ?? 0) + fila.n;
  return conteos;
}

/**
 * EL EMBUDO DEL DASHBOARD (#89): conteos por etapa efectiva sobre la ventana de
 * 30 días de la cola. Reemplaza al conteo de toda la historia de `gestiones`
 * sin ventana — la dualidad que hacía incomparable el «N de M» del kanban.
 * Mismo seam que `/api/conversaciones`: si un día dicen cosas distintas, es un
 * bug de verdad, no una diferencia de definición.
 */
export async function contarPorEtapaEfectiva(base: typeof db): Promise<Record<string, number>> {
  // Sin condiciones no hay nada que preguntarle al padrón: el join saldría gratis
  // pero igual costaría una pasada. `false` deja la consulta idéntica a la de
  // antes de #133 — y de paso no depende de que `clientes_padron` exista.
  return plegarConteos(await desglosarEmbudo(base, sql``, [], false));
}
