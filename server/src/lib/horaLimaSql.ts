import { sql, type SQL } from "drizzle-orm";

/**
 * EL CORTE DE DÍA DE LIMA, EN SQL — la mitad con IO de `horaLima.ts` (que se
 * mantiene puro a propósito, sin depender de drizzle).
 *
 * `(columna AT TIME ZONE 'America/Lima')::date` se repetía igual, letra por
 * letra, en `dashboard/series.ts` y `dashboard/porVendedora.ts` (8 veces entre
 * los dos, #98) — un solo lugar que lo escribe evita que una de las copias
 * quede con otra zona el día que alguien la toque a mano.
 */
export function diaLimaSql(columna: string): SQL {
  return sql`(${sql.raw(columna)} AT TIME ZONE 'America/Lima')::date`;
}

/**
 * LA HORA DE PARED de Lima (0–23) — el eje del gráfico de cobertura horaria y
 * la frontera del horario de atención (#126). Espejo SQL de `horaLimaDelDia`
 * (`horaLima.ts`); vive acá, pegado a `diaLimaSql`, para que la zona horaria se
 * escriba en UN archivo y no en cada consulta que la necesite.
 */
export function horaDelDiaLimaSql(columna: string): SQL {
  return sql`extract(hour from (${sql.raw(columna)} AT TIME ZONE 'America/Lima'))::int`;
}
