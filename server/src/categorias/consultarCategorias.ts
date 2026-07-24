import { and, eq, sql } from 'drizzle-orm';
import type { db } from '../db/client.js';
import { categorias } from '../db/schema.js';
import { CATEGORIAS_DEFAULT, normalizarNombre, type ColorCategoria } from './paleta.js';

/**
 * EL CATÁLOGO DE CATEGORÍAS — el seam inyectable (estilo `consultarCola`).
 *
 * Recibe `db` INYECTADO: la ruta le pasa el singleton, el test su base de
 * prueba (`baseDePrueba`). Todo lo que toca la base vive acá para poder testear
 * el CRUD y el conteo contra una Postgres de verdad (harness #33), sin levantar
 * el HTTP ni la auth.
 */

/** El catálogo tal como lo devuelve el CRUD (sin conteo). */
export interface Categoria {
  id: number;
  nombre: string;
  color: string;
  esFavorito: boolean;
  orden: number;
}

/**
 * El catálogo + cuántas conversaciones lleva hoy cada categoría. El conteo sale
 * de unir `etiquetas` (la asignación, compartida) por nombre — es lo que el modo
 * Listas de la cola (#49) va a consumir para «la lista de chats se vuelve la
 * lista de categorías».
 */
export interface CategoriaConConteo extends Categoria {
  conteo: number;
}

/** Choque contra `unique(vendedora_id, nombre)`. El router lo traduce a 409. */
export class CategoriaDuplicada extends Error {
  constructor(nombre: string) {
    super(`ya tenés una categoría «${nombre}»`);
    this.name = 'CategoriaDuplicada';
  }
}

/** Detecta la violación de unique de Postgres (23505) para no confundirla con un 500. */
function esConflictoUnico(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505';
}

/**
 * SEED PEREZOSO de los tres defaults del glosario. `onConflictDoNothing` lo hace
 * seguro ante carreras (dos GET a la vez) y ante un backfill previo: nunca duplica.
 */
export async function sembrarDefaults(base: typeof db, vendedoraId: string): Promise<void> {
  await base
    .insert(categorias)
    .values(
      CATEGORIAS_DEFAULT.map((d, i) => ({
        vendedoraId,
        nombre: d.nombre,
        color: d.color,
        orden: i,
      })),
    )
    .onConflictDoNothing();
}

/**
 * El catálogo de la vendedora, ordenado `(orden, nombre)`, con el conteo de
 * conversaciones por categoría. Siembra los defaults si está vacío.
 */
export async function listarCategorias(
  base: typeof db,
  vendedoraId: string,
): Promise<CategoriaConConteo[]> {
  const [contador] = await base.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM categorias WHERE vendedora_id = ${vendedoraId}`,
  );
  if (!contador?.n) await sembrarDefaults(base, vendedoraId);

  const filas = await base.execute(sql`
    SELECT c.id, c.nombre, c.color, c.es_favorito AS "esFavorito", c.orden,
           COALESCE(a.conteo, 0)::int AS conteo
    FROM categorias c
    LEFT JOIN (
      SELECT lower(etiqueta) AS nombre, count(DISTINCT clave)::int AS conteo
      FROM etiquetas
      GROUP BY lower(etiqueta)
    ) a ON a.nombre = c.nombre
    WHERE c.vendedora_id = ${vendedoraId}
    ORDER BY c.orden, c.nombre
  `);
  return filas as unknown as CategoriaConConteo[];
}

/**
 * Crea una categoría en el catálogo de la vendedora. El nombre se normaliza (es
 * la clave de join). El choque de `unique(vendedora_id, nombre)` no revienta el
 * server: `onConflictDoNothing().returning()` vuelve vacío y se traduce a
 * `CategoriaDuplicada` (→ 409). Una categoría recién creada tiene conteo 0.
 */
export async function crearCategoria(
  base: typeof db,
  vendedoraId: string,
  entrada: { nombre: string; color: ColorCategoria },
): Promise<Categoria> {
  const nombre = normalizarNombre(entrada.nombre);
  const [fila] = await base
    .insert(categorias)
    .values({ vendedoraId, nombre, color: entrada.color })
    .onConflictDoNothing()
    .returning();
  if (!fila) throw new CategoriaDuplicada(nombre);
  return { id: fila.id, nombre: fila.nombre, color: fila.color, esFavorito: fila.esFavorito, orden: fila.orden };
}

/**
 * Edita SOLO la propia (filtra por `vendedora_id`): si el id no es de esta
 * vendedora, devuelve `null` (el router → 404) y no toca nada. Renombrar a un
 * nombre ya usado choca contra el unique → `CategoriaDuplicada`.
 */
export async function editarCategoria(
  base: typeof db,
  vendedoraId: string,
  id: number,
  patch: { nombre?: string; color?: ColorCategoria; esFavorito?: boolean; orden?: number },
): Promise<Categoria | null> {
  const cambios: Partial<typeof categorias.$inferInsert> = {};
  if (patch.nombre !== undefined) cambios.nombre = normalizarNombre(patch.nombre);
  if (patch.color !== undefined) cambios.color = patch.color;
  if (patch.esFavorito !== undefined) cambios.esFavorito = patch.esFavorito;
  if (patch.orden !== undefined) cambios.orden = patch.orden;

  const donde = and(eq(categorias.id, id), eq(categorias.vendedoraId, vendedoraId));

  // Patch vacío: no hay nada que cambiar, pero seguimos respetando el scope —
  // devolvemos la fila actual si es suya, null si no.
  if (Object.keys(cambios).length === 0) {
    const [actual] = await base.select().from(categorias).where(donde);
    return actual
      ? { id: actual.id, nombre: actual.nombre, color: actual.color, esFavorito: actual.esFavorito, orden: actual.orden }
      : null;
  }

  let filas;
  try {
    filas = await base.update(categorias).set(cambios).where(donde).returning();
  } catch (e) {
    if (esConflictoUnico(e)) throw new CategoriaDuplicada(String(cambios.nombre ?? ''));
    throw e;
  }
  const fila = filas[0];
  return fila
    ? { id: fila.id, nombre: fila.nombre, color: fila.color, esFavorito: fila.esFavorito, orden: fila.orden }
    : null;
}

/**
 * Borra la entrada del CATÁLOGO (solo la propia). Las ASIGNACIONES (`etiquetas`)
 * quedan intactas: se pintan neutras hasta re-etiquetar. Devuelve si borró algo.
 */
export async function borrarCategoria(
  base: typeof db,
  vendedoraId: string,
  id: number,
): Promise<boolean> {
  const filas = await base
    .delete(categorias)
    .where(and(eq(categorias.id, id), eq(categorias.vendedoraId, vendedoraId)))
    .returning({ id: categorias.id });
  return filas.length > 0;
}

/**
 * BACKFILL (one-off, idempotente): por cada `(vendedora_id, lower(etiqueta))`
 * distinto de la tabla `etiquetas`, siembra una categoría `color='pizarra'`, con
 * `orden` por frecuencia descendente. `ON CONFLICT DO NOTHING` sobre el unique lo
 * hace re-corrible sin duplicar. Devuelve cuántas creó (0 al re-correr).
 */
export async function backfillCategorias(base: typeof db): Promise<number> {
  const filas = await base.execute<{ id: number }>(sql`
    INSERT INTO categorias (vendedora_id, nombre, color, orden)
    SELECT vendedora_id,
           lower(etiqueta) AS nombre,
           'pizarra' AS color,
           (row_number() OVER (PARTITION BY vendedora_id ORDER BY count(*) DESC, lower(etiqueta)) - 1)::int AS orden
    FROM etiquetas
    GROUP BY vendedora_id, lower(etiqueta)
    ON CONFLICT (vendedora_id, nombre) DO NOTHING
    RETURNING id
  `);
  return (filas as unknown as { id: number }[]).length;
}
