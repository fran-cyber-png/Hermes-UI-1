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
/**
 * EL ORDEN DE ARRIBA: primero los pines, después lo que no se leyó.
 *
 * ── Por qué «leído» baja, aunque no esté respondido ─────────────────────
 * Decisión del dueño (7-ago-2026). El comportamiento anterior era el contrario y
 * también tenía su razón —«leer no es atender», un lead que espera sigue
 * esperando— pero el costo diario era peor: abrir un chat para ver qué decía lo
 * dejaba clavado arriba, y la cola se llenaba de cosas ya miradas que había que
 * saltear a mano una y otra vez.
 *
 * ⚠️ **Lo que esto cuesta, dicho claro**: un chat LEÍDO y urgente queda debajo de
 * uno SIN LEER que no lo es. Dentro de cada grupo la urgencia sigue mandando,
 * pero entre grupos gana la lectura.
 *
 * **La red que lo hace aceptable ya existía**: el chip «Sin responder» filtra por
 * `NOT respondida`, que no mira el cursor de lectura — así que todo lo que se
 * leyó y no se contestó sigue estando ahí, a un clic y con su número. Sin ese
 * chip, esta decisión escondería deuda; con él, solo la ordena distinto.
 */
/**
 * ── LO DE OTRA VENDEDORA VA DESPUÉS, y por eso esto es una función ──────────
 *
 * 🔴 Reportado por Luz el 14-ago-2026: «veo otros chats y se quedan arriba, no
 * puedo dar seguimiento». Medido: su línea (`51984429504`) tiene **1.158
 * conversaciones repartidas entre seis personas**, y el orden de arriba ponía
 * `no_leido` antes que todo lo demás — así que un chat **de ventas12**, viejo y
 * con 20 sin leer que ella no va a contestar nunca, le tapaba sus propios leads
 * del día. Cuanto más abandonada la conversación ajena, más arriba quedaba.
 *
 * El criterio nuevo se mete ANTES de `no_leido` y dice sólo esto: **lo que tiene
 * dueña y no soy yo, va después**. Lo mío y lo que no tiene dueño (que es de
 * quien lo agarre) siguen compitiendo entre sí exactamente como antes.
 *
 * ⚠️ **Esto NO oculta nada, y la diferencia importa**: el reparto es un FILTRO,
 * no un permiso — las conversaciones ajenas se siguen sirviendo y se siguen
 * viendo, sólo que abajo. Ocultarlas sería una frontera imaginaria, que es peor
 * que ninguna porque se le cree (ver §Administración de números).
 *
 * ⚠️ Se compara **normalizando los dos lados**: en producción conviven `Luz`
 * (lo empuja Cerberus a `numero_vendedora`) y `luz` (lo que ella tipea al
 * entrar). Con comparación exacta, sus propias conversaciones le aparecerían
 * como ajenas y el arreglo haría exactamente lo contrario de lo que promete.
 *
 * Sin `vendedoraId` —un servicio, o un token sin identidad— el criterio no se
 * agrega y el orden queda idéntico al de antes.
 *
 * ⚠️ **Recibe la EXPRESIÓN del dueño, no el alias `asignada_a`.** Postgres
 * acepta un alias del SELECT en `ORDER BY` sólo si va solo: adentro de una
 * expresión contesta `column "asignada_a" does not exist`. Lo dijo el test la
 * primera vez que corrió.
 *
 * ⚠️ El `coalesce` no es de estilo: con `dueno IS DISTINCT FROM yo`, una
 * conversación SIN dueño daría «distinta» y se iría al fondo junto con las
 * ajenas — y lo que no tiene dueño es justamente de quien lo agarre. Con
 * `coalesce(dueno, yo)` el hueco se lee como propio, que es lo que es.
 */
export function bandaPinOrdenSql(vendedoraId?: string | null, dueno?: SQL): SQL {
  const ajenaVaDespues =
    vendedoraId && dueno
      ? sql`(coalesce(lower(${dueno}), lower(${vendedoraId})) <> lower(${vendedoraId})) ASC, `
      : sql``;
  return sql`fijada DESC, fijada_at ASC, ${ajenaVaDespues}no_leido DESC`;
}

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
