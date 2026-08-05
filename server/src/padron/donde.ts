import type { ConexionIcarus } from "./conexion.js";
import type { Dimension, Filtros } from "./filtros.js";

/**
 * EL `WHERE` DEL PADRÓN, EN UN SOLO LUGAR.
 *
 * Lo arman DOS consumidores —la lista (`consultarPadron.ts`) y las facetas
 * (`facetas.ts`)— y tienen que decir exactamente lo mismo: si divergen, la
 * pantalla ofrece «México · 11.646» y al tildarlo aparecen otras filas, o peor,
 * ninguna. Es la lección de #37 aplicada antes de pagarla: una implementación,
 * no dos que coinciden.
 *
 * ── `omitir` y por qué las facetas lo necesitan ──
 * La faceta de una dimensión se cuenta con TODOS los filtros puestos MENOS el de
 * ella misma. Si se contara con el suyo incluido, al tildar «Perú» la lista de
 * países se reduciría a Perú y **no habría forma de agregar México**: el filtro
 * se cerraría sobre sí mismo. Con `omitir: 'pais'`, tildar Perú deja ver que
 * México sigue teniendo 11.646 y que ahora son sumables.
 */

export interface Recorte {
  filtros: Filtros;
  /** Los ids ya repartidos (para «sin repartir»). Ver `db/padron.ts`: no hay JOIN. */
  habilitados: readonly number[];
  /** El recorte de la vendedora. `null` = sin recorte (supervisor). */
  soloEstos: readonly number[] | null;
}

/** ¿Este recorte no puede devolver NADA, sin necesidad de preguntarle a la base? */
export function recorteVacio({ soloEstos }: Recorte): boolean {
  // FRONTERA, NO FILTRO: con la lista vacía no se consulta. Dejar que el SQL
  // resuelva `id = ANY('{}')` daría lo mismo hoy, pero pone la garantía en una
  // expresión que alguien puede reescribir sin notarlo.
  return soloEstos !== null && soloEstos.length === 0;
}

export function donde(
  sql: ConexionIcarus,
  { filtros, habilitados, soloEstos }: Recorte,
  omitir?: Dimension,
): ReturnType<ConexionIcarus> {
  const cond: ReturnType<ConexionIcarus>[] = [sql`TRUE`];

  // ⚠️ El `::bigint[]` NO es decorativo. `sql.array` de postgres.js serializa una
  // lista de números JS como `text[]`, y `bigint = text` no existe en Postgres:
  // la consulta revienta entera. Compila perfecto y ningún test puro lo ve.
  if (soloEstos !== null) cond.push(sql`c.id = ANY(${sql.array([...soloEstos])}::bigint[])`);

  if (filtros.q) {
    const patron = `%${filtros.q}%`;
    cond.push(sql`(
      c.name ILIKE ${patron} OR c.email ILIKE ${patron}
      OR c.phone ILIKE ${patron} OR c.dni ILIKE ${patron}
    )`);
  }

  // Multivalor: OR adentro de cada dimensión (`= ANY`), AND entre dimensiones.
  if (omitir !== "etapa" && filtros.etapa) cond.push(sql`c.stage = ANY(${sql.array(filtros.etapa)})`);
  if (omitir !== "nivel" && filtros.nivel) cond.push(sql`c.buyer_tier = ANY(${sql.array(filtros.nivel)})`);
  if (omitir !== "pais" && filtros.pais) cond.push(sql`c.country = ANY(${sql.array(filtros.pais)})`);
  if (omitir !== "fuente" && filtros.fuente) cond.push(sql`c.source = ANY(${sql.array(filtros.fuente)})`);
  if (omitir !== "curso" && filtros.curso) {
    // Las dos columnas: `last_course` es en qué anda hoy, `course` con qué entró.
    // Un contacto entra al recorte si CUALQUIERA de las dos está en la selección.
    cond.push(
      sql`(c.last_course = ANY(${sql.array(filtros.curso)}) OR c.course = ANY(${sql.array(filtros.curso)}))`,
    );
  }

  // El teléfono se limpia en SQL y no en JS: filtrar en el navegador obliga a
  // traer las 72.923 filas para tirar 1.582.
  if (filtros.conTelefono) {
    cond.push(sql`length(regexp_replace(coalesce(c.phone,''), '\\D', '', 'g')) >= 8`);
  }
  if (filtros.conVenta) {
    cond.push(sql`EXISTS (SELECT 1 FROM icarus.sales s WHERE s.contact_id = c.id)`);
  }
  if (filtros.sinHabilitar && habilitados.length > 0) {
    cond.push(sql`NOT (c.id = ANY(${sql.array([...habilitados])}::bigint[]))`);
  }

  return cond.reduce((a, b) => sql`${a} AND ${b}`);
}
