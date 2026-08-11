import { sql, type SQL } from "drizzle-orm";
import type { db } from "../db/client.js";
import { soloMisClavesSql } from "../dashboard/personal.js";
import {
  nivelUrgenciaSql,
  ordenUrgenciaSql,
  puedoEscribirleSql,
  referenciaSql,
  respondidaSql,
  seguimientosPendientesSql,
  ventanaAbiertaSql,
  ventanaCierraSql,
  ventanaDiasSql,
  vivaSql,
} from "./urgenciaSql.js";
import { etapaEfectivaSql, ultimasGestionesSql, ventaPosteriorCteSql } from "./etapaEfectivaSql.js";
import { precioEnviadoSql, primerPrecioAtSql } from "./precio.js";
import {
  DIAS_DEUDA_VIVA,
  preguntoAgrupadoSql,
  preguntoPrecioAgrupadoSql,
  preguntoPrecioSql,
  preguntoSql,
  soloClicAgrupadoSql,
} from "./pregunta.js";
import { leadsCte, sufijosConConversacionCte } from "./leadsCte.js";
import {
  etapaDesdeSql,
  paraSeguirSql,
  respuestaAtSql,
  seCalloConElPrecioSql,
} from "./tiempoEnEtapa.js";
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
import { recorteDeLineas, soloSusLineas } from "./lineas.js";
import { estaEnAlgunaRueda } from "../reparto/asignar.js";
import { lineasDeVendedoraConProposito } from "../numeros/repositorio.js";

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
 * ningún criterio propio (`respondida`, `referencia` y `pregunto` también salen
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
 * EL JOIN DE LA VENTA — y la POSTERIORIDAD va en el `ON`, no en un `WHERE`
 * suelto (`etapaEfectivaSql.ts`). Puesta acá, es imposible que un consumidor se
 * la olvide: `v.venta_at` o es una venta posterior a esta conversación, o es
 * NULL. Sin ese `>=`, «Cierre» se llenaría con los 947 clientes que compraron
 * ANTES de que les escribiéramos — que es la lección más cara del análisis de
 * canales.
 */
const VENTA_JOIN = sql`LEFT JOIN ventas v ON v.clave = todo.clave AND v.venta_at >= todo.primer_at`;

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
    -- Los hechos del TIEMPO EN ETAPA (cola/tiempoEnEtapa.ts). Un comentario no
    -- tiene mensajes salientes que fechar: nunca cotiza, y su respuesta (que
    -- status <> 'nuevo' sí conoce) no guarda CUÁNDO ocurrió. Van en NULL, que
    -- ahí significa «no se pudo determinar» — y la pantalla no dibuja nada, en
    -- vez de inventar una antigüedad. primer_at sí existe: es el comentario.
    NULL::timestamptz                           AS primer_precio_at,
    NULL::timestamptz                           AS primer_saliente_at,
    NULL::timestamptz                           AS respuesta_at,
    occurred_at                                 AS primer_at,
    occurred_at                                 AS referencia,
    occurred_at                                 AS ultimo_at,
    occurred_at                                 AS ultimo_entrante_at,
    (status <> 'nuevo')                         AS respondida,
    (status <> 'nuevo')                         AS ya_le_hablamos,
    -- Un comentario ES la persona hablando: por definición hubo un entrante, así
    -- que un comentario nunca cae en «sin respuesta» (cola/etapaEfectivaSql.ts).
    true                                        AS hablo,
    (${VENTANA_ABIERTA})                        AS ventana_abierta,
    (${preguntoSql("texto")})                   AS pregunto,
    (${preguntoPrecioSql("texto")})             AS pregunto_precio,
    -- Un comentario de FB/IG nunca es el texto de un anuncio de WhatsApp.
    false                                       AS solo_clic,
    -- ¿Habría entrado SIN la banda de pin? Es lo que separa el universo de la
    -- cola (que sube las fijadas viejas) del universo del embudo, que no.
    (${ventanaCola(sql`occurred_at`)})          AS en_ventana,
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
    -- LOS HECHOS DEL TIEMPO EN ETAPA (cola/tiempoEnEtapa.ts): el «cuándo» de
    -- cada peldaño, en el MISMO GROUP BY que ya calcula el «si». La etapa se
    -- deriva de estos hechos, así que la fecha de ingreso no puede salir de otra
    -- pasada sin arriesgar que fechen conversaciones distintas.
    (${primerPrecioAtSql})                                          AS primer_precio_at,
    min(occurred_at) FILTER (WHERE direccion = 'saliente')           AS primer_saliente_at,
    ${respuestaAtSql}                                               AS respuesta_at,
    min(occurred_at)                                                AS primer_at,
    (${referenciaSql})                                              AS referencia,
    max(occurred_at)                                                AS ultimo_at,
    max(occurred_at) FILTER (WHERE direccion = 'entrante')          AS ultimo_entrante_at,
    (${respondidaSql})                                              AS respondida,
    -- ¿Alguna vez le hablamos? Distinto de respondida, que es de quién es el
    -- turno HOY: una persona a la que ya atendimos y que volvió a escribir
    -- vuelve a ser deuda, pero no es una desconocida. La bandeja necesita
    -- separarlas — hoy les dice a las dos «nadie te respondió».
    COALESCE(bool_or(direccion = 'saliente'), false)                 AS ya_le_hablamos,
    -- ¿LA PERSONA HABLÓ ALGUNA VEZ? El hecho que separa una conversación de una
    -- difusión. Sin él, una conversación de puro outbound da respondida = true
    -- (el último saliente le gana a un '-infinity') y subía a contactado/cotizado
    -- sin que del otro lado hubiera nadie: 2.252 de los 3.050 Cotizados medidos
    -- el 8-ago-2026 nunca dijeron una palabra. Ver cola/etapaEfectivaSql.ts.
    COALESCE(bool_or(direccion = 'entrante'), false)                 AS hablo,
    false                                                          AS ventana_abierta,
    -- ¿PIDIÓ ALGO? — del ÚLTIMO entrante con texto, no un bool_or histórico
    -- (#49): mismo fragmento que el radar, una sola semántica (ADR 0014).
    -- Los tres niveles y por qué son tres viven en cola/pregunta.ts.
    (${preguntoAgrupadoSql})                                        AS pregunto,
    (${preguntoPrecioAgrupadoSql})                                  AS pregunto_precio,
    (${soloClicAgrupadoSql})                                        AS solo_clic,
    -- ¿Habría entrado SIN la banda de pin? Una conversación fijada trae TODOS
    -- sus mensajes (el OR de pins no mira la fecha), así que esto responde
    -- exactamente «¿tiene algún mensaje adentro de la ventana?».
    -- (Sin backticks: esto vive dentro de un template literal.)
    bool_or(${ventanaCola(sql`occurred_at`)})                       AS en_ventana,
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
const conTodo = (
  filtroCanal: SQL,
  pins: SQL | null,
  lineas: readonly string[] = [],
  canal?: string,
) => {
  /**
   * ⚠️ LOS LEADS DE FORMULARIO SE CAEN POR LO MISMO QUE LOS COMENTARIOS, Y ADEMÁS
   * POR CANAL. Con recorte de línea no entran porque nunca llegaron por un número
   * nuestro (`numero_propio` NULL). Y con un canal pedido que no sea `landing`
   * tampoco: su brazo del UNION lee `leads`, que **no tiene columna `canal`**, así
   * que el `filtroCanal` de los otros dos (`AND canal = …`) ni siquiera compila
   * contra esa tabla. Se decide acá, con el canal crudo, en vez de meterle un
   * predicado que no puede evaluar.
   */
  const conLeads = !lineas.length && (!canal || canal === "landing");
  return sql`
  WITH ${pins ? sql`pins AS (${pins}),
  ` : sql``}${conLeads ? sql`sufijos_con_conversacion AS (${sufijosConConversacionCte}),
  ` : sql``}msg AS (
    ${msgCte(filtroCanal, pins != null, lineas)}
  ),
  todo AS (
    ${lineas.length ? sql`` : sql`${comentariosCte(filtroCanal, pins != null)}
    UNION ALL
    `}${conversacionesCte}${conLeads ? sql`
    UNION ALL
    ${leadsCte(ventanaCola)}` : sql``}
  )
`;
};

export interface OpcionesCola {
  canal?: string;
  intencion?: string;
  /** Filtra por ETAPA EFECTIVA (#89, ADR 0013): la del seam, no la asentada a mano. */
  etapa?: string;
  /** Solo las que YA tienen precio enviado (cola/precio.ts). El recorte del negocio. */
  precio?: boolean;
  /** Solo las que tienen la ventana de conversación abierta (`cola/ventana.ts`). */
  ventana?: boolean;
  /**
   * «Para seguir» (`cola/tiempoEnEtapa.ts`): silencio nuestro + 3 a 14 días en la
   * etapa. Es un RECORTE de columna, como `precio` y `ventana` — define el
   * universo del que la columna informa el total, no un filtro secundario.
   */
  seguir?: boolean;
  /**
   * «Se calló con el precio» (`cola/tiempoEnEtapa.ts`): había hablado y no volvió
   * a escribir después de recibirlo. El recorte que separa la cotización viva
   * (258) de la que se frenó en el número (540).
   */
  seCallo?: boolean;
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
    /** Nombró plata: precio, cuotas, yape, inscripción (`cola/pregunta.ts`). */
    preguntoPrecio: number;
    /** Escribió, nadie contestó, y todavía es de esta semana. */
    teEscribieron: number;
    /**
     * La deuda ENTERA, sin corte de antigüedad. Ya no tiene chip —eran 505 con
     * el 93 % de más de una semana— pero se sigue contando: es el número que
     * dice si la deuda vieja crece, y el día que alguien decida qué hacer con
     * ella va a querer verlo.
     */
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
  /**
   * La ventana de conversación sigue abierta (`cola/ventana.ts`): se le puede
   * escribir texto libre AHORA. Distinto de `viva`, y la diferencia es la que
   * importa: `viva` es «nos está esperando» (entrante sin responder de menos de
   * 24 h) y esto es «la puerta está abierta» — una conversación ya respondida no
   * es viva y sigue teniendo la ventana corriendo, que es justo el caso que el
   * Pipeline no podía ver.
   */
  ventana: boolean;
  /**
   * «Para seguir» (`cola/tiempoEnEtapa.ts`): silencio nuestro + entre 3 y 14 días
   * en la etapa. Es el recorte que hace navegable una columna de 3.051 tarjetas —
   * medido, es el único de los tres ejes que recorta de verdad («sin respuesta»
   * es el 96 % de Cotizados y «en ventana» daba 1).
   */
  paraSeguir: boolean;
  /**
   * «Se calló con el precio» (`cola/tiempoEnEtapa.ts`): había hablado y su último
   * mensaje es anterior al precio. Medido: **540 de los 798 Cotizados**. Es la
   * objeción #1 del negocio, y nadie la declaró nunca.
   */
  seCallo: boolean;
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
  // Las líneas de quien mira, CON su propósito. Antes esta lectura solo ocurría
  // con `?mias=1`; ahora hace falta siempre que haya vendedora, porque el
  // recorte exclusivo (campaña) no depende de que el cliente pida nada — si
  // dependiera, se apagaría dejando de mandar el parámetro.
  const misAsignadasConProposito = opciones.vendedoraId
    ? await lineasDeVendedoraConProposito(base, opciones.vendedoraId).catch((e) => {
        // Degrada al comportamiento de siempre: sin poder leer el mapa se sirve
        // todo, como con `?mias=1` sin filas. Nunca una cola vacía sin explicar.
        console.warn("[cola] no se pudo leer las líneas de la vendedora: se sirve todo", e);
        return [] as { numero: string; proposito: string }[];
      })
    : [];

  const { lineas, sinLineasPropias } = recorteDeLineas({
    linea: opciones.linea,
    misLineas: opciones.misLineas,
    exclusivas: soloSusLineas(misAsignadasConProposito),
    asignadas: misAsignadasConProposito.map((l) => l.numero),
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
      /**
       * 🔴 UNA TRANSACCIÓN POR INTENTO, Y NO ES POR ATOMICIDAD: es lo único que
       * garantiza que las consultas de este pedido caigan en la MISMA conexión,
       * que es lo que hace posible la tabla temporal de `ejecutarCola`. Con el
       * pool, dos `execute` seguidos pueden ir a backends distintos y la segunda
       * no vería la tabla.
       *
       * ⚠️ **Va ADENTRO del `try` del loop de degradación, y ese orden importa.**
       * Un error de tabla ausente aborta la transacción entera; si la
       * transacción envolviera al loop, el primer fallo dejaría todos los
       * reintentos contestando «current transaction is aborted» y la cola no
       * degradaría: se caería. Así, cada intento estrena transacción limpia.
       */
      const r = await base.transaction((tx) =>
        ejecutarCola(
          tx,
          { ...opciones, enElReparto },
          lineas,
          conEstado,
          conPadron,
          conBot,
          conAsignacion,
        ),
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

/**
 * Lo único que este módulo le pide a la base: poder ejecutar SQL. Así la misma
 * función sirve al singleton, a una transacción y al `db` de un test con base,
 * sin arrastrar los genéricos de drizzle por siete firmas.
 */
type Ejecutor = Pick<typeof db, "execute">;

async function ejecutarCola(
  base: Ejecutor,
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
   * ══ «PREGUNTARON PRECIO» — Y POR QUÉ ESTE CHIP **NO** MIRA SI YA SE CONTESTÓ ══
   *
   * El chip anterior («Piden info») era `pide_info AND NOT respondida`, y esa
   * segunda mitad era un parche sobre un predicado que mentía: `pide_info` a
   * secas daba 675 con el 96 % ya respondido, así que hubo que angostarlo por
   * otro lado. Con el predicado arreglado (`cola/pregunta.ts`) el problema
   * desaparece solo: **65 conversaciones en 30 días** nombran plata. Eso ya cabe
   * en un turno de trabajo sin ayuda de nadie.
   *
   * Y no debe mirar `respondida`, porque acá «ya le contesté» **no significa
   * terminado**: alguien que preguntó el precio hace tres días, recibió respuesta
   * y se calló es el seguimiento más rentable que hay en la mesa (ADR 0044 midió
   * 540 conversaciones que se callaron justo con el precio). Filtrar por
   * `NOT respondida` escondería exactamente esas.
   *
   * Quién espera respuesta ya lo contesta el chip de al lado, y el orden de la
   * cola sigue poniendo la deuda arriba: no hace falta decirlo dos veces.
   */
  if (intencion === "pregunto-precio") condicionesBase.push(sql`pregunto_precio`);
  /**
   * ══ «TE ESCRIBIERON» — LA DEUDA QUE TODAVÍA SE PUEDE PAGAR ══
   *
   * `NOT respondida` a secas daba **505** conversaciones en producción
   * (11-ago-2026), de las cuales **472 (93 %) tenían más de 7 días** y solo
   * **5** seguían dentro de la ventana de 24 h de Meta. Una lista así no se
   * trabaja: se aprende a ignorarla, y con ella se ignora lo de hoy. Con el
   * corte de `DIAS_DEUDA_VIVA` son **33**.
   *
   * ⚠️ Lo viejo NO se esconde de la cola: la fila sigue ahí y el orden la sigue
   * poniendo donde corresponde. Lo que se retira es la PROMESA de que esas 505
   * eran el trabajo del día.
   */
  if (intencion === "te-escribieron") {
    condicionesBase.push(
      sql`NOT respondida AND ultimo_entrante_at > now() - (${DIAS_DEUDA_VIVA} || ' days')::interval`,
    );
  }
  /**
   * COMPAT — los dos valores viejos se siguen aceptando aunque el panel ya no
   * tenga sus chips, igual que `por-vencer` (ver `src/features/canales/cola.ts`):
   * el contrato de la API no se rompe por un cambio de UI, y una app vieja o un
   * link guardado tienen que seguir devolviendo algo razonable.
   *
   * `pide-info` se sirve con el predicado NUEVO: la pregunta que quien lo pidió
   * quería hacer es «¿quién pidió algo y espera?», y eso ahora se responde bien.
   */
  if (intencion === "pide-info") condicionesBase.push(sql`pregunto AND NOT respondida`);
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
  /**
   * El recorte «En ventana» del Pipeline — a quién se le puede escribir AHORA
   * sin pagar una plantilla (`cola/ventana.ts`). Va como RECORTE y no como
   * intención, igual que `precio`, porque en el tablero define el universo de la
   * columna: con él puesto, «3.451 Contactados» tiene que decir cuántos de esos
   * están en ventana, no cuántos hay en total.
   *
   * MISMO predicado que el chip de la cola. Con dos, el Pipeline ofrecería un
   * número y Mensajes otro para la misma pregunta (#37).
   */
  if (opciones.ventana) condicionesRecorte.push(PUEDO_ESCRIBIRLE);
  /**
   * El recorte «Para seguir» — el que convierte 3.051 Cotizados en una lista de
   * trabajo (`cola/tiempoEnEtapa.ts`, donde está el porqué medido). Recorte y no
   * intención, por lo mismo que los otros dos: con él puesto, el total de la
   * columna tiene que decir el tamaño de LO RECORTADO.
   */
  if (opciones.seguir) condicionesRecorte.push(paraSeguirSql);
  /**
   * El recorte «Se calló con el precio»: los 540 que conversaban y dejaron de
   * hacerlo justo al ver el número. Recorte y no intención, por lo mismo que los
   * otros tres — define el universo del que la columna informa el total.
   */
  if (opciones.seCallo) condicionesRecorte.push(seCalloConElPrecioSql);
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
  /**
   * ══ 🔴 EL REPARTO NO ALCANZA A LOS FORMULARIOS, Y SI SE APLICA LOS BORRA ═══
   *
   * `esMiaSql` mira `conversacion_asignada`, que se llena en el webhook de la
   * Cloud API — o sea, **cuando llega un MENSAJE**. Un lead de landing no pasa
   * por ahí y nunca puede tener una fila: el predicado no lo filtra, lo elimina.
   *
   * Medido en local contra una copia de producción (11-ago-2026): con
   * `ventas10@grupogoberna.com` —que está en la rueda, así que `enElReparto` se
   * prende sola— «Te esperan» devolvía **1 tarjeta y CERO formularios**, contra
   * las 531 (154 de ellas formularios) que ve alguien fuera de la rueda. El
   * frente entero era invisible **justo para las cinco personas que venden**.
   *
   * Por eso la exención es POR FILA y no apagando el recorte: las 377
   * conversaciones tienen que seguir recortándose (para eso existe el reparto),
   * y los formularios tienen que seguir estando.
   *
   * ⚠️ **La consecuencia se acepta a ojos abiertos**: las cinco ven la MISMA pila
   * de formularios, así que dos pueden abrirle a la misma persona. Es peor que
   * repartirlos y muchísimo mejor que esconderlos — y repartirlos es un frente
   * propio, con su lugar ya pensado (`contacto_habilitado`, ADR 0035). Es el
   * mismo criterio de `sinLineasPropias`: un filtro que no puede filtrar se dice,
   * no se aplica.
   */
  const mia = esMia ? sql`((${esMia}) OR tipo = 'lead')` : null;
  const soloMias =
    conAsignacion && (opciones.misAsignadas || opciones.enElReparto) && mia ? [mia] : [];

  const condiciones = [...condicionesBase, ...condicionesRecorte, ...soloMias];

  const donde = (c: SQL[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);
  const yTodas = (c: SQL[]) => (c.length ? sql.join(c, sql` AND `) : sql`true`);

  /**
   * 🔴 `todo` SE CALCULA UNA VEZ POR PEDIDO, Y ANTES SE CALCULABA TRES.
   *
   * La página, los conteos de los chips y el desglose del embudo son tres
   * `execute` distintos, y los tres arrancaban con el MISMO `conTodo(...)`: el
   * hash join de las 13.195 interacciones contra `events`, el sort de 10 MB que
   * cae a disco y los ~20 agregados con regex sobre el texto. Medido en
   * producción el 11-ago-2026: **1.645 + 1.310 + 1.193 ms**, y la primera página
   * —la única que el front pide— tardaba 5,6 s contra 1,8 s de la segunda, que
   * se saltea dos de las tres.
   *
   * La tabla temporal muere sola con el `COMMIT` (`ON COMMIT DROP`), así que no
   * hay nada que limpiar ni nada que pueda sobrevivir a la conexión y ensuciar
   * el próximo pedido que la tome del pool.
   *
   * 🔴 **SE LLAMA `todo`, IGUAL QUE LA CTE QUE REEMPLAZA, Y NO ES POR COMODIDAD.**
   * Varias CTEs de las consultas de abajo (`ventas`, `padron`, `cats`) leen
   * `FROM todo`, y **una CTE no puede ver un alias del `FROM`**: con la tabla
   * llamada `cola_todo` y un `FROM cola_todo todo`, esas CTEs se evalúan antes y
   * revientan con `relation "todo" does not exist`. Lo encontró el test con base
   * —los cuatro degradados a la vez, que es como se ve desde afuera cualquier
   * error en esta consulta—, no el typecheck.
   *
   * ⚠️ **El desglose NO lee de acá, y eso lo garantiza el SHADOWING de SQL**: su
   * consulta declara su propia CTE `todo` (con `pins = null` a propósito, porque
   * su universo es la foto del embudo, sin las fijadas viejas que entran por la
   * banda de pin), y un nombre de CTE **tapa** a una tabla homónima. Si alguien
   * le sacara esa CTE, empezaría a leer esta tabla y le sumaría a alguna etapa
   * las conversaciones fijadas fuera de la ventana — una diferencia que en
   * pantalla es un número y nada más. Lo fija `desglose.pins.test.db.ts`.
   */
  await base.execute(sql`
    CREATE TEMP TABLE todo ON COMMIT DROP AS
    ${conTodo(filtroCanal, pins, lineas, canal)}
    SELECT * FROM todo
  `);

  // El orden es la urgencia canónica (cola/urgenciaSql.ts) con la BANDA DE PIN
  // encima (#49): las fijadas arriba de todo, dentro de la banda sigue mandando
  // el nivel 0–5. `etapa_manual` llega de la última gestión (etapaEfectivaSql.ts);
  // el estado personal, del LEFT JOIN a `estado_conversacion`.
  const filas = await base.execute(sql`
    WITH seguimientos AS (
      ${seguimientosPendientesSql}
    ),
    ultimas_gestiones AS (
      ${ultimasGestionesSql}
    ),
    ventas AS (
      ${ventaPosteriorCteSql}
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
           precio_enviado, ventana_abierta, pregunto, pregunto_precio, solo_clic, n,
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
           -- DESDE CUÁNDO ESTÁ EN ESA ETAPA (cola/tiempoEnEtapa.ts). Viaja el
           -- INSTANTE y no «hace 12 d», por lo mismo que ventana_cierra: el
           -- texto envejece adentro del caché de IndexedDB (ADR 0007) y un
           -- «hace 12 d» serializado la semana pasada hoy es falso.
           (${etapaDesdeSql}) AS etapa_desde,
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
    ${VENTA_JOIN}
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
      pregunto_precio: number;
      te_escribieron: number;
      sin_responder: number;
      ya_compraron: number;
      bot_escalada: number;
      bot_caliente: number;
      puedo_escribirle: number;
      mios: number;
    }>(sql`
      WITH ultimas_gestiones AS (${ultimasGestionesSql}),
      ventas AS (${ventaPosteriorCteSql}),
      cats AS (${categoriasCteSql}),
      padron AS (${padronCteSql(conPadron)})
      SELECT count(*) FILTER (WHERE ${yTodas([...condicionesBase, ...soloMias])})::int AS n,
             -- Cada conteo usa EL MISMO predicado que su filtro de arriba: el
             -- chip no puede prometer un número y la cola devolver otro.
             count(*) FILTER (WHERE ${conMias(sql`pregunto_precio`)})::int   AS pregunto_precio,
             count(*) FILTER (WHERE ${conMias(sql`NOT respondida AND ultimo_entrante_at > now() - (${DIAS_DEUDA_VIVA} || ' days')::interval`)})::int AS te_escribieron,
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
      ${VENTA_JOIN}
      ${estadoJoinSql(vendedoraId, conEstado)}
      LEFT JOIN cats ON cats.clave = todo.clave
      ${padronJoinSql(conPadron)}
      ${botJoinSql(conBot)}
      ${asignadaJoinSql(conAsignacion)}
      ${donde(condicionesRecorte)}
    `);
    total = r?.n;
    conteosFiltro = {
      preguntoPrecio: r?.pregunto_precio ?? 0,
      teEscribieron: r?.te_escribieron ?? 0,
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
      canal,
      // Acá SÍ: estamos adentro de la transacción y `todo` ya está armado.
      true,
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
  base: Ejecutor,
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
  // El canal entra por lo mismo que las líneas: define el UNIVERSO de la foto.
  // Sin él, el brazo de los leads de formulario se sumaría al desglose aunque la
  // cola esté recortada a WhatsApp, y los conteos dirían otra cosa que la lista.
  canal?: string,
  /**
   * ¿Ya hay una tabla temporal `todo` armada en esta transacción?
   *
   * 🔴 **DOS LLAMADORES CON DOS CONTEXTOS, y confundirlos rompe el Dashboard.**
   * `ejecutarCola` corre adentro de una transacción y ya pagó el `todo` para la
   * página y los conteos: ahí compartirlo se ahorra la tercera pasada. Pero
   * `contarPorEtapaEfectiva` (el embudo del Dashboard) entra por la puerta de al
   * lado, sin transacción y sin tabla, así que tiene que armarse el suyo. Lo
   * encontró el test de paridad con el Dashboard, no el typecheck.
   */
  desdeTablaCompartida = false,
): Promise<FilaDesglose[]> {
  /**
   * 🔴 `en_ventana` ES LO QUE LE PERMITE COMPARTIR LA TABLA TEMPORAL DE LA COLA.
   *
   * Este desglose armaba su propio `todo` con `pins = null`, y esa era la ÚNICA
   * diferencia con el de la cola: sin la banda de pin, una conversación fijada
   * cuyos mensajes quedaron todos fuera de la ventana no entra a la foto del
   * embudo. Rearmarlo costaba una tercera pasada completa —1.193 ms medidos en
   * producción— para excluir un puñado de filas.
   *
   * Ahora los tres brazos del UNION traen `en_ventana` («¿habría entrado sin el
   * pin?») y acá se recorta con eso. **El universo es exactamente el mismo que
   * antes**, y lo fija `consultarCola.desglosePins.test.db.ts` sembrando justo
   * el caso que los distingue: una conversación fijada y vieja.
   *
   * ⚠️ El filtro va en los DOS modos y en el propio no cambia nada: sin pins,
   * `msg` ya trae solo mensajes de la ventana, así que `en_ventana` es verdadero
   * para todas. Dejarlo en un solo camino sería tener dos definiciones del
   * universo del embudo esperando a divergir (#37).
   */
  const soloDelEmbudo = [sql`en_ventana`, ...condiciones];
  const donde = sql`WHERE ${sql.join(soloDelEmbudo, sql` AND `)}`;
  const filas = await base.execute<FilaDesglose>(sql`
    ${desdeTablaCompartida ? sql`WITH` : sql`${conTodo(filtroCanal, null, lineas, canal)},`}
    ultimas_gestiones AS (${ultimasGestionesSql}),
    ventas AS (${ventaPosteriorCteSql}),
    padron AS (${padronCteSql(conPadron)})
    SELECT (${etapaEfectivaSql})        AS etapa,
           ya_le_hablamos               AS "yaLeHablamos",
           precio_enviado               AS precio,
           (${vivaSql})                 AS viva,
           (${PUEDO_ESCRIBIRLE})        AS ventana,
           -- «Para seguir» entra como UNA dimensión booleana y no como buckets de
           -- antigüedad: el desglose es un GROUP BY sobre todo el universo, y
           -- cuatro tramos por etapa lo multiplicarían para responder una sola
           -- pregunta. El instante exacto ya viaja en la fila (etapa_desde).
           (${paraSeguirSql})           AS "paraSeguir",
           (${seCalloConElPrecioSql})   AS "seCallo",
           count(*)::int                AS n
    FROM todo
    LEFT JOIN ultimas_gestiones USING (clave)
    ${VENTA_JOIN}
    ${padronJoinSql(conPadron)}
    ${botJoinSql(conBot)}
    ${asignadaJoinSql(conAsignacion)}
    ${donde}
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  `);
  return filas.map((f) => ({
    etapa: f.etapa,
    yaLeHablamos: f.yaLeHablamos,
    precio: f.precio,
    viva: f.viva,
    ventana: f.ventana,
    paraSeguir: f.paraSeguir,
    seCallo: f.seCallo,
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
