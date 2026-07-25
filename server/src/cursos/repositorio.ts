import { eq } from "drizzle-orm";
import type { db } from "../db/client.js";
import { aliasCurso } from "../db/schema.js";
import { ALIAS_SEMILLA, type AliasCurso } from "./alias.js";

/**
 * LA TABLA DE ALIAS, VISTA DESDE EL CÓDIGO — leer los activos y sembrar los de fábrica.
 *
 * Recibe `db` INYECTADO (patrón de la casa, ADR 0008): la ruta le pasa el
 * singleton, el test su base de prueba.
 */

/**
 * Los alias vigentes. **Degrada, no rompe**: si la tabla todavía no existe
 * (`alias_curso` entra por `db:push` manual, ver el Gotcha del CLAUDE.md), la
 * consulta falla y esto devuelve una lista vacía — la app se comporta como
 * antes, sin propuestas, en vez de tirar 500 en la ficha de todas las
 * conversaciones. Es la misma decisión que la auto-respuesta tomó con sus tablas.
 *
 * El aviso se imprime UNA vez por proceso: si no, cada request de la cola
 * llenaría el log del server con la misma línea.
 */
let yaAvisoFalta = false;

export async function aliasesActivos(base: typeof db): Promise<AliasCurso[]> {
  try {
    const filas = await base
      .select({
        alias: aliasCurso.alias,
        familia: aliasCurso.familia,
        nombreCurso: aliasCurso.nombreCurso,
      })
      .from(aliasCurso)
      .where(eq(aliasCurso.activo, true));
    return filas;
  } catch (err) {
    if (!yaAvisoFalta) {
      yaAvisoFalta = true;
      console.error(
        "[cursos] no se pudieron leer los alias de curso (¿falta `npm run db:push`?): " +
          `${(err as Error).message}. El interés derivado queda apagado hasta que la tabla exista.`,
      );
    }
    return [];
  }
}

/**
 * SIEMBRA IDEMPOTENTE — con esto nace la tabla y así se mantiene al día cuando
 * la semilla suma una familia.
 *
 * `ON CONFLICT DO NOTHING` sobre `alias` es lo que hace que sea seguro correrla
 * en cada arranque: **no pisa nada de lo editado a mano**. Un alias que alguien
 * desactivó (`activo = false`) NO revive, porque la fila ya existe y el insert
 * no la toca. Uno que alguien BORRÓ sí vuelve — por eso la forma correcta de
 * sacar un alias de circulación es desactivarlo (ver el comentario de la tabla).
 */
export async function sembrarAliasCurso(
  base: typeof db,
  semilla: readonly AliasCurso[] = ALIAS_SEMILLA,
): Promise<number> {
  if (semilla.length === 0) return 0;
  const insertadas = await base
    .insert(aliasCurso)
    .values(semilla.map((a) => ({ alias: a.alias, familia: a.familia, nombreCurso: a.nombreCurso })))
    .onConflictDoNothing()
    .returning({ id: aliasCurso.id });
  return insertadas.length;
}
