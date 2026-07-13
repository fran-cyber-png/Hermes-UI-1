import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { evaluarFatiga, hayFatiga, type PuntoSerie } from "./fatiga.js";

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

describe("el umbral mínimo de efecto — sin esto, 1 de cada 4 creativos sanos daba QUEMADO", () => {
  test("EL FALSO POSITIVO: una diferencia infinitesimal NO es fatiga", () => {
    // La condición era `freqFin > freqIni && ctrFin < ctrIni`: CUALQUIER diferencia, por chica que
    // fuera, marcaba el creativo. Frecuencia 1,2000 → 1,2001 y CTR 2,5000 → 2,4999 daba «quemado».
    // Como las dos comparaciones son casi simétricas, un creativo PERFECTAMENTE ESTABLE daba
    // positivo por puro ruido ~25% de las veces. Pausar un creativo sano cuesta plata.
    const ruido = serie(20, [1.2, 1.2001], [2.5, 2.4999]);
    assert.equal(hayFatiga(ruido), false, "eso es ruido de medición, no un creativo agotado");
  });

  test("una caída de CTR real pero SIN que suba la frecuencia sigue sin ser fatiga", () => {
    assert.equal(hayFatiga(serie(20, [2.0, 2.0], [3.0, 1.5])), false);
  });

  test("la frecuencia sube fuerte pero el CTR apenas se mueve → no alcanza", () => {
    // −2% de CTR no es un creativo quemado: es una semana con menos suerte.
    assert.equal(hayFatiga(serie(20, [1.0, 2.0], [2.0, 1.96])), false);
  });

  test("el veredicto viene con su EVIDENCIA: cuánto cayó el CTR y cuánto subió la frecuencia", () => {
    // «Quemado» sin números es un sello sin respaldo — y detrás de ese sello alguien pausa un anuncio.
    const f = evaluarFatiga(serie(20, [1.0, 3.0], [4.0, 1.0]));
    assert.ok(f, "con 20 días de datos hay veredicto");
    assert.equal(f.quemado, true);
    assert.ok(f.deltaCtr < -0.15, `el CTR cayó ${Math.round(f.deltaCtr * 100)}%`);
    assert.ok(f.deltaFrecuencia > 0.1, `la frecuencia subió ${Math.round(f.deltaFrecuencia * 100)}%`);
  });

  test("'no lo sé' es null, no 'está sano'", () => {
    // Una serie corta no es un creativo saludable: es un creativo sobre el que no se puede opinar.
    assert.equal(evaluarFatiga(serie(10, [1.2, 3.5], [1.8, 0.6])), null);
    assert.equal(evaluarFatiga([]), null);
  });
});
