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
 * De dónde sale `seguimiento_en`: el pendiente MÁS VIEJO de la agenda por
 * conversación (`recordatorios.clave` es la misma clave transversal de la cola).
 * El más viejo porque es el compromiso más incumplido; los hechos ya no son una
 * promesa. Si el módulo decide que todavía no venció (fecha futura), la fila
 * sigue su curso por los demás niveles — eso lo decide la urgencia, no este JOIN.
 * Sin filtro por vendedora a propósito: la cola es de la mesa, y una promesa
 * hecha por cualquiera marca la conversación para todas.
 */
export const seguimientosPendientesSql: SQL = sql`
  SELECT clave, min(cuando) AS seguimiento_en
  FROM recordatorios
  WHERE estado = 'pendiente'
  GROUP BY clave
`;

/**
 * ¿PIDE QUE LA CONTACTEN? — canónico (#96): antes había dos regex divergidos,
 * uno en `cola/consultarCola.ts` + `routes/interactions.ts` (más rico) y otro,
 * más pobre, en `cola/consultarRadar.ts` (pero con `inversion`/`temario`, que
 * el otro no tenía). Este es la UNIÓN de ambos — no pierde señal de ninguno.
 *
 * Toma la columna como parámetro (mismo patrón que `diaLimaSql` en
 * `horaLimaSql.ts`): los call-sites la referencian distinto — `texto` a secas
 * en cola/interactions, `i.texto` calificado en el CTE de comentarios del radar.
 */
export function pideInfoSql(columna: string): SQL {
  return sql`${sql.raw(columna)} ~* '(informaci|info\\b|precio|costo|cuánto|cuanto|inscri|matricul|interes|quiero|cómo|más datos|mas datos|detalle|inversion|temario)'`;
}

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
