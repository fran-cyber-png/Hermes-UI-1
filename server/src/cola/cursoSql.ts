import { sql, type SQL } from "drizzle-orm";
import { sufijoTelefonoSql } from "../gente/leadDeTelefono.js";

/**
 * DE DÓNDE SALE EL CURSO DE UNA FILA DE LA COLA (#72), APARTE de `consultarCola`.
 *
 * Mismo patrón que `urgenciaSql.ts` y `estadoSql.ts`: la consulta caliente
 * COMPONE fragmentos con nombre en vez de esconder el criterio dentro de un SQL
 * de cien líneas. Acá viven las dos fuentes de dato que el chip necesita servidas
 * EN EL LISTADO (nunca un fetch por fila):
 *
 *   · `interesUltimoCteSql` — el interés más reciente asentado para la clave.
 *   · `leadCursoCteSql`     — el curso del formulario que la persona llenó,
 *                             emparejado por teléfono contra `leads`.
 *
 * La PRECEDENCIA entre las dos (y el anuncio) NO vive acá: es una decisión de
 * presentación y vive pura en el front (`src/features/canales/curso.ts`), donde
 * se testea sin base. El server sirve los candidatos; el front elige.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta ya expone el CTE
 * `todo` (con `clave`, `canal`, `tipo`, `persona_id`).
 *
 * LA LLAVE DE EMPAREJAMIENTO NO SE REESCRIBE ACÁ: el sufijo de 9 dígitos con el
 * que se cruza contra `leads` viene de `gente/leadDeTelefono.ts`, que es el
 * módulo que lo inventó y del que ya comen la ficha y el panel de negocio
 * (`dashboard/negocio.ts`). Tres escrituras de la misma regla de match es la
 * clase de divergencia silenciosa que costó #37 y #96.
 */

/**
 * QUÉ CURSO DICE UN LEAD. Espejo en SQL de `fuenteDeLead` (`gente/emparejar.ts`):
 *
 *   · lead de LANDING WEB (`platform='web'` o `form_name` del namespace de
 *     ICARUS) → el curso viaja en `campaign_name`; el mapeo de #102 pone ahí el
 *     nombre del producto y deja `form_name` en una etiqueta fija
 *     (`icarus:landing`, `icarus:Datos`), que no dice nada.
 *   · lead de FORMULARIO DE META → el `form_name` es el nombre limpio del
 *     diploma («Diploma técnico en Osint & Socmint»); `campaign_name` es el
 *     nombre de la campaña publicitaria, que no siempre es un curso.
 *
 * Medido en producción el 25-jul-2026: los 26.075 leads son de landing web, con
 * el curso en `campaign_name`.
 */
export const cursoDelLeadSql: SQL = sql`CASE
  WHEN l.platform = 'web' OR l.form_name LIKE 'icarus:%' THEN l.campaign_name
  ELSE COALESCE(NULLIF(l.form_name, ''), l.campaign_name)
END`;

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
 * EL CURSO DEL LEAD, UNO POR SUFIJO. Se arranca desde `sufijos` (los ~1.900 de
 * la cola) y no desde `leads` (26.000) para que el planner haga UNA pasada por
 * `leads` y no una por fila.
 *
 * DESEMPATE: el lead MÁS RECIENTE con curso. Es a propósito distinto de
 * `elegirMejorLead` (`gente/emparejar.ts`), que prioriza el que trae email:
 * son dos preguntas distintas. La ficha pregunta «¿de dónde saco un email para
 * cotizar?»; la cola pregunta «¿qué pidió esta persona la última vez?», y ahí lo
 * viejo no manda sobre lo nuevo.
 */
export const leadCursoCteSql: SQL = sql`
  SELECT DISTINCT ON (s.sufijo) s.sufijo, (${cursoDelLeadSql}) AS curso
  FROM sufijos s
  JOIN leads l ON (${sufijoTelefonoSql("l.phone")}) = s.sufijo
  WHERE (${cursoDelLeadSql}) IS NOT NULL AND (${cursoDelLeadSql}) <> ''
  ORDER BY s.sufijo, l.created_time DESC
`;

/** El LEFT JOIN de la fila contra el curso de su lead (solo tiene sentido en WhatsApp). */
export const leadCursoJoinSql: SQL = sql`LEFT JOIN lead_curso lc
  ON todo.canal = 'whatsapp' AND todo.tipo = 'mensaje'
  AND lc.sufijo = (${sufijoTelefonoSql("todo.persona_id")})`;
