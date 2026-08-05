import type { ConexionIcarus } from "./conexion.js";
import { donde, recorteVacio, type Recorte } from "./donde.js";
import { DIMENSIONES, type Dimension } from "./filtros.js";

/**
 * QUÉ SE PUEDE ELEGIR, Y CUÁNTOS HAY DE CADA UNO.
 *
 * ══ POR QUÉ ESTO ES EL FILTRO Y NO UN ADORNO ═════════════════════════════
 *
 * Sin conteos, un multiselect de 62 países es una lista de nombres: el supervisor
 * tilda «Honduras», ve 1.400 y recién ahí sabe si valía la pena. Con conteos
 * decide ANTES de tildar, que es la diferencia entre filtrar y tantear.
 *
 * Y las opciones **se derivan de los datos**, no de una lista escrita a mano:
 * `stage`, `source` y `country` los escribe icarus, que es otro repo y otro
 * equipo. Una constante nuestra envejecería en silencio — mostraría una etapa que
 * ya no existe y escondería la que inventaron el mes pasado. Es la misma decisión
 * que el vocabulario de momentos del catálogo (ADR 0023): se deriva en cada
 * request, nada de un JSON que alguien tiene que acordarse de actualizar.
 *
 * ══ CADA DIMENSIÓN SE CUENTA SIN SU PROPIO FILTRO ════════════════════════
 *
 * Con el filtro de país puesto, la faceta de país se calcula **omitiéndolo**. Si
 * no, al tildar «Perú» la lista se reduciría a Perú y no habría forma de agregar
 * México: el filtro se cerraría sobre sí mismo y habría que borrarlo para ver qué
 * más existe. El resto de las dimensiones sí se aplican — por eso los números
 * bajan cuando tildás «ya compraron», que es la información que se quiere.
 *
 * El precio son cinco consultas en vez de una. Sobre 72.923 filas es barato, y se
 * pagan en paralelo.
 */

/** Un valor elegible, con cuántos contactos le corresponden en el recorte actual. */
export interface OpcionFaceta {
  valor: string;
  contactos: number;
}

export type Facetas = Record<Dimension, OpcionFaceta[]>;

/** La columna real de cada dimensión. `curso` mira dos y por eso no está acá. */
const COLUMNA: Record<Exclude<Dimension, "curso">, string> = {
  pais: "country",
  etapa: "stage",
  nivel: "buyer_tier",
  fuente: "source",
};

/**
 * Cuántos valores se devuelven por dimensión.
 *
 * 80 cubre con aire los 62 países y los 102 cursos vivos hoy — de los cursos, la
 * cola larga son ediciones viejas con dos o tres contactos. El buscador de la
 * pantalla filtra sobre lo que llegó; si algún día la cola importa, esto crece
 * acá y en un solo lugar.
 */
const TOPE_OPCIONES = 80;

const VACIAS: Facetas = { pais: [], curso: [], etapa: [], nivel: [], fuente: [] };

export async function consultarFacetas(sql: ConexionIcarus, recorte: Recorte): Promise<Facetas> {
  if (recorteVacio(recorte)) return { ...VACIAS };

  const pares = await Promise.all(
    DIMENSIONES.map(async (d) => [d, await unaFaceta(sql, recorte, d)] as const),
  );
  return Object.fromEntries(pares) as Facetas;
}

async function unaFaceta(
  sql: ConexionIcarus,
  recorte: Recorte,
  dimension: Dimension,
): Promise<OpcionFaceta[]> {
  // El WHERE es el MISMO de la lista (`donde.ts`), menos esta dimensión.
  const where = donde(sql, recorte, dimension);

  // `curso` se cuenta sobre las dos columnas y no sobre una: un contacto que
  // entró con «Foro de Estado» y hoy anda en «Gestión Pública» tiene que
  // aparecer en las dos opciones, o el conteo no coincidiría con lo que el
  // filtro después devuelve (que mira las dos, ver `donde.ts`).
  const valor =
    dimension === "curso"
      ? sql`unnest(ARRAY[c.last_course, c.course])`
      : sql`c.${sql(COLUMNA[dimension])}`;

  const filas = (await sql`
    -- OJO: DISTINCT sobre el contacto, no count(*). Para el curso, el unnest emite
    -- DOS filas por contacto (lo que declaró y en lo que anda), así que quien tiene
    -- el mismo curso en las dos columnas se contaba dos veces: la faceta ofrecía
    -- «Curso A · 4» y el filtro devolvía 3. Una faceta que no coincide con su
    -- propio filtro es peor que no tenerla — el supervisor reparte mirando ese
    -- número. Lo atrapó facetas.test.db.ts.
    SELECT v AS valor, count(DISTINCT c.id)::int AS contactos
    FROM icarus.contacts c, LATERAL (SELECT ${valor} AS v) x
    WHERE ${where}
      -- Un valor vacío no es una opción: «filtrar por país en blanco» no es algo
      -- que alguien quiera pedir, y ocuparía el primer renglón de la lista con
      -- 4.053 contactos que no comparten nada entre sí.
      AND v IS NOT NULL AND btrim(v) <> ''
    GROUP BY v
    ORDER BY count(DISTINCT c.id) DESC, v ASC
    LIMIT ${TOPE_OPCIONES}
  `) as unknown as { valor: string; contactos: number }[];

  return filas.map((f) => ({ valor: f.valor, contactos: Number(f.contactos) }));
}
