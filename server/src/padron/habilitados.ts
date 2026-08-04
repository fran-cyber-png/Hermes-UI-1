import { desc, inArray, sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { contactoHabilitado } from "../db/schema.js";

/**
 * EL REPARTO DEL PADRÓN — lo único que Hermes escribe de este frente.
 *
 * Base inyectada (patrón de la casa): la ruta pasa el singleton, el test su base
 * de prueba. Del otro lado, `consultarPadron.ts` solo lee icarus. La separación
 * es literal: **este archivo escribe y no sabe nada de icarus; aquél lee icarus
 * y no escribe nada**.
 */

/** Tope de un reparto de una vez. Ver `LOTE_MAX` en la ruta para el porqué. */
export const LOTE_MAX = 500;

/**
 * Todos los ids ya repartidos.
 *
 * Es lo que necesita el filtro «sin habilitar», y es la consulta que más va a
 * crecer: con el padrón entero repartido son 72.923 enteros cruzando el proceso.
 * Se acepta porque hoy son cero y porque la alternativa (un FDW entre las dos
 * bases) es infraestructura nueva para un problema que todavía no existe. El día
 * que duela, duele acá y se ve en el tiempo de esta función.
 */
export async function leerHabilitados(base: typeof db): Promise<number[]> {
  const filas = await base.select({ id: contactoHabilitado.contactoId }).from(contactoHabilitado);
  return filas.map((f) => f.id);
}

/**
 * Los ids habilitados a una vendedora.
 *
 * ⚠️ **Compara normalizando los DOS lados**, como `cola/asignadaSql.ts`. En
 * producción el mismo humano tiene dos grafías vivas (Cerberus empuja `Luz`,
 * ella entra como `luz`): con comparación exacta, una fila escrita con la
 * grafía de Cerberus es invisible para su propia dueña, para siempre y sin un
 * solo síntoma — vería su pantalla vacía y leería «no me habilitaron nada».
 *
 * El `btrim` va con el `lower` porque la normalización tiene que ser LA MISMA
 * que la de `mismaVendedora` (`.trim().toLowerCase()`), que es quien decide si
 * el destino es válido al escribir. Con `lower()` solo, un `vendedoraId` con un
 * espacio de más pasaba la validación al repartir y después no encontraba una
 * sola fila al leer — el mismo fallo mudo, entrando por la puerta de al lado.
 * Lo atrapó `habilitados.test.db.ts`.
 */
export async function leerHabilitadosDe(base: typeof db, vendedoraId: string): Promise<number[]> {
  const filas = await base
    .select({ id: contactoHabilitado.contactoId })
    .from(contactoHabilitado)
    .where(sql`lower(btrim(${contactoHabilitado.vendedoraId})) = lower(btrim(${vendedoraId}))`);
  return filas.map((f) => f.id);
}

/**
 * Reparte un lote a una vendedora.
 *
 * **Pisa** lo que ya estuviera asignado (`ON CONFLICT DO UPDATE`): reasignar es
 * el caso normal —alguien se va de vacaciones, alguien renuncia— y fallar ahí
 * obligaría al supervisor a quitar primero y habilitar después, con la ventana
 * en el medio donde el contacto no es de nadie.
 *
 * Devuelve cuántas filas quedaron escritas, no cuántas se pidieron: es el número
 * que la pantalla tiene que mostrar.
 */
export async function habilitar(
  base: typeof db,
  { contactoIds, vendedoraId, por }: { contactoIds: readonly number[]; vendedoraId: string; por: string },
): Promise<number> {
  if (contactoIds.length === 0) return 0;

  // Sin `uniq`, un id repetido en el mismo INSERT rompe el ON CONFLICT
  // («cannot affect row a second time»), y un 500 por un doble clic en la lista
  // se lee como que el reparto no funciona.
  const unicos = [...new Set(contactoIds)];

  await base
    .insert(contactoHabilitado)
    .values(
      unicos.map((id) => ({
        contactoId: id,
        vendedoraId,
        habilitadoPor: por,
        habilitadoEn: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: contactoHabilitado.contactoId,
      set: {
        vendedoraId: sql`excluded.vendedora_id`,
        habilitadoPor: sql`excluded.habilitado_por`,
        habilitadoEn: sql`excluded.habilitado_en`,
      },
    });

  return unicos.length;
}

/** Devuelve contactos al pozo común. Borra la fila: no hay estado «desasignado». */
export async function quitar(base: typeof db, contactoIds: readonly number[]): Promise<number> {
  if (contactoIds.length === 0) return 0;
  const unicos = [...new Set(contactoIds)];
  await base.delete(contactoHabilitado).where(inArray(contactoHabilitado.contactoId, unicos));
  return unicos.length;
}

export interface CargaVendedora {
  vendedoraId: string;
  contactos: number;
}

/**
 * Cuántos tiene cada una — la carga del reparto.
 *
 * Agrupa por la grafía **normalizada** y devuelve una de las grafías vistas: sin
 * eso, `Luz` y `luz` saldrían como dos personas con la mitad de los contactos
 * cada una, y el supervisor repartiría mirando un número falso.
 */
export async function cargaPorVendedora(base: typeof db): Promise<CargaVendedora[]> {
  const filas = await base
    .select({
      vendedoraId: sql<string>`min(${contactoHabilitado.vendedoraId})`,
      contactos: sql<number>`count(*)::int`,
    })
    .from(contactoHabilitado)
    .groupBy(sql`lower(btrim(${contactoHabilitado.vendedoraId}))`)
    .orderBy(desc(sql`count(*)`));
  return filas;
}
