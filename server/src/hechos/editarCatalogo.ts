import { eq } from "drizzle-orm";
import type { db } from "../db/client.js";
import { hechos as tabla } from "../db/schema.js";

/**
 * EL SEAM DE ESCRITURA DEL CATÁLOGO — las tres mutaciones de `hechos`.
 *
 * La gemela de `repositorio.ts`, que es la mitad que LEE. Acá vive la que
 * escribe: alta, edición y apagado. Recibe `base` INYECTADO, igual que
 * `leerCatalogo` y `consultarSenales`: la ruta le pasa el singleton y un test
 * con base efímera le pasa la suya (ADR 0008). Antes esto era `db.insert` y dos
 * `db.update` escritos adentro de `routes/hechos.ts`, o sea SQL que ningún test
 * podía llamar sin levantar Express.
 *
 * **Los errores de base NO se atrapan acá, a propósito**: qué código HTTP le
 * corresponde a cada fallo —409 «ya hay un dato con esa clave», 503 «falta la
 * tabla»— es una decisión de la ruta, y las tres la toman distinto. Atraparlos
 * acá obligaría a inventar un vocabulario de motivos que hoy nadie necesita.
 */

/** La fila tal cual sale de la tabla: es lo que el endpoint devuelve como `hecho`. */
export type HechoFila = typeof tabla.$inferSelect;

/** El alta. Devuelve la fila creada —con su `id` y sus fechas—, que es lo que viaja en el 201. */
export async function crearHecho(
  base: typeof db,
  datos: typeof tabla.$inferInsert,
): Promise<HechoFila> {
  const [fila] = await base.insert(tabla).values(datos).returning();
  return fila;
}

/**
 * La edición parcial, por `clave` (la identidad: el rótulo se puede renombrar,
 * la clave no se toca). `actualizadoAt` se estampa acá porque es del hecho de
 * escribir, no un campo que el cliente pueda mandar.
 *
 * `undefined` = no hay fila con esa clave. Qué se contesta con eso —el 404— lo
 * decide la ruta.
 */
export async function actualizarHecho(
  base: typeof db,
  clave: string,
  cambios: Partial<typeof tabla.$inferInsert>,
): Promise<HechoFila | undefined> {
  const [fila] = await base
    .update(tabla)
    .set({ ...cambios, actualizadoAt: new Date() })
    .where(eq(tabla.clave, clave))
    .returning();
  return fila;
}

/**
 * Borrar es APAGAR. La frase que dejó de funcionar sirve de historia, y un
 * borrado físico haría que el catálogo no se pueda auditar contra las ventas.
 *
 * Mismo trato que la edición para la fila que no está: `undefined`, y el código
 * lo elige la ruta.
 */
export async function apagarHecho(
  base: typeof db,
  clave: string,
): Promise<HechoFila | undefined> {
  const [fila] = await base
    .update(tabla)
    .set({ activo: false, actualizadoAt: new Date() })
    .where(eq(tabla.clave, clave))
    .returning();
  return fila;
}
