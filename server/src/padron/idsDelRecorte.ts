import type { ConexionIcarus } from "./conexion.js";
import { donde, recorteVacio, type Recorte } from "./donde.js";

/**
 * TODOS LOS IDS DE UN RECORTE — para repartir lo filtrado, no la página.
 *
 * ══ POR QUÉ ESTO PASA POR EL SERVER Y NO POR EL NAVEGADOR ════════════════
 *
 * «Seleccioná los 17.014 de este recorte» se puede resolver de dos formas: que
 * el navegador se traiga los 17.014 ids y los mande de vuelta en el POST, o que
 * mande el RECORTE y el server los resuelva. Es lo segundo, por tres razones que
 * no son de estilo:
 *
 *   · **La red.** 72.923 ids son ~700 KB bajando y otros tantos subiendo, para
 *     una acción que el server puede resolver con una consulta.
 *   · **El límite de parámetros de Postgres.** Un INSERT con 72.923 filas y 4
 *     columnas son 291.692 parámetros, y el protocolo corta en 65.535: el insert
 *     revienta. Se chunkea igual (ver `habilitados.ts`), pero el problema no
 *     tiene por qué nacer.
 *   · **El recorte es la intención.** «Todos los peruanos con venta» es lo que el
 *     supervisor quiso decir; una lista de ids es su fotografía, y las dos cosas
 *     dejan de coincidir apenas entra un contacto nuevo.
 *
 * ══ LA CONTRACARA, DICHA ═════════════════════════════════════════════════
 *
 * Justamente porque el recorte se resuelve DE NUEVO al ejecutar, puede no dar el
 * mismo número que la pantalla mostró: entre que el supervisor miró «17.014» y
 * apretó, pudieron entrar tres contactos peruanos. Por eso la respuesta devuelve
 * **cuántos se habilitaron de verdad**, y la pantalla muestra ese número y no el
 * que tenía en la mano. Un acuse que repita la cifra vieja es cómo una diferencia
 * de 3 se vuelve invisible.
 */

/**
 * Techo de un reparto por recorte.
 *
 * **Cubre el padrón entero a propósito** (72.923 al 4-ago-2026): el supervisor
 * pidió poder repartir «todos los que filtré», y si el filtro está vacío eso son
 * todos. Un tope por debajo del padrón haría que la pantalla ofrezca «elegir los
 * 72.923» y el server los rechace DESPUÉS de confirmar — el peor lugar para un
 * límite.
 *
 * No es un límite técnico (el insert se parte en tandas, ver `habilitados.ts`):
 * es la red contra un padrón que crezca a millones sin que nadie lo note. Cuando
 * se topa, el error dice el número y pide acotar; **no recorta en silencio**,
 * que sería repartir un pedazo sin decir cuál.
 */
export const RECORTE_MAX = 100_000;

export class RecorteDemasiadoGrande extends Error {
  constructor(readonly cuantos: number) {
    super(
      `el recorte tiene más de ${cuantos.toLocaleString("es")} contactos, que es el máximo por ` +
        `reparto. Acotá el filtro (por país, por curso) y repartí por tandas.`,
    );
    this.name = "RecorteDemasiadoGrande";
  }
}

/**
 * Los ids del recorte, ya sin los que el supervisor destildó a mano.
 *
 * Los excluidos se sacan ACÁ y no en el SQL a propósito: son un puñado (lo que
 * alguien destilda mirando la pantalla), y meterlos en el `WHERE` sumaría otro
 * `= ANY` grande a una consulta que ya carga con el de «sin repartir».
 */
export async function idsDelRecorte(
  sql: ConexionIcarus,
  recorte: Recorte,
  excluidos: readonly number[] = [],
  /** Inyectable para poder probar el tope sin sembrar 100.000 filas. */
  tope: number = RECORTE_MAX,
): Promise<number[]> {
  if (recorteVacio(recorte)) return [];

  const where = donde(sql, recorte);

  // Solo el id: traer las 46 columnas de 17.000 filas para descartarlas es la
  // clase de consulta que hace lento un server sin que nadie sepa por qué.
  const filas = (await sql`
    SELECT c.id FROM icarus.contacts c
    WHERE ${where}
    LIMIT ${tope + 1}
  `) as unknown as { id: number | string }[];

  // El +1 del LIMIT es lo que permite distinguir «justo el máximo» de «se pasó»:
  // con LIMIT exacto, un recorte de 30.000 se vería como uno de 25.000 y se
  // repartiría truncado, en silencio.
  if (filas.length > tope) throw new RecorteDemasiadoGrande(filas.length - 1);

  const fuera = new Set(excluidos);
  return filas.map((f) => Number(f.id)).filter((id) => !fuera.has(id));
}
