import { sql, type SQL } from "drizzle-orm";
import { ACTIVO_MS } from "./urgencia.js";

/**
 * LA MISMA URGENCIA, DICHA EN SQL.
 *
 * `claveUrgencia` (urgencia.ts) es la definición canónica de los seis niveles.
 * Pero la cola de Mensajes pagina en la base, y para paginar en la base el orden
 * tiene que calcularse en la base — no se puede correr una función de TypeScript
 * dentro de Postgres. Este archivo es esa proyección: las MISMAS seis reglas, en
 * el MISMO orden de precedencia, como fragmentos SQL.
 *
 * POR QUÉ ACÁ Y NO EN LA CONSULTA: antes el SQL vivía dentro de la ruta de la
 * cola, como un «espejo a mantener a mano» — y divergió sin que CI dijera nada
 * (#37): se quedó en 4 niveles cuando el módulo pasó a 6, y la misma conversación
 * salía con prioridad distinta en Mensajes y en el Dashboard. Ahora la urgencia
 * vive UNA vez en `cola/`: la función pura y su proyección SQL, lado a lado,
 * compartiendo las constantes — y el test de paridad
 * (`urgencia.paridad.test.db.ts`) corre las dos contra los mismos datos y falla
 * en CI si dicen cosas distintas. Si tocás un nivel en `urgencia.ts`, tocás este
 * archivo en el mismo commit, y el test es el candado.
 *
 * CONTRATO DE COLUMNAS: los fragmentos nombran las columnas tal como las alias
 * toda consulta que ordena por urgencia — el mismo contrato que `FilaRadar`:
 *   tipo ('comentario'|'mensaje') · respondida (bool) · ventana_abierta (bool) ·
 *   referencia (timestamptz) · seguimiento_en (timestamptz, NULL si no hay).
 */

// Las seis condiciones de `claveUrgencia`, en su orden de precedencia. VIVO le
// gana a VENCIDO a propósito — la decisión está explicada en urgencia.ts, no acá.
const VIVO = sql`(tipo = 'mensaje' AND NOT respondida AND referencia > now() - ${ACTIVO_MS} * interval '1 millisecond')`;
const VENCIDO = sql`(seguimiento_en IS NOT NULL AND seguimiento_en <= now())`;
const EXPIRA = sql`(tipo = 'comentario' AND ventana_abierta AND NOT respondida)`;
const ESPERA = sql`(tipo = 'mensaje' AND NOT respondida)`;
const SILENCIO = sql`(tipo = 'mensaje' AND respondida)`;

/**
 * VIVO suelto — «alguien está escribiendo AHORA»: el nivel 0, sin el resto del
 * CASE. Se exporta para poder contarlo donde no hay `seguimiento_en` a mano (el
 * desglose del embudo): reusar el fragmento es la única forma de que «viva» y el
 * nivel 0 no se separen en silencio.
 */
export const vivaSql: SQL = VIVO;

/** El nivel 0–5 — espejo verificado de `claveUrgencia(...).nivel`. */
export const nivelUrgenciaSql: SQL = sql`CASE
  WHEN ${VIVO} THEN 0
  WHEN ${VENCIDO} THEN 1
  WHEN ${EXPIRA} THEN 2
  WHEN ${ESPERA} THEN 3
  WHEN ${SILENCIO} THEN 4
  ELSE 5
END`;

// El momento que manda, en milisegundos de epoch — la misma unidad que
// `Date.getTime()`, así el `orden` del SQL y el del radar son comparables.
const T = sql`(extract(epoch from referencia) * 1000)`;

/**
 * El desempate dentro del nivel — espejo de `claveUrgencia(...).orden`: negativo
 * donde el más reciente va primero (vivo, silencio, resto), positivo donde el
 * más viejo apremia (expira, espera), y la fecha del COMPROMISO en los vencidos.
 *
 * `::float8` al final: `extract(epoch from ...)` devuelve `numeric` en Postgres,
 * y `pg` manda `numeric` como STRING al cliente para no perder precisión — sin
 * el cast, `orden` llegaba al JSON como `"-1737..."` en vez de un número.
 */
export const ordenUrgenciaSql: SQL = sql`(CASE
  WHEN ${VIVO} THEN -${T}
  WHEN ${VENCIDO} THEN (extract(epoch from seguimiento_en) * 1000)
  WHEN ${EXPIRA} THEN ${T}
  WHEN ${ESPERA} THEN ${T}
  ELSE -${T}
END)::float8`;

/**
 * LA VENTANA DE META — los 7 días para responder EN PRIVADO un comentario público
 * de Facebook o Instagram (`CONTEXT.md` §Ventana). Es el único plazo duro que no
 * se puso la vendedora: cuando se cierra, esa puerta se cierra de verdad.
 *
 * ACÁ Y UNA SOLA VEZ. Estaba escrita TRES veces y las copias ya no coincidían:
 * `consultarCola.ts` exigía `canal IN ('facebook','instagram')` y la del radar
 * (`consultarRadar.ts`) no, así que un comentario de otro canal contaba como
 * «ventana abierta» en el Dashboard y no en Mensajes. Es la lección de #37 en
 * versión chica; se cierra igual que aquella, con un solo hogar.
 */
export const VENTANA_META_DIAS = 7;

/**
 * LOS DÍAS QUE QUEDAN de ventana — el dato del que sale la cuenta regresiva (#22).
 *
 * Antes esto viajaba como un SÍ/NO, y encima siempre verdadero: el `WHERE` de la
 * consulta ya recortaba a 7 días, así que el booleano no podía ser falso ni una
 * vez. De un sí/no tampoco se puede derivar «quedan 2 días», que es lo único que
 * permite avisar ANTES del cierre en lugar de después.
 *
 * `ceil` y no `floor`: mientras quede una hora, queda un día para la vendedora —
 * redondear para abajo diría «0 días» con la puerta todavía abierta. `GREATEST`
 * lo apoya en 0: nunca hay días negativos, hay ventana cerrada.
 *
 * NULL donde no hay ventana — WhatsApp y cualquier canal que no sea FB/IG. NULL
 * es «no aplica», que es distinto de 0 («se cerró»); la pantalla los dice
 * distinto y por eso no se colapsan acá.
 *
 * Toma los nombres de columna como parámetros, igual que `pideInfoSql`: los
 * call-sites las referencian distinto (`occurred_at` a secas en la cola,
 * `i.occurred_at` calificado en el CTE del radar).
 */
export function ventanaDiasSql(occurredAt: string, canal: string): SQL {
  return sql`CASE WHEN ${sql.raw(canal)} IN ('facebook','instagram')
    THEN GREATEST(0, ceil(${VENTANA_META_DIAS} - extract(epoch from (now() - ${sql.raw(occurredAt)})) / 86400))::int
    ELSE NULL::int
  END`;
}

/**
 * ¿La ventana sigue abierta? — DERIVADA de los días que quedan, nunca calculada
 * aparte. Es la columna que consume `EXPIRA` (nivel 2) y los filtros de la cola.
 *
 * `COALESCE(..., false)`: sin ventana (NULL) no hay ventana abierta. Un chat de
 * WhatsApp cae acá y tiene que dar `false`, no NULL — el nivel de urgencia lo
 * lee como booleano.
 *
 * Recibe un FRAGMENTO, no un nombre de columna: los dos call-sites llegan por
 * caminos distintos —el radar ya proyectó `ventana_dias` y la referencia,
 * la cola la calcula en el mismo SELECT— y con un `string` el segundo no se
 * podía expresar.
 */
export function ventanaAbiertaSql(ventanaDias: SQL): SQL {
  return sql`COALESCE((${ventanaDias}) > 0, false)`;
}

/**
 * De dónde sale `seguimiento_en`: el pendiente MÁS VIEJO de la agenda por
 * conversación (`recordatorios.clave` es la misma clave transversal de la cola).
 * El más viejo porque es el compromiso más incumplido; los hechos ya no son una
 * promesa. Si el módulo decide que todavía no venció (fecha futura), la fila
 * sigue su curso por los demás niveles — eso lo decide la urgencia, no este JOIN.
 * Sin filtro por vendedora a propósito: la cola es de la mesa, y una promesa
 * hecha por cualquiera marca la conversación para todas. Filtrarla haría
 * desaparecer del radar de TODAS el compromiso de alguien que está de licencia
 * o que se fue — el criterio contrario de #23 se descartó por eso.
 *
 * `seguimiento_nota` es DE QUÉ se trata el compromiso (#23). Sin ella la fila
 * solo puede decir «vencido», que no le dice a la vendedora qué tiene que hacer.
 *
 * Va con `array_agg(... ORDER BY cuando)` y no con `min(nota)` —el mismo patrón
 * que `pideInfoAgrupadoSql` acá abajo— porque tiene que ser la nota de LA MISMA
 * FILA que dio el `min(cuando)`. Un `min(nota)` devolvería la menor
 * alfabéticamente, que puede ser la de otro recordatorio: la pantalla mostraría
 * una fecha con el texto de otra promesa.
 */
export const seguimientosPendientesSql: SQL = sql`
  SELECT clave,
         min(cuando)                              AS seguimiento_en,
         (array_agg(nota ORDER BY cuando))[1]     AS seguimiento_nota
  FROM recordatorios
  WHERE estado = 'pendiente'
  GROUP BY clave
`;

/**
 * El regex canónico de «pide info» (#96) como LITERAL SQL entre comillas — UNA
 * vez, para que los dos fragmentos de abajo lo compartan sin duplicarlo. Es una
 * constante fija (no entra input de nadie), así que `sql.raw` es seguro y produce
 * el MISMO SQL que el literal inline que tenía `pideInfoSql` antes.
 */
const PIDE_INFO_REGEX_SQL = `'(informaci|info\\y|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle|inversion|temario)'`;

/**
 * ¿ESTE TEXTO PIDE QUE LA CONTACTEN? — el PREDICADO base, sobre un texto suelto.
 * Canónico (#96): antes había dos regex divergidos, uno en `cola/consultarCola.ts`
 * + `routes/interactions.ts` (más rico) y otro, más pobre, en
 * `cola/consultarRadar.ts` (pero con `inversion`/`temario`, que el otro no tenía).
 * Este es la UNIÓN de ambos — no pierde señal de ninguno.
 *
 * Se aplica a lo que es UNA sola cosa dicha: un comentario de FB/IG (que es su
 * propio último mensaje). Para una CONVERSACIÓN agrupada, el fragmento correcto
 * es `pideInfoAgrupadoSql` — no este.
 *
 * Toma la columna como parámetro (mismo patrón que `diaLimaSql` en
 * `horaLimaSql.ts`): los call-sites la referencian distinto — `texto` a secas
 * en cola/interactions, `i.texto` calificado en el CTE de comentarios del radar.
 */
export function pideInfoSql(columna: string): SQL {
  return sql`${sql.raw(columna)} ~* ${sql.raw(PIDE_INFO_REGEX_SQL)}`;
}

/**
 * ¿PIDE INFO ESTA CONVERSACIÓN? — el MISMO predicado aplicado al **último
 * entrante con texto**, dentro de un `GROUP BY` (como `respondidaSql`).
 *
 * POR QUÉ EL ÚLTIMO Y NO `bool_or`: antes esto se derivaba con un `bool_or`
 * histórico y el chip «Pide info» quedaba pegado a TODAS — una persona que
 * preguntó el precio hace semanas lo llevaba para siempre, aunque lo último que
 * dijera fuera «no gracias». Con 1800 conversaciones en cola eso volvió el chip
 * ruido puro: dejó de distinguir al lead caliente del que ya dijo que no.
 * Decisión del dueño (#49): **manda lo último que dijo**.
 *
 * `FILTER (... AND texto IS NOT NULL)`: un audio, una foto o un sticker POSTERIOR
 * no apagan el pedido — la última palabra es el último mensaje que TIENE palabras.
 * `COALESCE(..., false)`: sin ningún entrante con texto, no pide info.
 *
 * Es UNA sola semántica para toda la casa: la usan la cola (`consultarCola`) y el
 * radar del Dashboard (`consultarRadar`). Si divergen otra vez, el chip vuelve a
 * significar cosas distintas en dos pantallas — que es el bug que esto cerró.
 */
export const pideInfoAgrupadoSql: SQL = sql`COALESCE(
  (array_agg(texto ORDER BY occurred_at DESC)
     FILTER (WHERE direccion = 'entrante' AND texto IS NOT NULL))[1] ~* ${sql.raw(PIDE_INFO_REGEX_SQL)},
  false
)`;

/**
 * ¿RESPONDIDA? — hay un saliente igual o posterior al último entrante. Antes
 * escrito dos veces (`consultarCola.ts` y `consultarRadar.ts`), mitigado por
 * el test de paridad de #37 pero sin un hogar único (#96).
 *
 * Opera sobre `direccion`/`occurred_at` sin calificar, dentro de un
 * `GROUP BY` — así están en los dos call-sites, sin parámetros necesarios.
 */
export const respondidaSql: SQL = sql`(max(occurred_at) FILTER (WHERE direccion = 'saliente') IS NOT NULL
  AND max(occurred_at) FILTER (WHERE direccion = 'saliente')
      >= COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), '-infinity'::timestamptz))`;

/**
 * REFERENCIA — el momento que manda para la urgencia: si ya se respondió, el
 * máximo global (cuándo empezó el silencio); si no, el último entrante.
 */
export const referenciaSql: SQL = sql`CASE
  WHEN ${respondidaSql} THEN max(occurred_at)
  ELSE COALESCE(max(occurred_at) FILTER (WHERE direccion = 'entrante'), max(occurred_at))
END`;
