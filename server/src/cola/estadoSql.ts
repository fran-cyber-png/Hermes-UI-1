import { sql, type SQL } from "drizzle-orm";

/**
 * LOS FRAGMENTOS DEL ESTADO PERSONAL (#49, ADR 0014), APARTE de `consultarCola`.
 *
 * Nacieron acá para no pisarse con el frente de la etapa efectiva (#88/#89), que
 * tocaba el mismo archivo — y el patrón se quedó porque funciona: la consulta
 * caliente COMPONE fragmentos con nombre (el LEFT JOIN al estado, el derivado
 * `no_leido`, la banda de pin, el join a categorías) en vez de esconder el
 * criterio adentro de un SQL de cien líneas. La misma razón de ser que
 * `urgenciaSql.ts` y `etapaEfectivaSql.ts`.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta expone `todo`
 * (con `clave` y `ultimo_entrante_at`), el alias `ec` del estado personal y el
 * alias `cats` de las categorías. `consultarCola.desdeTodo` los provee.
 */

/**
 * El LEFT JOIN al estado personal (`estado_conversacion`) POR VENDEDORA. Sin
 * vendedora (llamadas internas sin token) el join no matchea nada y `ec.*` queda
 * NULL en todas las filas → los defaults: no fijada, no favorita, sin cursor.
 *
 * `conEstado: false` = MODO DEGRADADO (la tabla todavía no existe en esa base):
 * ni siquiera se nombra la tabla, así la consulta no revienta. Ver `esTablaAusente`.
 */
export function estadoJoinSql(vendedoraId: string | undefined, conEstado = true): SQL {
  if (!conEstado || !vendedoraId) {
    // Un LEFT JOIN contra una fila vacía tipada: `ec.*` existe (NULL) sin tocar
    // `estado_conversacion`. Mantiene el resto de la consulta idéntica.
    return sql`LEFT JOIN (
      SELECT NULL::text AS vendedora_id, NULL::text AS clave, NULL::boolean AS fijada,
             NULL::timestamptz AS fijada_at, NULL::boolean AS favorita,
             NULL::timestamptz AS leido_hasta
      WHERE false
    ) ec ON false`;
  }
  return sql`LEFT JOIN estado_conversacion ec ON ec.vendedora_id = ${vendedoraId} AND ec.clave = todo.clave`;
}

/**
 * LAS CLAVES FIJADAS de la vendedora — el CTE `pins`, que existe para UNA cosa:
 * que una conversación fijada siga apareciendo **aunque se caiga de la ventana de
 * 30 días**.
 *
 * Sin esto, fijar tres conversaciones y dejarlas envejecer las volvía invisibles
 * PERO seguían ocupando el tope de 3: la vendedora quedaba sin poder fijar nada
 * nuevo y sin forma de soltar las viejas (no las veía para desfijarlas). Fijar
 * algo significa «quiero verlo siempre»; la ventana no puede romper esa promesa.
 *
 * Es un conjunto diminuto (≤3 filas por vendedora), así que el `OR … IN (pins)`
 * de la ventana no arruina el plan: Postgres resuelve el índice de la ventana y
 * suma estas pocas por clave.
 */
export function pinsCteSql(vendedoraId: string | undefined, conEstado = true): SQL {
  if (!conEstado || !vendedoraId) return sql`SELECT NULL::text AS clave WHERE false`;
  return sql`SELECT clave FROM estado_conversacion WHERE vendedora_id = ${vendedoraId} AND fijada`;
}

/**
 * ¿El error es «esa tabla no existe» (Postgres 42P01)? La cola ENTERA depende de
 * `estado_conversacion`, y esa tabla se aplica con `db:push` MANUAL: entre que el
 * código sale y alguien corre el push, la cola respondería 500 y la vendedora se
 * queda sin su mesa de trabajo. Con esto, `consultarCola` reintenta en modo
 * degradado (sin pin ni no-leído) y la cola sigue sirviendo lo que importa.
 */
export function esTablaAusente(e: unknown): boolean {
  // Drizzle envuelve el error del driver en un «Failed query: …» y deja el
  // PostgresError real (con su `code`) colgando de `cause`. Sin mirar la cadena
  // de causas, el 42P01 pasa desapercibido y la degradación no se dispara.
  for (let actual: unknown = e, saltos = 0; actual != null && saltos < 5; saltos++) {
    if (typeof actual !== "object") break;
    if ((actual as { code?: string }).code === "42P01") return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * `no_leido` DERIVADO (la casa no guarda lo derivable): hay un entrante posterior
 * al cursor de lectura, o nunca se abrió (`leido_hasta IS NULL`) y hay algún
 * entrante. Es DISTINTO de `respondida`: se puede leer sin responder.
 */
export const noLeidoSql: SQL = sql`(todo.ultimo_entrante_at IS NOT NULL AND (ec.leido_hasta IS NULL OR todo.ultimo_entrante_at > ec.leido_hasta))`;

/**
 * `favorita` con su default. Es una EXPRESIÓN (no el alias del SELECT) para que
 * valga igual en el `WHERE` del tab, en el `SELECT` de la fila y en el `GROUP BY`
 * de los conteos: el filtro y lo que se muestra no pueden divergir.
 */
export const favoritaSql: SQL = sql`COALESCE(ec.favorita, false)`;

/**
 * El prefijo de orden de la BANDA DE PIN: las fijadas arriba de todo, la más
 * vieja primero (estable). Va ANTES de la urgencia de 6 niveles — la banda se
 * SUMA encima, no reemplaza el orden canónico (dentro de la banda sigue la
 * urgencia). En SQL: `fijada DESC` (true antes que false), `fijada_at ASC`.
 */
export const bandaPinOrdenSql: SQL = sql`fijada DESC, fijada_at ASC`;

/**
 * Las categorías (etiquetas) de cada conversación, agregadas por clave. Sirve
 * para dos cosas: filtrar la cola por una categoría (modo Listas de #49) y
 * pintar la píldora de color en la fila. `lower(etiqueta)` es la clave de join
 * contra `categorias.nombre` (que también se guarda normalizado).
 */
export const categoriasCteSql: SQL = sql`
  SELECT clave, array_agg(DISTINCT lower(etiqueta)) AS categorias
  FROM etiquetas
  GROUP BY clave
`;

/**
 * Los CURSOS DE INTERÉS registrados de cada conversación, en el orden en que se
 * registraron (la línea de tiempo de #57). Es la palabra de la vendedora y lo que
 * la compuerta de Cotizado exige.
 *
 * Viaja EN la fila porque el tablero lo pedía de a uno: cada tarjeta montaba su
 * propio `GET /api/gestiones/intereses?claves=<una>` — 30 tarjetas, 30 requests
 * para una tabla que hoy tiene un puñado de filas. La lista y el editor no son la
 * misma altitud: la fila muestra, la ficha edita.
 */
export const cursosCteSql: SQL = sql`
  SELECT clave, array_agg(curso ORDER BY creado_at, id) AS cursos
  FROM intereses
  GROUP BY clave
`;
