import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { soloMisClavesSql } from "../dashboard/personal.js";
import {
  nivelUrgenciaSql,
  ordenUrgenciaSql,
  pideInfoAgrupadoSql,
  pideInfoSql,
  puedoEscribirleSql,
  referenciaSql,
  respondidaSql,
  seguimientosPendientesSql,
  ventanaAbiertaSql,
  ventanaCierraSql,
  ventanaDiasSql,
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
import { botCalienteSql, botEscaladaSql, botJoinSql } from "./botSql.js";
import { asignadaJoinSql, duenoSql, esMiaSql } from "./asignadaSql.js";
import { recorteDeLineas } from "./lineas.js";
import { estaEnAlgunaRueda } from "../reparto/asignar.js";
import { lineasDeVendedora } from "../numeros/repositorio.js";

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
 * EL VEREDICTO DEL BOT (`cola/botSql.ts`): `bot_escalada`, `bot_temperatura` y
 * `bot_motivo` — lo que el bot comercial dijo de esa conversación. Es el LECTOR
 * que `bot_calificaciones` no tenía: el bot marcaba «listo para cerrar», se
 * frenaba a propósito y del otro lado no había nadie. Va en el listado y no en
 * la ficha porque la pregunta que responde es «¿a quién atiendo AHORA?», y esa
 * se hace antes de abrir la conversación.
 *
 * EL DUEÑO (`cola/asignadaSql.ts`): `asignada_a` dice a quién le tocó esta
 * conversación en el reparto, y `?mios=1` recorta a las propias. Desde el
 * 4-ago-2026 siete personas comparten la línea `51984429504`; sin el dueño EN LA
 * FILA, el reparto no evita ni que dos contesten al mismo lead ni que nadie
 * conteste a otro, porque la fila se ve igual. Es un FILTRO, no un permiso —
 * mismo argumento que `cola/lineas.ts`.
 *
 * ⚠️ `?mios=1` (conversaciones asignadas) NO es `?mias=1` (líneas del mapa
 * `numero_vendedora`). Se escriben casi igual, viven en la misma ruta y
 * confundirlos no rompe nada visible: devuelve otra cola. Por eso adentro se
 * llaman `misAsignadas` y `misLineas`, que no se parecen.
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

/**
 * La ventana de 7 días de Meta para el privado. IG también la tiene, no solo FB.
 * El plazo ya no se escribe acá: sale de `ventanaDiasSql` (`urgenciaSql.ts`), que
 * es el mismo que usa el radar del Dashboard — antes eran dos literales sueltos y
 * ya habían divergido. El `tipo = 'comentario'` sí se queda: este CTE también
 * proyecta chats, y un chat no tiene ventana.
 */
const VENTANA_ABIERTA = sql`(tipo = 'comentario' AND ${ventanaAbiertaSql(ventanaDiasSql("occurred_at", "canal"))})`;

/**
 * CUÁNDO SE CIERRA LA PUERTA de esta conversación — la ventana de conversación
 * (`cola/ventana.ts`, donde está escrito el porqué). Se calcula sobre `todo`, o
 * sea DESPUÉS del `GROUP BY`, porque las tres columnas que necesita
 * (`ultimo_entrante_at`, `canal`, `tipo`) ya las emiten los dos CTE.
 *
 * Es distinta de `VENTANA_ABIERTA` de acá arriba y las dos tienen que existir:
 * aquella es la de 7 días de un COMENTARIO y alimenta el nivel 2 (`EXPIRA`) de
 * la urgencia; ésta cubre también los chats de WhatsApp, donde el plazo es de
 * 24 h y hasta hoy no se calculaba en ningún lado.
 */
const VENTANA_CIERRA = ventanaCierraSql("ultimo_entrante_at", "canal", "tipo");

/**
 * ¿SE LE PUEDE HABLAR AHORA? El predicado del chip, dicho UNA vez: lo leen la
 * página, el filtro y el conteo del chip. Si se escribiera dos veces, el chip
 * podría prometer 47 y la cola devolver otra cosa (#37).
 */
const PUEDO_ESCRIBIRLE = puedoEscribirleSql(VENTANA_CIERRA);

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

/**
 * El recorte por LÍNEA (#50): solo las conversaciones que entraron o salieron por
 * ESOS números propios de Goberna.
 *
 * Va sobre `interactions.numero_propio` —la COLUMNA materializada por #185, con
 * índice `(numero_propio, occurred_at)`— y no sobre `e.payload->>'numeroPropio'`,
 * que es de donde el resto de este CTE todavía lo saca. Es la misma decisión que
 * tomó `mismaLinea()` en el hilo: derivarlo con JSON en cada consulta es caro y
 * frágil, y acá además tiraría el índice justo en el filtro que existe para
 * podar filas temprano.
 *
 * **`NULL` no matchea ninguna línea, y está bien**: una fila cuyo crudo no traía
 * el número no se le puede adjudicar a nadie. Es lo que ya decidió el backfill al
 * no rellenarla con la línea más probable.
 *
 * Recibe una LISTA y no un número porque «las mías» (`numero_vendedora`) puede
 * ser más de una: es el MISMO recorte con otro nombre, y quién arma la lista lo
 * decide `cola/lineas.ts`, puro y con tests. Lista vacía = sin recorte, que es
 * el comportamiento de cuando había una sola línea.
 */
const filtroDeLineas = (lineas: readonly string[]) =>
  lineas.length
    ? sql`AND i.numero_propio IN (${sql.join(lineas.map((l) => sql`${l}`), sql`, `)})`
    : sql``;

/** Cada mensaje con su número propio y la CLASE de su media, sacados del evento. */
const msgCte = (filtroCanal: SQL, incluirPins: boolean, lineas: readonly string[]) => sql`
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
    ${filtroDeLineas(lineas)}
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
 *
 * `lineas` (#50): con un recorte de línea puesto, **los comentarios se caen del
 * UNION**. No es un descarte por comodidad — un comentario de Facebook no llegó
 * por ningún número de WhatsApp (`comentariosCte` los emite con `numero_propio`
 * NULL), así que dejarlos adentro haría que «solo la línea de Walter» mostrara
 * filas que no son de Walter ni de ninguna línea. Y una fijada de otra línea
 * tampoco entra: el recorte por línea se aplica en `msg`, o sea ANTES de que el
 * `OR` de pins pueda saltarse la ventana.
 */
const conTodo = (filtroCanal: SQL, pins: SQL | null, lineas: readonly string[] = []) => sql`
  WITH ${pins ? sql`pins AS (${pins}),
  ` : sql``}msg AS (
    ${msgCte(filtroCanal, pins != null, lineas)}
  ),
  todo AS (
    ${lineas.length ? sql`` : sql`${comentariosCte(filtroCanal, pins != null)}
    UNION ALL
    `}${conversacionesCte}
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
  /**
   * Solo lo que entró/salió por ESTE número propio de Goberna (#50). Vacío = todas
   * las líneas, que es lo que pasaba cuando había una sola.
   *
   * Es un recorte de VISTA, no de permiso: acota lo que se mira, no lo que se
   * puede mirar. Vale lo mismo para `misLineas` — el porqué está en
   * `cola/lineas.ts` y en el comentario de `numeroVendedora` (`db/schema.ts`).
   */
  linea?: string;
  /**
   * «Las mías»: acota a las líneas que `numero_vendedora` le asigna a
   * `vendedoraId`. **Fail-open**: sin filas asignadas se sirve TODO y se avisa
   * con `sinLineasPropias`. Una línea explícita en `linea` le gana.
   */
  misLineas?: boolean;
  /**
   * «Míos»: solo las conversaciones que el REPARTO le asignó a `vendedoraId`
   * (`conversacion_asignada`, `cola/asignadaSql.ts`).
   *
   * ⚠️ **No confundir con `misLineas`.** Aquél acota por LÍNEA (`numero_vendedora`,
   * el mapa que empuja Cerberus); éste, por CONVERSACIÓN. Una vendedora puede
   * atender una línea entera sin tener una sola conversación asignada, y al revés.
   *
   * Y a diferencia de `misLineas`, esto **no es fail-open**: cero asignadas es
   * una respuesta honesta y verdadera («todavía no te tocó ninguna»), no un mapa
   * incompleto. Lo que evita la cola vacía sin explicación es otra cosa: el chip
   * lleva su número, así que no se entra a ciegas (`BarraFiltros`).
   */
  misAsignadas?: boolean;
  /**
   * QUIEN ESTÁ EN UNA RUEDA DEL REPARTO VE **SOLO LO SUYO**, sin pedirlo.
   *
   * Es la diferencia entre un filtro y una cola. Con cinco personas compartiendo
   * una línea, un chip que hay que acordarse de encender no evita nada: la
   * primera mañana que alguien se olvide, vuelve a leer los chats de las otras
   * cuatro. Así que el recorte lo decide el SERVER a partir de un hecho —¿está
   * en la rueda?— y no de una preferencia guardada que puede quedar vieja.
   *
   * Lo resuelve `consultarCola` con `estaEnAlgunaRueda`, igual que resuelve
   * `misLineas` contra `numero_vendedora`: la ruta no lo manda.
   *
   * ⚠️ **Sigue sin ser un permiso** (ver `cola/asignadaSql.ts`). Y quien NO está
   * en ninguna rueda ve todo — Luz, que quedó afuera a propósito, y quien
   * supervisa: ése es el fail-open que hace que una conversación sin asignar o
   * mal asignada le aparezca a alguien en vez de desaparecer.
   */
  enElReparto?: boolean;
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
  conteosFiltro?: {
    pideInfo: number;
    sinResponder: number;
    yaCompraron: number;
    /** El bot se frenó y espera a una persona (`cola/botSql.ts`). */
    botEscalada: number;
    /** El bot la ve caliente: preguntó precio, cuotas o forma de pago. */
    botCaliente: number;
    /**
     * Cuántas tienen la ventana de conversación ABIERTA (`cola/ventana.ts`): se
     * les puede escribir ahora mismo. El chip lleva su número porque sin él
     * «Puedo escribirle» es una apuesta — y con la cola de 1.900 filas, tocarlo
     * y encontrar 3 se lee como que el filtro está roto.
     */
    puedoEscribirle: number;
    /**
     * Cuántas de estas te asignó el reparto. Se cuenta SIEMPRE dentro del recorte
     * **sin** aplicar «Míos» — si se contara con el filtro puesto, el chip diría
     * su propio total y dejaría de responder «¿cuánto me tocó?» cuando está apagado,
     * que es justo cuando se lo mira.
     */
    mios: number;
  };
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
  /** true = la cola vino SIN el veredicto del bot (`bot_calificaciones` no existe acá). */
  sinBot?: boolean;
  /**
   * true = la cola vino SIN el dueño de cada conversación: falta la migración del
   * reparto (`conversacion_asignada`). Se dice para que la pantalla no ofrezca un
   * filtro «Míos» que devolvería cero por una razón que no es «no te tocó nada».
   */
  sinAsignacion?: boolean;
  /**
   * true = quien pregunta está en una rueda del reparto, así que **esta cola ya
   * es solo lo suyo**. El front lo usa para no dibujar lo que sobra: un chip
   * «Míos» que no filtra nada y una píldora «Vos» repetida en cada fila.
   */
  enElReparto?: boolean;
  /**
   * true = se pidió «las mías» y `numero_vendedora` no le asigna ninguna, así que
   * se sirvió TODO. Se dice en voz alta: un filtro que no filtra y no avisa se ve
   * igual que uno que sí, y la vendedora creería que esas conversaciones son suyas.
   */
  sinLineasPropias?: boolean;
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
  let conBot = true;
  let conAsignacion = true;

  // A QUÉ LÍNEAS SE ACOTA — se resuelve UNA vez, ANTES del loop: el recorte no
  // depende de qué tabla degradó, así que releer `numero_vendedora` en cada
  // reintento sería una consulta por nada.
  const { lineas, sinLineasPropias } = recorteDeLineas({
    linea: opciones.linea,
    misLineas: opciones.misLineas,
    // Solo se le pregunta al mapa si hace falta: sin `mias` puesto, esta consulta
    // no existe y la cola de siempre no paga nada.
    asignadas:
      opciones.misLineas && opciones.vendedoraId
        ? await lineasDeVendedora(base, opciones.vendedoraId)
        : [],
  });

  // ¿PARTICIPA DEL REPARTO? Se pregunta UNA vez, antes del loop, por lo mismo
  // que el mapa de líneas: no depende de qué tabla degradó. Y se resuelve acá y
  // no en la ruta para que el recorte sea un HECHO del server —«está en la
  // rueda»— y no una bandera que el cliente pueda dejar de mandar.
  const enElReparto =
    opciones.misAsignadas === true || (await estaEnAlgunaRueda(base, opciones.vendedoraId));

  // Cuatro degradaciones posibles ⇒ como mucho cinco intentos.
  for (let intento = 0; ; intento++) {
    try {
      const r = await ejecutarCola(
        base,
        { ...opciones, enElReparto },
        lineas,
        conEstado,
        conPadron,
        conBot,
        conAsignacion,
      );
      return {
        ...r,
        ...(conEstado ? {} : { sinEstado: true }),
        ...(conPadron ? {} : { sinPadron: true }),
        ...(conBot ? {} : { sinBot: true }),
        ...(conAsignacion ? {} : { sinAsignacion: true }),
        ...(enElReparto ? { enElReparto: true } : {}),
        ...(sinLineasPropias ? { sinLineasPropias: true } : {}),
      };
    } catch (e) {
      if (!esTablaAusente(e) || intento >= 4) throw e;
      // El reparto va primero por la misma razón que el bot y el padrón: apagar
      // lo que el error NOMBRA evita que una tabla ausente se lleve puestas las
      // otras tres.
      if (conAsignacion && mencionaTabla(e, "conversacion_asignada")) {
        console.warn(
          "[cola] `conversacion_asignada` no existe: sirvo la cola SIN el dueño de cada " +
            "conversación. Falta la migración del reparto (`0015_minor_reavers`).",
        );
        conAsignacion = false;
        continue;
      }
      if (conBot && mencionaTabla(e, "bot_calificaciones")) {
        console.warn(
          "[cola] `bot_calificaciones` no existe: sirvo la cola SIN el veredicto del bot. " +
            "Falta la migración `0009_cimientos_del_bot`.",
        );
        conBot = false;
        continue;
      }
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
      if (conPadron) {
        conPadron = false;
        continue;
      }
      if (conBot) {
        conBot = false;
        continue;
      }
      conAsignacion = false;
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
  lineas: readonly string[],
  conEstado: boolean,
  conPadron: boolean,
  conBot: boolean,
  conAsignacion: boolean,
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
  /**
   * ⚠️ «PIDEN INFO» ES `pide_info` **Y SIN RESPONDER**, y esa segunda mitad es
   * la que lo vuelve un chip usable.
   *
   * ── El número que lo obligó ──
   * Medido en producción el 5-ago-2026: `pide_info` a secas daba **675**
   * conversaciones, de las cuales **647 (96 %) YA habían sido respondidas**. Un
   * chip que ofrece 675 en una cola de 2.565 no ayuda a elegir a quién atender:
   * es la quinta parte de la mesa, y de cada 25 filas 24 son trabajo hecho.
   * Con la segunda condición son **28** — y esas 28 sí son una lista de tareas.
   *
   * ── Por qué se angosta el FILTRO y no el PREDICADO ──
   * `pideInfoAgrupadoSql` responde «¿lo último que dijo fue pedir info?», y eso
   * es un hecho verdadero sobre la conversación que la FILA muestra y que el
   * radar del Dashboard comparte. Cambiarlo ahí haría que una fila ya atendida
   * dejara de decir qué pidió esa persona — se perdería información correcta
   * para arreglar un problema que es de otro nivel.
   *
   * El chip no pregunta «¿qué dijo?», pregunta «¿a quién atiendo?». Son dos
   * preguntas distintas sobre el mismo hecho, y sólo la segunda necesita saber
   * si alguien ya contestó.
   *
   * ── Consecuencia buscada: queda DENTRO de «Sin responder» ──
   * Ahora «Piden info» es un subconjunto estricto de «Sin responder»: de las
   * 454 que esperan, éstas 28 pidieron algo concreto. Es exactamente lo que
   * significa «angostan dentro del tab», y es la prioridad dentro de la deuda.
   *
   * `respondida` sale de `urgenciaSql.ts` — no se define ningún criterio propio.
   */
  if (intencion === "pide-info") condicionesBase.push(sql`pide_info AND NOT respondida`);
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
  // EL BOT PIDIÓ AYUDA / EL BOT LA VE CALIENTE (`cola/botSql.ts`). Son filtros
  // secundarios como los otros tres —no un modo aparte— justamente para que se
  // combinen: «piden info» + «el bot pidió ayuda» es una pregunta legítima.
  // El predicado se dice UNA vez y lo leen la página, el conteo del chip y el
  // desglose (lección de #37).
  if (intencion === "bot-escalada") condicionesBase.push(botEscaladaSql);
  if (intencion === "bot-caliente") condicionesBase.push(botCalienteSql);
  /**
   * «PUEDO ESCRIBIRLE» — la ventana de conversación abierta (`cola/ventana.ts`).
   *
   * ⚠️ Acá decía `(ventana_abierta OR tipo = 'mensaje')`, y eso **es siempre
   * verdadero en WhatsApp**: `tipo = 'mensaje'` no mira ningún plazo, así que el
   * filtro devolvía los 1.900 chats enteros. Era compat de la cola vieja, donde
   * este valor había sido el tab por defecto — y por eso se lo retiró en #49 sin
   * que nadie notara que además mentía.
   *
   * Ahora usa la ventana de verdad: 24 h desde el último ENTRANTE en un chat, 7
   * días en un comentario de FB/IG. El predicado se dice una sola vez arriba
   * (`PUEDO_ESCRIBIRLE`) y lo comparten la página y el conteo del chip.
   */
  if (intencion === "puedo-escribirle") condicionesBase.push(PUEDO_ESCRIBIRLE);

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

  /**
   * «MÍOS» VA APARTE DE LOS OTROS RECORTES, y no por prolijidad.
   *
   * Es el UNIVERSO de la foto, como la línea: con «Míos» puesto, «Piden info ·
   * 12» tiene que decir 12 DE LAS MÍAS. Por eso entra a la página, al total y al
   * desglose. Pero su PROPIO chip se cuenta sin él —«¿cuánto me tocó?» se
   * pregunta cuando el filtro está apagado—, y eso no se puede expresar metiendo
   * el predicado en la lista que arma el `WHERE` de la consulta de conteos.
   *
   * Sin la tabla migrada no hay recorte posible: se sirve la cola entera y la
   * respuesta lo dice con `sinAsignacion`. Recortar por una columna que no existe
   * daría cero filas y se leería como «no te asignaron nada».
   */
  const esMia = conAsignacion ? esMiaSql(vendedoraId) : null;
  const soloMias = conAsignacion && (opciones.misAsignadas || opciones.enElReparto) && esMia ? [esMia] : [];

  const condiciones = [...condicionesBase, ...condicionesRecorte, ...soloMias];

  const donde = (c: SQL[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);
  const yTodas = (c: SQL[]) => (c.length ? sql.join(c, sql` AND `) : sql`true`);

  // El orden es la urgencia canónica (cola/urgenciaSql.ts) con la BANDA DE PIN
  // encima (#49): las fijadas arriba de todo, dentro de la banda sigue mandando
  // el nivel 0–5. `etapa_manual` llega de la última gestión (etapaEfectivaSql.ts);
  // el estado personal, del LEFT JOIN a `estado_conversacion`.
  const filas = await base.execute(sql`
    ${conTodo(filtroCanal, pins, lineas)},
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
           -- CUÁNDO SE CIERRA LA PUERTA (cola/ventana.ts). Viaja el INSTANTE del
           -- cierre, no «6 h»: el texto de la cuenta regresiva es presentación y
           -- envejece en el caché de IndexedDB (ADR 0007) — un «quedan 6 h»
           -- serializado ayer hoy es mentira, un timestamp no.
           (${VENTANA_CIERRA}) AS ventana_cierra,
           etapa_manual,
           iu.curso AS interes_curso,
           lc.curso AS lead_curso,
           lc.nombre AS lead_nombre,
           pc.nivel AS cliente_nivel,
           pc.compras AS cliente_compras,
           -- EL VEREDICTO DEL BOT (cola/botSql.ts). bot_motivo viaja CRUDO:
           -- traducir «por_cerrar» a criollo es presentación, y eso vive del
           -- lado del front (canales/bot.ts), igual que la marca de ex-cliente.
           (${botEscaladaSql}) AS bot_escalada,
           bq.temperatura       AS bot_temperatura,
           bq.motivo            AS bot_motivo,
           -- DE QUIÉN ES (cola/asignadaSql.ts). Viaja el vendedora_id CRUDO: el
           -- nombre corto y el «Vos» son presentación, y eso vive del lado del
           -- front (canales/dueno.ts), igual que la marca de ex-cliente y el bot.
           (${duenoSql})        AS asignada_a,
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
    ${botJoinSql(conBot)}
    ${asignadaJoinSql(conAsignacion)}
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
    // Cada chip cuenta DENTRO de «Míos» cuando está puesto: si no, con el recorte
    // activo la barra diría «Piden info · 311» sobre una cola de 14 filas.
    const conMias = (pred: SQL): SQL =>
      soloMias.length ? sql`(${pred}) AND (${soloMias[0]!})` : pred;
    const [r] = await base.execute<{
      n: number;
      pide_info: number;
      sin_responder: number;
      ya_compraron: number;
      bot_escalada: number;
      bot_caliente: number;
      puedo_escribirle: number;
      mios: number;
    }>(sql`
      ${conTodo(filtroCanal, pins, lineas)},
      ultimas_gestiones AS (${ultimasGestionesSql}),
      cats AS (${categoriasCteSql}),
      padron AS (${padronCteSql(conPadron)})
      SELECT count(*) FILTER (WHERE ${yTodas([...condicionesBase, ...soloMias])})::int AS n,
             count(*) FILTER (WHERE ${conMias(sql`pide_info AND NOT respondida`)})::int AS pide_info,
             count(*) FILTER (WHERE ${conMias(sql`NOT respondida`)})::int   AS sin_responder,
             count(*) FILTER (WHERE ${conMias(yaComproSql)})::int           AS ya_compraron,
             count(*) FILTER (WHERE ${conMias(botEscaladaSql)})::int        AS bot_escalada,
             count(*) FILTER (WHERE ${conMias(botCalienteSql)})::int        AS bot_caliente,
             -- El MISMO predicado que filtra la página: el chip no puede
             -- prometer un número y la cola devolver otro.
             count(*) FILTER (WHERE ${conMias(PUEDO_ESCRIBIRLE)})::int      AS puedo_escribirle,
             -- El de «Míos» es el único que NO se cuenta con el filtro puesto:
             -- responde «¿cuánto me tocó?», y esa pregunta se hace justo cuando
             -- el filtro está apagado. Con él puesto, coincide con el total.
             count(*) FILTER (WHERE ${esMia ?? sql`false`})::int            AS mios
      FROM todo
      LEFT JOIN ultimas_gestiones USING (clave)
      ${estadoJoinSql(vendedoraId, conEstado)}
      LEFT JOIN cats ON cats.clave = todo.clave
      ${padronJoinSql(conPadron)}
      ${botJoinSql(conBot)}
      ${asignadaJoinSql(conAsignacion)}
      ${donde(condicionesRecorte)}
    `);
    total = r?.n;
    conteosFiltro = {
      pideInfo: r?.pide_info ?? 0,
      sinResponder: r?.sin_responder ?? 0,
      yaCompraron: r?.ya_compraron ?? 0,
      botEscalada: r?.bot_escalada ?? 0,
      botCaliente: r?.bot_caliente ?? 0,
      puedoEscribirle: r?.puedo_escribirle ?? 0,
      mios: r?.mios ?? 0,
    };
    desglose = await desglosarEmbudo(
      base,
      filtroCanal,
      // «Míos» entra al desglose como entra la línea: define el universo de la
      // foto. Sin esto, con la cola en «Míos» la banda seguiría contando las
      // conversaciones de los otros cinco.
      [...condicionesBase, ...soloMias],
      conPadron,
      conBot,
      conAsignacion,
      lineas,
    );
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
  // El join al veredicto del bot va acá aunque el desglose no lo muestre: si la
  // vendedora está filtrando por «el bot pidió ayuda», `condiciones` nombra `bq`
  // y sin el join la consulta ni compila. Es la misma razón por la que ya estaba
  // el del padrón.
  conBot: boolean,
  // Y el del reparto por lo mismo: si `condiciones` trae el predicado de «Míos»,
  // nombra `ca` y sin el join la consulta ni compila.
  conAsignacion: boolean,
  // Las líneas entran acá por lo mismo que entra el canal: definen el UNIVERSO de
  // la foto, no un recorte de columna. Sin esto, con la cola filtrada a Walter la
  // banda de desglose seguiría contando las conversaciones de la otra línea.
  lineas: readonly string[],
): Promise<FilaDesglose[]> {
  const donde = condiciones.length ? sql`WHERE ${sql.join(condiciones, sql` AND `)}` : sql``;
  const filas = await base.execute<FilaDesglose>(sql`
    ${conTodo(filtroCanal, null, lineas)},
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
    ${botJoinSql(conBot)}
    ${asignadaJoinSql(conAsignacion)}
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
export async function contarPorEtapaEfectiva(
  base: typeof db,
  /** El recorte del Dashboard personal. `null` = el embudo entero, como siempre. */
  soloAsignadasA: string | null = null,
): Promise<Record<string, number>> {
  // Sin condiciones no hay nada que preguntarle al padrón, al bot ni al reparto:
  // el join saldría gratis pero igual costaría una pasada. Los `false` dejan la
  // consulta idéntica a la de antes de #133 — y de paso no dependen de que
  // `clientes_padron`, `bot_calificaciones` ni `conversacion_asignada` existan en
  // esa base.
  //
  // Con recorte se usa la MISMA subconsulta que el radar (`soloMisClavesSql`) y
  // no el `esMiaSql` del join: acá no hace falta el dueño de cada fila, solo si
  // la fila es mía — y con la subconsulta el `conAsignacion` del desglose sigue
  // en `false`, o sea que una base sin la tabla del reparto se comporta igual que
  // antes mientras nadie pida un recorte.
  const condiciones =
    soloAsignadasA === null ? [] : [soloMisClavesSql(sql`todo.clave`, soloAsignadasA)];
  return plegarConteos(await desglosarEmbudo(base, sql``, condiciones, false, false, false, []));
}
