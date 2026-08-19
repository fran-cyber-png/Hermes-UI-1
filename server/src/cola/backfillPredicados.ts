import { sql } from "drizzle-orm";
import type { db } from "../db/client.js";
import { predicadosDelTexto } from "./predicadosDelTexto.js";

/**
 * EL BACKFILL DE LOS PREDICADOS DE TEXTO — el paso del deploy sin el cual esto no
 * acelera nada.
 *
 * La migración es **expand-only**: agrega cuatro columnas nullables y no toca una
 * fila. Las 15.898 que ya estaban quedan en `NULL`, y `NULL` es exactamente lo que
 * dispara el regex de respaldo en `cola/precio.ts` y `cola/pregunta.ts`. O sea que
 * entre el N5 y esto la cola contesta lo correcto y sigue costando lo mismo: **el
 * ahorro llega recién cuando esto corre**.
 *
 * ── POR QUÉ SE CALCULA EN TYPESCRIPT Y NO CON UN `UPDATE ... ~*` ──────────────
 *
 * 🔴 Escribir la columna con el regex del lado de Postgres habría dejado la
 * definición **en tres lugares**: la función pura, el gemelo SQL y esta escritura.
 * Acá corre `predicadosDelTexto()`, que es literalmente la misma función que
 * corren los dos escritores de `interactions`. Una fila backfilleada y una fila
 * nueva no pueden salir distintas porque las calcula el mismo código.
 *
 * ── 🔴 TOCAR EL REGEX DEJA LAS COLUMNAS VIEJAS MINTIENDO ──────────────────────
 *
 * Es la contracara de materializar: `cola/precio.ts` y `cola/pregunta.ts` dejaron
 * de ser «la regla que corre siempre» para ser «la regla que corrió cuando se
 * escribió la fila». Cambiar una palabra del regex y no re-correr esto con
 * `--todo` deja el predicado viejo congelado en las 16.000 filas existentes,
 * **sin error y sin log** — el modo exacto de fallar que este repo ya pagó con
 * `info\b`. Por eso `--todo` existe y por eso el script lo nombra en su ayuda.
 */

type Base = typeof db;

/** Cuántas filas se leen y se escriben por vuelta. */
const TANDA = 2_000;

export interface ResumenBackfill {
  /** Filas leídas (y por lo tanto calculadas). */
  leidas: number;
  /** Filas escritas. En dry-run es 0 y `leidas` dice cuántas se habrían escrito. */
  escritas: number;
  /** Cuántas de las leídas ya tenían el mismo veredicto guardado (sólo con `todo`). */
  sinCambio: number;
}

export interface OpcionesBackfill {
  /** `false` (default) no escribe: sólo cuenta y muestra. */
  aplicar?: boolean;
  /**
   * `false` (default) toca sólo las filas con la columna en `NULL` — el caso del
   * deploy, y es idempotente: correrlo dos veces no hace nada la segunda.
   * `true` **recalcula todo**, que es lo que hay que hacer el día que cambie el
   * regex de `cola/precio.ts` o `cola/pregunta.ts`.
   */
  todo?: boolean;
  /** Para no procesar la tabla entera en una prueba. */
  tope?: number;
}

/**
 * Llena `menciona_precio` · `pregunta_precio` · `pide_datos` · `es_texto_de_anuncio`.
 *
 * Avanza por `id` ascendente y en tandas, así que es interrumpible: lo que ya
 * escribió queda escrito y la corrida siguiente sigue desde donde estaba (con
 * `todo: false`, porque las filas hechas dejan de matchear el `WHERE`).
 *
 * ⚠️ **Con `todo: true` el cursor NO es el `WHERE`**, es el `id`: si el filtro
 * fuera «las que están en NULL» y se recalcula todo, la primera tanda se sacaría
 * a sí misma del conjunto y el `OFFSET` saltearía filas. Por eso se pagina por
 * `id > ultimo`, que no depende de lo que la corrida va escribiendo.
 */
export async function backfillPredicados(
  base: Base,
  { aplicar = false, todo = false, tope }: OpcionesBackfill = {},
): Promise<ResumenBackfill> {
  const resumen: ResumenBackfill = { leidas: 0, escritas: 0, sinCambio: 0 };
  let ultimoId = 0;

  for (;;) {
    const cuantas = tope ? Math.min(TANDA, tope - resumen.leidas) : TANDA;
    if (cuantas <= 0) break;

    const filas = await base.execute<{
      id: number;
      texto: string | null;
      menciona_precio: boolean | null;
      pregunta_precio: boolean | null;
      pide_datos: boolean | null;
      es_texto_de_anuncio: boolean | null;
    }>(sql`
      SELECT id, texto, menciona_precio, pregunta_precio, pide_datos, es_texto_de_anuncio
      FROM interactions
      WHERE id > ${ultimoId}
        ${todo ? sql`` : sql`AND menciona_precio IS NULL`}
      ORDER BY id
      LIMIT ${cuantas}
    `);

    if (filas.length === 0) break;
    resumen.leidas += filas.length;
    ultimoId = Number(filas[filas.length - 1].id);

    const lote: {
      id: number;
      menciona_precio: boolean;
      pregunta_precio: boolean;
      pide_datos: boolean;
      es_texto_de_anuncio: boolean;
    }[] = [];

    for (const fila of filas) {
      const p = predicadosDelTexto(fila.texto);
      const igual =
        fila.menciona_precio === p.mencionaPrecio &&
        fila.pregunta_precio === p.preguntaPrecio &&
        fila.pide_datos === p.pideDatos &&
        fila.es_texto_de_anuncio === p.esTextoDeAnuncio;
      if (igual) {
        resumen.sinCambio += 1;
        continue;
      }
      lote.push({
        id: Number(fila.id),
        menciona_precio: p.mencionaPrecio,
        pregunta_precio: p.preguntaPrecio,
        pide_datos: p.pideDatos,
        es_texto_de_anuncio: p.esTextoDeAnuncio,
      });
    }

    if (aplicar && lote.length > 0) {
      // UN SOLO parámetro pase lo que pase, y por eso va un jsonb y no un
      // `VALUES` por fila: Postgres corta en **65.535 parámetros por statement**,
      // así que con cinco por fila el UPDATE fallaría entero a partir de ~13.000
      // (la misma trampa que el reparto del padrón, ADR 0035). Tampoco `unnest`
      // de cinco arrays: con una sola fila, el binding aplana el array a escalar
      // y Postgres contesta «cannot cast type boolean to boolean[]».
      await base.execute(sql`
        UPDATE interactions AS i
        SET menciona_precio     = t.menciona_precio,
            pregunta_precio     = t.pregunta_precio,
            pide_datos          = t.pide_datos,
            es_texto_de_anuncio = t.es_texto_de_anuncio
        FROM jsonb_to_recordset(${JSON.stringify(lote)}::jsonb)
          AS t(id bigint, menciona_precio boolean, pregunta_precio boolean,
                pide_datos boolean, es_texto_de_anuncio boolean)
        WHERE i.id = t.id
      `);
      resumen.escritas += lote.length;
    }

    if (filas.length < cuantas) break;
  }

  return resumen;
}

/** Cuántas filas siguen sin predicado. Lo que el script imprime para cerrar. */
export async function faltanPredicados(base: Base): Promise<number> {
  const [fila] = await base.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM interactions WHERE menciona_precio IS NULL`,
  );
  return Number(fila?.n ?? 0);
}
