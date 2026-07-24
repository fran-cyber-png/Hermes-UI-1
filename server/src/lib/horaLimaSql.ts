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
