import { and, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { notas } from "../db/schema.js";
import type { QuienPregunta } from "./visibilidad.js";

/**
 * EL GEMELO EN SQL DE `visibilidad.ts` — mismo patrón que `urgenciaSql`,
 * `ventanaCierraSql` y `etapaEfectivaSql`: la regla vive una vez en TS (pura, para
 * poder interrogarla) y una vez en SQL (para poder filtrar sin traerse la tabla),
 * **con un test de paridad que las cruza contra una base de verdad**
 * (`visibilidad.paridad.test.db.ts`).
 *
 * ══ POR QUÉ NO ALCANZA CON LA FUNCIÓN PURA ══════════════════════════════════
 *
 * Porque filtrar en el proceso significa **traer primero las filas de todos**. Con
 * la frontera en el `WHERE`, una página de un espacio ajeno no sale de Postgres;
 * filtrándola arriba, ya viajó — y el día que alguien agregue un `limit` antes del
 * filtro, la lista queda corta sin que nada avise.
 *
 * ══ 🔴 SI ESTAS DOS DIVERGEN, NO FALLA: SIRVE DE MÁS ════════════════════════
 *
 * Es la razón de que el candado sea un test con base y no uno puro. Un `OR` de
 * más acá no rompe ninguna consulta ni tira ninguna excepción: devuelve un 200
 * con la libreta privada de otra persona. Por eso el test recorre **todas** las
 * combinaciones de (espacio de la página × autora × quién pregunta) y exige que
 * las dos respuestas coincidan en cada una.
 */

/**
 * ¿Qué páginas ve esta persona? Se mete en el `and(...)` de cualquier consulta
 * sobre `notas`.
 *
 * ⚠️ **Los dos `false` son FAIL-CLOSED y no son lo mismo.**
 *   · sin `vendedoraId` en el token → no hay libreta privada que mostrar (y no
 *     se cae a «todas»: un recorte que no recorta y no avisa es el defecto que
 *     este repo persigue);
 *   · sin espacios → `inArray(x, [])` en drizzle genera SQL inválido, así que la
 *     rama se escribe explícita. Con la lista vacía la respuesta correcta es
 *     «ninguno», nunca «todos».
 *
 * `lower(btrim(...))` de los DOS lados: el mismo humano tiene dos grafías vivas
 * en producción (Cerberus empuja `Luz`, ella entra como `luz`). El gemelo en TS
 * es `mismaVendedora`. Normalizar de un lado solo es lo único que reabre el
 * agujero — y el índice `espacio_miembro_vendedora_idx` está sobre `lower(...)`
 * justamente para que esto no cueste un seq scan.
 */
export function visibleParaSql(quien: QuienPregunta): SQL {
  const miLibretaPrivada = miLibretaPrivadaSql(quien.vendedoraId);

  const misEspacios: SQL = quien.espacios.length
    ? (inArray(notas.espacioId, [...quien.espacios]) as SQL)
    : sql`false`;

  return or(miLibretaPrivada, misEspacios) as SQL;
}

/**
 * 🔴 «MI LIBRETA PRIVADA», EN UN SOLO LUGAR — `espacio_id IS NULL AND vendedora_id = yo`,
 * con `lower(btrim(...))` de los DOS lados.
 *
 * **Está exportada porque el caso más obvio se la salteó.** `listarNotas` escribía
 * su propia versión con un `eq()` pelado, y `buscarNotas` usaba `visibleParaSql`,
 * que sí normaliza. Resultado medido (issue #386): para **Luz** —que Cerberus
 * guarda como `Luz` y que entra tipeando `luz`— **la lista daba cero páginas y el
 * buscador encontraba esas mismas páginas**. No hay error ni log: hay una libreta
 * vacía, que se lee como «no escribí nada todavía».
 *
 * Es exactamente el agujero que el comentario de arriba dice que normalizar de un
 * solo lado reabre — sólo que el que normalizaba de un lado era el llamador. Por
 * eso ahora la expresión no se puede volver a escribir a mano: se pide acá.
 */
export function miLibretaPrivadaSql(vendedoraId: string | null | undefined): SQL {
  const yo = (vendedoraId ?? "").trim().toLowerCase();
  // Sin `vendedoraId` no hay libreta privada que mostrar — fail-closed, como arriba.
  if (!yo) return sql`false`;
  return and(isNull(notas.espacioId), sql`lower(btrim(${notas.vendedoraId})) = ${yo}`) as SQL;
}

/**
 * La misma normalización, para las notas HISTÓRICAS de `gestiones` (solo lectura,
 * anteriores a #47). Tabla distinta, misma trampa: `gestiones.vendedora_id` también
 * lo escribe Cerberus con su grafía.
 */
export function mismaVendedoraEnSql(columna: SQL | { name: string }, vendedoraId: string | null | undefined): SQL {
  const yo = (vendedoraId ?? "").trim().toLowerCase();
  if (!yo) return sql`false`;
  return sql`lower(btrim(${columna})) = ${yo}`;
}
