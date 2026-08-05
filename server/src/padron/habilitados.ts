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

/** Tope de un reparto por lista explícita de ids. Ver la ruta para el porqué. */
export const LOTE_MAX = 500;

/**
 * Filas por INSERT.
 *
 * Postgres corta en 65.535 parámetros por statement y acá van 4 por fila, así que
 * el techo real está en ~16.383: con 5.000 hay margen de sobra. No es velocidad,
 * es que el statement no reviente cuando se reparte un recorte entero.
 */
const TANDA_INSERT = 5_000;

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
  const cuando = new Date();

  // ⚠️ EN TANDAS, Y NO ES UNA OPTIMIZACIÓN. El protocolo de Postgres corta en
  // **65.535 parámetros por statement**, y acá van 4 por fila: a partir de ~16.383
  // contactos el INSERT falla entero. Desde que se puede repartir un recorte
  // completo (17.014 peruanos, por ejemplo) eso dejó de ser hipotético. 5.000
  // deja margen de sobra y sigue siendo una sola ida por tanda.
  for (let i = 0; i < unicos.length; i += TANDA_INSERT) {
    const tanda = unicos.slice(i, i + TANDA_INSERT);
    await base
      .insert(contactoHabilitado)
      .values(
        tanda.map((id) => ({
          contactoId: id,
          vendedoraId,
          habilitadoPor: por,
          habilitadoEn: cuando,
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
  }

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
