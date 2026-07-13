import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { hayFatiga, type PuntoSerie } from "./fatiga.js";

/**
 * La fatiga del creativo. Lo que se protege acá es la CONDICIÓN DOBLE: no alcanza con que el CTR
 * baje (mil explicaciones) ni con que la frecuencia suba (idem). Es que suceden LAS DOS.
 */

/** Arma una serie de n días con frecuencia y ctr que evolucionan linealmente. */
function serie(n: number, freq: [number, number], ctr: [number, number]): PuntoSerie[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    const dia = String(i + 1).padStart(2, "0");
    return {
      fecha: `2026-06-${dia}`,
      frecuencia: freq[0] + (freq[1] - freq[0]) * t,
      ctr: ctr[0] + (ctr[1] - ctr[0]) * t,
    };
  });
}

describe("hayFatiga — la frecuencia SUBE y el CTR BAJA (las dos, no una)", () => {
  test("quemado: se le muestra más al mismo público y responde menos", () => {
    assert.equal(hayFatiga(serie(20, [1.2, 3.5], [1.8, 0.6])), true);
  });

  test("NO es fatiga si solo baja el CTR (la frecuencia no subió)", () => {
    // Un CTR que cae con frecuencia estable puede ser estacionalidad, competencia, mil cosas.
    assert.equal(hayFatiga(serie(20, [2.0, 2.0], [1.8, 0.6])), false);
  });

  test("NO es fatiga si solo sube la frecuencia (el CTR aguanta)", () => {
    // Mostrarlo más y que siga funcionando no es fatiga: es un creativo que resiste.
    assert.equal(hayFatiga(serie(20, [1.2, 3.5], [1.5, 1.6])), false);
  });

  test("con menos de 14 días NO se opina: partir a la mitad sería ruido", () => {
    assert.equal(hayFatiga(serie(10, [1.2, 3.5], [1.8, 0.6])), false);
  });

  test("una serie vacía no revienta ni inventa fatiga", () => {
    assert.equal(hayFatiga([]), false);
  });

  test("con datos faltantes (Meta no devolvió frecuencia) no se opina", () => {
    const sinFreq = serie(20, [1, 3], [2, 0.5]).map((p) => ({ ...p, frecuencia: null }));
    assert.equal(hayFatiga(sinFreq), false);
  });
});
