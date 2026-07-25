import { sql, type SQL } from "drizzle-orm";
import { cursoDeLeadSql, sufijoTelefonoSql } from "../gente/leadDeTelefono.js";

/**
 * DE DÓNDE SALE EL CURSO DE UNA FILA DE LA COLA (#72), APARTE de `consultarCola`.
 *
 * Mismo patrón que `urgenciaSql.ts` y `estadoSql.ts`: la consulta caliente
 * COMPONE fragmentos con nombre en vez de esconder el criterio dentro de un SQL
 * de cien líneas. Acá viven las dos fuentes de dato que el chip necesita servidas
 * EN EL LISTADO (nunca un fetch por fila):
 *
 *   · `interesUltimoCteSql` — el interés más reciente asentado para la clave.
 *   · `leadCursoCteSql`     — el curso del formulario que la persona llenó —y el
 *                             NOMBRE con el que lo llenó—, emparejado por
 *                             teléfono contra `leads`.
 *
 * La PRECEDENCIA entre las dos (y el anuncio) NO vive acá: es una decisión de
 * presentación y vive pura en el front (`src/features/canales/curso.ts`), donde
 * se testea sin base. El server sirve los candidatos; el front elige.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta ya expone el CTE
 * `todo` (con `clave`, `canal`, `tipo`, `persona_id`).
 *
 * NADA DE LO QUE SE PREGUNTA A `leads` SE REESCRIBE ACÁ. La llave de
 * emparejamiento (`sufijoTelefonoSql`) y qué curso dice un lead
 * (`cursoDeLeadSql`) vienen de `gente/leadDeTelefono.ts`, que es su único hogar
 * y del que ya comen la ficha y el panel de negocio (`dashboard/negocio.ts`,
 * #128). Si la cola se escribiera su propia versión, la MISMA persona saldría
 * con un curso en el Dashboard y con otro en su fila — la divergencia de #37,
 * otra vez, con otro nombre.
 */

/**
 * EL INTERÉS QUE MANDA: el más reciente por conversación. Una persona que
 * pregunta por dos cursos tiene dos filas en `intereses` (#57 las muestra todas
 * en la ficha, como línea de tiempo); en una fila de la cola entra uno solo, y
 * el que corresponde es **el último que dijo**, igual que `pide_info` (#49).
 */
export const interesUltimoCteSql: SQL = sql`
  SELECT DISTINCT ON (clave) clave, curso
  FROM intereses
  ORDER BY clave, creado_at DESC
`;

/**
 * LOS SUFIJOS DE TELÉFONO DE LA COLA — el puente barato hacia `leads`.
 *
 * Solo WhatsApp: ahí `persona_id` ES el teléfono. Un PSID de Messenger también
 * es una cadena de dígitos, y sus últimos 9 podrían chocar con los de un
 * teléfono real — sería un curso INVENTADO en la fila de otra persona. Se
 * prefiere no mostrar chip antes que mostrar uno falso.
 */
export const sufijosDeLaColaCteSql: SQL = sql`
  SELECT DISTINCT (${sufijoTelefonoSql("persona_id")}) AS sufijo
  FROM todo
  WHERE canal = 'whatsapp' AND tipo = 'mensaje' AND persona_id IS NOT NULL
`;

/**
 * EL CURSO DEL LEAD —Y SU NOMBRE—, UNO POR SUFIJO. Se arranca desde `sufijos`
 * (los ~1.900 de la cola) y no desde `leads` (26.000) para que el planner haga
 * UNA pasada por `leads` y no una por fila.
 *
 * DESEMPATE: el lead MÁS RECIENTE con curso. Es a propósito distinto de
 * `elegirMejorLead` (`gente/emparejar.ts`), que prioriza el que trae email:
 * son dos preguntas distintas. La ficha pregunta «¿de dónde saco un email para
 * cotizar?»; la cola pregunta «¿qué pidió esta persona la última vez?», y ahí lo
 * viejo no manda sobre lo nuevo.
 *
 * `nombre` (#137) es UNA COLUMNA MÁS de la fila que este `DISTINCT ON` ya elige:
 * el join a `leads` ya está hecho, así que no cuesta ninguna pasada nueva. Y es
 * lo que convierte «🦋W», «.» o «10 ❤️L» —el pushname que la persona eligió en
 * WhatsApp— en la persona real que llenó el formulario. Sale del MISMO lead que
 * el curso: nombre y curso no pueden venir de dos personas distintas.
 *
 * ⚠️ BORDE: un lead que no dice ningún curso no entra a este CTE, así que
 * tampoco aporta su nombre. Es el borde conocido de `cursoDeLeadSql` (sin
 * `campaign_name` ni `form_name` no hay nada que decir) y hoy son un puñado: no
 * se abre una segunda pasada por ellos.
 */
export const leadCursoCteSql: SQL = sql`
  SELECT DISTINCT ON (s.sufijo) s.sufijo, (${cursoDeLeadSql}) AS curso, l.full_name AS nombre
  FROM sufijos s
  JOIN leads l ON (${sufijoTelefonoSql("l.phone")}) = s.sufijo
  WHERE (${cursoDeLeadSql}) IS NOT NULL AND (${cursoDeLeadSql}) <> ''
  ORDER BY s.sufijo, l.created_time DESC
`;

/** El LEFT JOIN de la fila contra el curso de su lead (solo tiene sentido en WhatsApp). */
export const leadCursoJoinSql: SQL = sql`LEFT JOIN lead_curso lc
  ON todo.canal = 'whatsapp' AND todo.tipo = 'mensaje'
  AND lc.sufijo = (${sufijoTelefonoSql("todo.persona_id")})`;
