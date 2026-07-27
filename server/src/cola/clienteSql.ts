import { sql, type SQL } from "drizzle-orm";
import { sufijoTelefonoSql } from "../gente/leadDeTelefono.js";

/**
 * DE DÓNDE SALE «ESTA PERSONA YA COMPRÓ» EN UNA FILA DE LA COLA (#133), APARTE
 * de `consultarCola`.
 *
 * Mismo patrón que `urgenciaSql.ts`, `estadoSql.ts` y `cursoSql.ts`: la consulta
 * caliente COMPONE fragmentos con nombre en vez de esconder el criterio dentro
 * de un SQL de cien líneas.
 *
 * ── El cómo, que es todo el punto del issue ──
 * Hoy el dato existe pero se pide **por HTTP, de a una, al abrir la
 * conversación** (`cerberus/ficha.ts`). Para las 1.997 filas de la cola serían
 * 1.997 llamadas: inviable. Acá se cruza contra la copia local del padrón
 * (`clientes_padron`, que llena `npm run clientes:sincronizar`) **en la misma
 * pasada de la cola**, exactamente como ya se cruza `leads` para el chip de
 * curso: una sola pasada, arrancando desde los teléfonos de la cola (~1.900) y
 * no desde el padrón (10.620).
 *
 * ── La llave, y la guarda de #119 ──
 * El JOIN es por el sufijo de 9 dígitos, `sufijoTelefonoSql`, LA MISMA llave de
 * la ficha, el Dashboard y el chip de curso. No hay una segunda forma de
 * comparar teléfonos.
 *
 * Lo que sí se agrega es una GUARDA, porque el sufijo de 9 asume que todos son
 * peruanos y casi 2 de cada 3 clientes no lo son: la fila del padrón trae su
 * `codigo_pais` y el match se cae si el teléfono de la conversación no empieza
 * con él. Un mexicano de Veracruz (+52 991 234 5678) y un peruano
 * (+51 912 345 678) comparten sufijo; no comparten código. Cuando el padrón no
 * pudo saber el país, `codigo_pais` es NULL y el match vuelve a ser el de
 * siempre — degradación honesta, y el script cuenta cuántas filas quedaron así.
 * El detalle vive en `clientes/padron.ts`.
 *
 * ── Solo WhatsApp ──
 * Igual que el chip de curso: ahí `persona_id` ES el teléfono. Un PSID de
 * Messenger también es una cadena de dígitos y sus últimos 9 podrían chocar con
 * los de un teléfono real — un «Cliente» inventado en la fila de un desconocido
 * es peor que no marcar nada.
 *
 * CONTRATO DE COLUMNAS: los fragmentos asumen que la consulta ya expone el CTE
 * `todo` (con `canal`, `tipo`, `persona_id`) y, para el JOIN, que el CTE se
 * llamó `padron`.
 */

/** Los dígitos pelados de una columna de teléfono. Plomería, no criterio. */
export function digitosSql(columna: string): SQL {
  return sql`regexp_replace(coalesce(${sql.raw(columna)}, ''), '[^0-9]', '', 'g')`;
}

/**
 * EL PADRÓN RECORTADO A LOS TELÉFONOS DE LA COLA, uno por número.
 *
 * Se arranca desde los ~1.900 teléfonos de la cola y no desde las 10.620 filas
 * del padrón, para que el planner haga UNA pasada indexada por
 * `clientes_padron_sufijo_idx` y no una por fila.
 *
 * La llave del CTE es el número COMPLETO (`digitos`), no el sufijo: dos personas
 * de países distintos pueden compartir sufijo, y colapsar por sufijo le daría a
 * una el cliente de la otra — justo el falso positivo que la guarda evita.
 *
 * DESEMPATE: si el padrón tiene varias filas para el mismo número (la misma
 * persona cargada dos veces, que con DNI en el 13,8% de las fichas pasa), gana
 * la de más compras. Marcar de menos a un VIP es peor que marcar de más.
 */
export function padronCteSql(conPadron = true): SQL {
  // DEGRADACIÓN (misma disciplina que `estadoSql.ts`): `clientes_padron` se crea
  // con un `db:push` manual, así que un server ya desplegado puede no tenerla.
  // Sin esto la cola entera tiraría 500 y la vendedora se quedaría sin mesa de
  // trabajo por una marca decorativa. Un SELECT tipado y vacío deja el resto de
  // la consulta IDÉNTICA, sin nombrar la tabla que no existe.
  if (!conPadron) {
    return sql`SELECT NULL::text AS digitos, NULL::text AS nivel, NULL::integer AS compras WHERE false`;
  }
  return sql`
  SELECT DISTINCT ON (t.digitos) t.digitos, p.nivel, p.compras
  FROM (
    SELECT DISTINCT
      (${digitosSql("persona_id")})            AS digitos,
      (${sufijoTelefonoSql("persona_id")})     AS sufijo
    FROM todo
    WHERE canal = 'whatsapp' AND tipo = 'mensaje' AND persona_id IS NOT NULL
  ) t
  JOIN clientes_padron p
    ON p.sufijo = t.sufijo
   AND (p.codigo_pais IS NULL OR t.digitos LIKE p.codigo_pais || '%')
  ORDER BY t.digitos, p.compras DESC, p.cliente_id
`;
}

/** El LEFT JOIN de la fila contra su cliente del padrón (solo tiene sentido en WhatsApp). */
export function padronJoinSql(conPadron = true): SQL {
  if (!conPadron) return sql`LEFT JOIN padron pc ON false`;
  return sql`LEFT JOIN padron pc
  ON todo.canal = 'whatsapp' AND todo.tipo = 'mensaje'
  AND pc.digitos = (${digitosSql("todo.persona_id")})`;
}

/**
 * EL PREDICADO DEL FILTRO «Ya compraron» — dicho una sola vez para que la página,
 * el total, el conteo del chip y el desglose no puedan discrepar (lección de #37).
 */
export const yaComproSql: SQL = sql`pc.nivel IS NOT NULL`;
