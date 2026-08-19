import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { CORPUS } from "./corpusDeTextos.js";
import { esTextoDeAnuncio, pregunto, preguntoPrecio, preguntoSql, soloClicSql } from "./pregunta.js";

/**
 * PARIDAD SQL ≡ TS DE «¿PIDIÓ ALGO?» — el candado del patrón de ADR 0009.
 *
 * El predicado vive dos veces por necesidad (la cola filtra y cuenta en la base,
 * el front y los tests lo quieren puro) y una sola por diseño. Si alguien toca un
 * nivel de un lado y no del otro, esto falla en CI en vez de callárselo.
 *
 * ⚠️ NO ES UNA PRECAUCIÓN TEÓRICA. El predicado que este módulo reemplaza existía
 * dos veces —`cola/urgenciaSql.ts` y `canales/consultas.ts`— y la segunda copia
 * tenía `info\b` donde la primera tenía `info\y`. En Postgres `\b` es un
 * backspace: esa rama **nunca matcheó nada**, sin error y sin log. Un test como
 * éste lo hubiera atrapado el día que se escribió.
 */


describe("paridad SQL ≡ TS, texto por texto", () => {
  test("«¿pidió algo?» dice lo mismo en Postgres que en TypeScript", async (t) => {
    const db = await baseDePrueba(t);
    for (const texto of CORPUS) {
      const [fila] = await db.execute<{ hay: boolean }>(
        sql`SELECT (${preguntoSql("t.texto")}) AS hay FROM (SELECT ${texto}::text AS texto) t`,
      );
      assert.equal(fila.hay, pregunto(texto), `«${texto}» difiere entre SQL y TS`);
    }
  });

  test("«¿solo hizo clic?» dice lo mismo en Postgres que en TypeScript", async (t) => {
    const db = await baseDePrueba(t);
    for (const texto of CORPUS) {
      const [fila] = await db.execute<{ hay: boolean }>(
        sql`SELECT (${soloClicSql("t.texto")}) AS hay FROM (SELECT ${texto}::text AS texto) t`,
      );
      assert.equal(fila.hay, esTextoDeAnuncio(texto), `«${texto}» difiere entre SQL y TS`);
    }
  });

  test("el corpus ejercita las dos respuestas de cada predicado", async () => {
    // Un test de paridad sobre un corpus que da siempre `false` pasaría con dos
    // implementaciones rotas. Esto verifica que el corpus discrimine.
    const conteo = (f: (s: string) => boolean) => CORPUS.filter(f).length;
    assert.ok(conteo(pregunto) >= 10, "pocos positivos de `pregunto` en el corpus");
    assert.ok(conteo((s) => !pregunto(s)) >= 10, "pocos negativos de `pregunto` en el corpus");
    assert.ok(conteo(esTextoDeAnuncio) >= 5, "pocos textos de anuncio en el corpus");
    assert.ok(conteo(preguntoPrecio) >= 8, "pocas señales de plata en el corpus");
  });
});
