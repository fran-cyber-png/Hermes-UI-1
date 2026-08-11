import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { claveTelefono, mismaIdentidadTelefonica } from "./identidad.js";
import { identidadTelefonicaSql, mismaIdentidadSql } from "./identidadSql.js";
import { PAISES } from "./paises.js";

/**
 * EL CANDADO DE LA IDENTIDAD TELEFÓNICA — `identidadSql.ts` tiene que decir lo
 * MISMO que `identidad.ts`, que es la definición canónica.
 *
 * El SQL se GENERA desde `PAISES`, así que no puede quedarse con una tabla de
 * países vieja. Lo que este test cubre es lo otro: que la TRADUCCIÓN esté bien.
 * Generar no es traducir — `substring` es 1-indexado y `slice` 0-indexado, y esa
 * sola diferencia corre todos los locales un dígito sin que nada falle.
 *
 * Mismo patrón y misma lección (#37) que `ventana.paridad.test.db.ts` y
 * `urgencia.paridad.test.db.ts`.
 *
 * ⚠️ Todo se proyecta con `identidadTelefonicaSql` (el LATERAL) y se compara con
 * `mismaIdentidadSql`. Ésa es la forma en que corre en producción, y es la única
 * viable: componer los pasos inline generaba 2,58 MB de SQL y el planner de
 * Postgres tardaba 14 minutos en TRES filas. El motivo está escrito en
 * `identidadSql.ts`.
 */

/**
 * EL BANCO DE NÚMEROS. No es una muestra bonita: son los casos medidos en
 * producción el 11-ago-2026 más un E.164 sintético por país del padrón.
 */
const NUMEROS: readonly string[] = [
  // Países de 9 dígitos locales, que son los que sí pueden chocar entre sí.
  "51987654321", "56987654321", "593987654321", "34987654321", "595987654321",
  // Panamá: 8 dígitos locales, así que su sufijo de 9 arranca adentro del código.
  "51712345678", "50712345678",
  "51997654321", "52997654321", "54997654321",
  // Las dos deformaciones del dato real (292 sufijos colisionados en `leads`).
  "5151987654321", "593593987654321", "5930987654321", "52525987654321",
  // El que NO hay que tocar: empieza con su propio código y es legítimo.
  "51519876543",
  // Locales sueltos, que es como los guarda Cerberus.
  "987654321", "12345678", "9912345678",
  // Heredado de México y Argentina, con y sin.
  "5219912345678", "529912345678", "5491112345678", "541112345678",
  // Degenerados: vacío, basura, cortos, con adornos.
  "", "abc", "123", "12345", "+51 987 654 321", "51-987-654-321", "(502) 1234-5678",
  // Un número por país del padrón, armado con el primer largo declarado.
  ...PAISES.map((p) => p.codigo + "1".repeat(p.largos[0]!)),
];

const VALORES = NUMEROS.map((num) => sql`(${num})`);

/** El banco, proyectado a (local, país) por el LATERAL. */
const CTE_BANCO = sql`
  SELECT v.t AS t, tel.local AS local, tel.pais AS pais
  FROM (VALUES ${sql.join(VALORES, sql`, `)}) AS v(t),
       ${identidadTelefonicaSql("v.t")} AS tel
`;

type FilaClave = { t: string; local: string | null; pais: string | null };
type FilaPar = { a: string; b: string; igual: boolean | null };

describe("paridad SQL ≡ TS de la identidad telefónica", () => {
  test("el local y el país que proyecta el SQL son los que calcula la función pura", async (t) => {
    const db = await baseDePrueba(t);

    const filas = (await db.execute(CTE_BANCO)) as unknown as FilaClave[];
    assert.equal(filas.length, NUMEROS.length, "el banco entero tiene que volver");

    const divergen: string[] = [];
    for (const fila of filas) {
      const esperado = claveTelefono(fila.t);
      // La función pura dice `''` cuando el número no identifica a nadie; el SQL
      // dice NULL, que es lo que hace que un JOIN no una dos filas basura.
      const localSql = fila.local ?? "";
      const paisSql = fila.pais ?? null;
      if (localSql !== esperado.local || paisSql !== esperado.codigoPais) {
        divergen.push(
          `${JSON.stringify(fila.t)}: SQL={local:${JSON.stringify(localSql)}, pais:${JSON.stringify(paisSql)}} ` +
            `TS={local:${JSON.stringify(esperado.local)}, pais:${JSON.stringify(esperado.codigoPais)}}`,
        );
      }
    }

    assert.deepEqual(divergen, [], `el SQL y el TS discrepan en ${divergen.length} números`);
  });

  test("el predicado de JOIN decide lo mismo que `mismaIdentidadTelefonica`, para TODO par", async (t) => {
    const db = await baseDePrueba(t);

    // El producto cartesiano del banco: así ningún par «obvio» queda sin probar,
    // y los que importan —los que comparten sufijo y no son la misma persona—
    // aparecen sin tener que acordarse de listarlos.
    const filas = (await db.execute(sql`
      WITH banco AS (${CTE_BANCO})
      SELECT a.t AS a, b.t AS b,
             ${mismaIdentidadSql("a.local", "a.pais", "b.local", "b.pais")} AS igual
      FROM banco a CROSS JOIN banco b
    `)) as unknown as FilaPar[];

    assert.equal(filas.length, NUMEROS.length ** 2, "el cartesiano entero tiene que volver");

    const divergen: string[] = [];
    for (const fila of filas) {
      // En SQL el predicado puede dar NULL (local NULL de algún lado); para el
      // JOIN, NULL y false son lo mismo: la fila no une.
      const sqlDice = fila.igual === true;
      const tsDice = mismaIdentidadTelefonica(fila.a, fila.b);
      if (sqlDice !== tsDice) {
        divergen.push(
          `(${JSON.stringify(fila.a)}, ${JSON.stringify(fila.b)}): SQL=${sqlDice} TS=${tsDice}`,
        );
      }
    }

    assert.deepEqual(
      divergen.slice(0, 20),
      [],
      `discrepan ${divergen.length} pares de ${filas.length}`,
    );
  });

  test("los pares que comparten sufijo y NO son la misma persona quedan separados EN LA BASE", async (t) => {
    const db = await baseDePrueba(t);

    const filas = (await db.execute(sql`
      WITH banco AS (${CTE_BANCO})
      SELECT a.t AS a, b.t AS b,
             right(regexp_replace(a.t, '[^0-9]', '', 'g'), 9)
               = right(regexp_replace(b.t, '[^0-9]', '', 'g'), 9) AS chocan_por_sufijo,
             ${mismaIdentidadSql("a.local", "a.pais", "b.local", "b.pais")} AS igual_con_la_guarda
      FROM banco a CROSS JOIN banco b
      WHERE a.t <> b.t
        AND right(regexp_replace(a.t, '[^0-9]', '', 'g'), 9)
            = right(regexp_replace(b.t, '[^0-9]', '', 'g'), 9)
        AND length(regexp_replace(a.t, '[^0-9]', '', 'g')) >= 9
    `)) as unknown as { a: string; b: string; chocan_por_sufijo: boolean; igual_con_la_guarda: boolean | null }[];

    // La premisa se afirma acá: si el banco dejara de tener colisiones de sufijo,
    // este test pasaría vacío y no estaría probando nada.
    assert.ok(filas.length > 0, "el banco tiene que contener pares que chocan por sufijo");

    const unidosDeMas = filas.filter(
      (f) => f.igual_con_la_guarda === true && !mismaIdentidadTelefonica(f.a, f.b),
    );
    assert.deepEqual(
      unidosDeMas.map((f) => `${f.a} ↔ ${f.b}`),
      [],
      "estos pares chocan por sufijo y la guarda los dejó unirse igual",
    );
  });

  test("lo que HOY matchea por sufijo y es la misma persona sigue matcheando", async (t) => {
    const db = await baseDePrueba(t);

    // La otra mitad del contrato, y la que más fácil se rompe: la guarda tiene
    // que QUITAR falsos positivos sin agregar falsos negativos. Son los 61
    // aciertos de los buckets 2 y 3 de la medición.
    const mismaPersona: ReadonlyArray<readonly [string, string]> = [
      ["51987654321", "987654321"],
      ["5151987654321", "51987654321"],
      ["5219912345678", "529912345678"],
      ["50212345678", "12345678"],
      ["+51 987 654 321", "51-987-654-321"],
    ];
    const valores = mismaPersona.flatMap(([a, b]) => [sql`(${a})`, sql`(${b})`]);

    const filas = (await db.execute(sql`
      WITH banco AS (
        SELECT v.t AS t, tel.local AS local, tel.pais AS pais
        FROM (VALUES ${sql.join(valores, sql`, `)}) AS v(t),
             ${identidadTelefonicaSql("v.t")} AS tel
      )
      SELECT a.t AS a, b.t AS b,
             ${mismaIdentidadSql("a.local", "a.pais", "b.local", "b.pais")} AS igual
      FROM banco a CROSS JOIN banco b
    `)) as unknown as FilaPar[];

    const porPar = new Map(filas.map((f) => [`${f.a}|${f.b}`, f.igual]));
    for (const [a, b] of mismaPersona) {
      assert.equal(
        porPar.get(`${a}|${b}`),
        true,
        `${a} y ${b} son la misma persona y dejaron de unirse`,
      );
    }
  });
});
