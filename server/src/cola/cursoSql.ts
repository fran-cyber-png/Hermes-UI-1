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
 * La PRECEDENCIA entre las dos (y el anuncio) para el CHIP la decide el front
 * (`src/features/canales/curso.ts`): el server le sirve los candidatos y él
 * elige, porque ahí es una decisión de presentación que se testea sin base.
 *
 * Para las consultas que AGRUPAN (el Dashboard por curso, #128) eso no alcanza:
 * traer 1.900 conversaciones para decidir en TypeScript costaría el escaneo
 * entero en cada apertura del panel. Por eso al final de este archivo vive el
 * gemelo en SQL de `cursos/precedencia.ts` — con su test de paridad, que es lo
 * que impide que las dos escrituras se separen (la lección de #37 y del ADR 0009).
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
export const sufijosDeLaColaCteSql: SQL = sufijosCteSql("todo", sql`AND tipo = 'mensaje'`);

/**
 * El mismo CTE, parametrizado por la relación de la que salen las conversaciones.
 *
 * La cola lo arma sobre `todo` (comentarios + conversaciones, de ahí el filtro de
 * `tipo`); el panel de negocio lo arma sobre su propio `base`, que ya son solo
 * conversaciones. **Se generalizó en vez de copiarse** (#128): la llave de match
 * contra `leads` tiene que ser una, o la misma persona sale con un curso en su
 * fila y con otro en el Dashboard.
 */
export function sufijosCteSql(relacion: string, filtroExtra: SQL = sql``): SQL {
  return sql`
  SELECT DISTINCT (${sufijoTelefonoSql("persona_id")}) AS sufijo
  FROM ${sql.raw(relacion)}
  WHERE canal = 'whatsapp' ${filtroExtra} AND persona_id IS NOT NULL
`;
}

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

/**
 * ══ LA PRECEDENCIA, DICHA EN SQL — el gemelo de `cursos/precedencia.ts` ══════
 *
 * `interés registrado > curso del formulario > anuncio`, la regla que cerró el
 * dueño en #72. Vive acá, al lado de los fragmentos que traen los candidatos,
 * porque quien compone la consulta necesita las dos cosas juntas.
 *
 * **Por qué existe un gemelo y no una sola escritura**: la versión pura decide
 * sobre una fila ya traída (el chip, la ficha); esta agrupa 1.900 conversaciones
 * DENTRO de Postgres, sin traerlas. Sacar las filas para decidir en TypeScript
 * costaría el escaneo entero en cada apertura del panel. Lo que impide que se
 * separen es `dashboard/curso.paridad.test.db.ts`, que corre las dos sobre los
 * mismos datos y falla si difieren — el mismo mecanismo que el ADR 0009 puso
 * para la urgencia.
 *
 * Las tres columnas se pasan por nombre porque cada consulta las llama distinto.
 */
export interface ColumnasDeCurso {
  /** La columna con el interés asentado (`intereses.curso`). */
  interes: string;
  /** La columna con el curso del formulario (`cursoDeLeadSql` ya aplicado). */
  lead: string;
  /** La columna jsonb con el origen del mensaje (`events.payload->'origen'`). */
  origen: string;
}

const utilSql = (columna: string): SQL => sql`NULLIF(btrim(${sql.raw(columna)}), '')`;

const tituloAnuncioSql = (origen: string): SQL =>
  sql`CASE WHEN ${sql.raw(origen)}->>'fuente' = 'anuncio'
        THEN NULLIF(btrim(${sql.raw(origen)}->>'titulo'), '') END`;

const adIdAnuncioSql = (origen: string): SQL =>
  sql`CASE WHEN ${sql.raw(origen)}->>'fuente' = 'anuncio'
        THEN NULLIF(btrim(${sql.raw(origen)}->>'adId'), '') END`;

/**
 * El TEXTO CRUDO del curso de la conversación, o `NULL` si ninguna de las tres
 * fuentes dice nada. Nunca se infiere del texto del mensaje.
 *
 * Un anuncio sin título pero con `adId` devuelve cadena vacía (no `NULL`): el
 * curso existe, lo dice el mapeo por anuncio, y perderlo acá sería contar como
 * «sin atribuir» algo que sí está atribuido.
 */
export function cursoCrudoSql(c: ColumnasDeCurso): SQL {
  return sql`COALESCE(
    ${utilSql(c.interes)},
    ${utilSql(c.lead)},
    ${tituloAnuncioSql(c.origen)},
    CASE WHEN ${adIdAnuncioSql(c.origen)} IS NOT NULL THEN '' END
  )`;
}

/** Cuál de las tres fuentes ganó. Es lo que hace que el número nunca mienta sobre su origen. */
export function fuenteCursoSql(c: ColumnasDeCurso): SQL {
  return sql`CASE
    WHEN ${utilSql(c.interes)} IS NOT NULL THEN 'interes'
    WHEN ${utilSql(c.lead)}    IS NOT NULL THEN 'lead'
    WHEN ${tituloAnuncioSql(c.origen)} IS NOT NULL
      OR ${adIdAnuncioSql(c.origen)}    IS NOT NULL THEN 'anuncio'
  END`;
}

/** El `adId` del anuncio cuando el curso salió de ahí — la llave del mapeo humano. */
export function adIdDeCursoSql(c: ColumnasDeCurso): SQL {
  return sql`CASE
    WHEN ${utilSql(c.interes)} IS NOT NULL THEN NULL
    WHEN ${utilSql(c.lead)}    IS NOT NULL THEN NULL
    ELSE ${adIdAnuncioSql(c.origen)}
  END`;
}
