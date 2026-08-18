import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLineaDeVendedora } from "../pruebas/sembrar.js";
import {
  esVedadaParaMi,
  sinLineaVedadaSql,
  PROPOSITO_CAMPANA,
  type LineaConDuenas,
} from "./campana.js";

/**
 * EL CANDADO DE LA FRONTERA DE CAMPAÑA — `sinLineaVedadaSql` tiene que decir lo
 * MISMO que `esVedadaParaMi`, que es la definición canónica.
 *
 * Es el patrón de `ventana.paridad.test.db.ts` y `entrega/paridad.test.ts`, y la
 * misma lección (#37): la regla vive dos veces a propósito —pura para poder
 * interrogarla, en SQL porque las cinco consultas que la aplican paginan en la
 * base— y sin un test que corra las dos contra los mismos datos, divergen sin
 * que CI diga nada.
 *
 * 🔴 **Acá divergir falla hacia ABIERTO**: el SQL es el único que corre en
 * producción, y si dice `true` donde la función pura dice «vedada», la
 * conversación de la campaña sale servida y no hay ningún síntoma. Por eso se
 * cruzan TODAS las combinaciones y no un par de casos lindos.
 */

/** Las líneas que se siembran, con lo que la función pura necesita saber de cada una. */
const LINEAS: LineaConDuenas[] = [
  // La de la Escuela: no la veda nadie, ni sin identidad.
  { numero: "51984429504", proposito: "vendedora", vendedoras: ["Luz", "sindy"] },
  // Otro propósito vivo en producción, y tampoco veda.
  { numero: "51986394450", proposito: "escuela", vendedoras: [] },
  // La de campaña, con la grafía que empuja Cerberus.
  { numero: "51963139984", proposito: PROPOSITO_CAMPANA, vendedoras: ["Usuario2", "centurion:betto.romero"] },
  // Una campaña sin dueñas: no es de nadie.
  { numero: "51900000000", proposito: PROPOSITO_CAMPANA, vendedoras: [] },
];

/** Quiénes preguntan. Los tres roles de la vida real más los dos bordes. */
const QUIENES = [
  "usuario2", // la atiende — es la única que la ve
  "betto.romero", // sin el prefijo `centurion:`: NO es la misma cadena
  "centurion:betto.romero", // la identidad federada, tal cual está en la tabla
  "USUARIO2", // la misma persona, otra grafía
  "alex", // supervisor de ventas
  "alan", // admin
  "luz", // vendedora de la Escuela
  undefined, // credencial de servicio: sin identidad
];

/** Lo que no entró por ninguna línea nuestra: comentarios y leads de formulario. */
const SIN_LINEA = [null, ""];

describe("paridad SQL ≡ TS de la frontera de campaña", () => {
  test("para toda línea y toda identidad, el SQL veda exactamente lo que veda la función pura", async (t) => {
    const db = await baseDePrueba(t);
    for (const l of LINEAS) {
      await sembrarLineaDeVendedora(db, l.numero, l.vendedoras, l.proposito);
    }

    for (const yo of QUIENES) {
      const filas = await db.execute<{ numero: string | null; pasa: boolean }>(sql`
        SELECT c.numero, (${sinLineaVedadaSql(sql`c.numero`, yo)}) AS pasa
          FROM (VALUES ${sql.join(
            [...LINEAS.map((l) => l.numero), ...SIN_LINEA].map((n) => sql`(${n}::text)`),
            sql`, `,
          )}) AS c(numero)
      `);

      for (const f of filas) {
        const linea = LINEAS.find((l) => l.numero === f.numero);
        const vedadaEnTs = linea ? esVedadaParaMi(linea, yo) : false;
        assert.equal(
          f.pasa,
          !vedadaEnTs,
          `«${f.numero ?? "(sin línea)"}» para «${yo ?? "(sin identidad)"}»: ` +
            `el SQL ${f.pasa ? "la sirve" : "la veda"} y el TS ${vedadaEnTs ? "la veda" : "la sirve"}`,
        );
      }
    }
  });

  test("🔴 una línea que no está registrada NO se veda — la frontera es de lo declarado", async (t) => {
    const db = await baseDePrueba(t);
    // Sin fila en `numeros_wa` no hay propósito que leer. Vedarla por las dudas
    // escondería tráfico real: medido el 18-ago-2026, `51987654321` tiene dos
    // conversaciones en producción y ninguna fila en el registro.
    const [f] = await db.execute<{ pasa: boolean }>(
      sql`SELECT (${sinLineaVedadaSql(sql`'51987654321'::text`, "alex")}) AS pasa`,
    );
    assert.equal(f?.pasa, true);
  });
});
