import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { creativos } from "./creativos.js";
import type { AdInput, CampaignInput } from "../decisions/detectors.js";
import type { Tasas } from "./tasas.js";

/**
 * El análisis de creativos: agrupa por el post real (story_id), convierte a USD por la moneda de la
 * cuenta, y clasifica eficiente/caro/sin_resultados con un piso de gasto (no se acciona sobre ruido).
 */

const tasas: Tasas = new Map([["PEN", 3.49]]);

function ad(p: Partial<AdInput> & { id: string }): AdInput {
  return {
    name: p.id,
    status: "ACTIVE",
    spend: 0,
    results: null,
    costPerResult: null,
    creative: null,
    ...p,
  };
}

function camp(currency: string, ads: AdInput[]): CampaignInput {
  return {
    id: "c1",
    name: "Campaña",
    status: "ACTIVE",
    spend: 0,
    results: null,
    costPerResult: null,
    accountId: "1",
    accountName: "Cuenta",
    currency,
    adsets: [{ id: "as1", name: "Conjunto", status: "ACTIVE", spend: 0, results: null, costPerResult: null, includedAudiences: [], excludedAudiences: [], ads }],
  };
}

describe("creativos — agrupar por story y convertir a USD", () => {
  test("dos anuncios con el mismo story_id se suman en un creativo", () => {
    const c = camp("USD", [
      ad({ id: "a1", spend: 100, results: 10, creative: { thumbnailUrl: "t", body: "hola", title: null, objectType: "SHARE", storyId: "S1" } }),
      ad({ id: "a2", spend: 50, results: 5, creative: { thumbnailUrl: "t", body: "hola", title: null, objectType: "SHARE", storyId: "S1" } }),
    ]);
    const r = creativos([c], tasas);
    assert.equal(r.length, 1);
    assert.equal(r[0].gastoUsd, 150);
    assert.equal(r[0].resultados, 15);
    assert.equal(r[0].anuncios, 2);
    assert.equal(r[0].costoPorResultadoUsd, 10); // 150 / 15
  });

  test("el gasto se convierte a USD por la moneda de la cuenta", () => {
    const c = camp("PEN", [
      ad({ id: "a1", spend: 349, results: 10, creative: { thumbnailUrl: null, body: "x", title: null, objectType: null, storyId: "S1" } }),
    ]);
    const r = creativos([c], tasas);
    assert.equal(r[0].gastoUsd, 100); // 349 soles / 3.49
  });

  test("moneda sin tasa: el anuncio se descarta, no se falsea el total", () => {
    const c = camp("ARS", [
      ad({ id: "a1", spend: 99999, results: 10, creative: { thumbnailUrl: null, body: "x", title: null, objectType: null, storyId: "S1" } }),
    ]);
    assert.equal(creativos([c], tasas).length, 0);
  });

  test("veredictos: eficiente vs caro vs sin_resultados vs poco_gasto", () => {
    const c = camp("USD", [
      // barato (costo 2) → eficiente frente a la mediana
      ad({ id: "barato", spend: 200, results: 100, creative: { thumbnailUrl: null, body: "a", title: null, objectType: null, storyId: "BARATO" } }),
      // caro (costo 20)
      ad({ id: "caro", spend: 200, results: 10, creative: { thumbnailUrl: null, body: "b", title: null, objectType: null, storyId: "CARO" } }),
      // mediano (costo 10)
      ad({ id: "medio", spend: 200, results: 20, creative: { thumbnailUrl: null, body: "c", title: null, objectType: null, storyId: "MEDIO" } }),
      // gastó y no generó nada
      ad({ id: "cero", spend: 80, results: 0, creative: { thumbnailUrl: null, body: "d", title: null, objectType: null, storyId: "CERO" } }),
      // muy poco gasto → no accionable
      ad({ id: "chico", spend: 5, results: 3, creative: { thumbnailUrl: null, body: "e", title: null, objectType: null, storyId: "CHICO" } }),
    ]);
    const r = creativos([c], tasas);
    const v = (k: string) => r.find((x) => x.clave === k)?.veredicto;
    assert.equal(v("BARATO"), "eficiente");
    assert.equal(v("CARO"), "caro");
    assert.equal(v("CERO"), "sin_resultados");
    assert.equal(v("CHICO"), "poco_gasto");
  });

  test("se ordena por plata (gasto) descendente", () => {
    const c = camp("USD", [
      ad({ id: "chico", spend: 30, results: 3, creative: { thumbnailUrl: null, body: "x", title: null, objectType: null, storyId: "CHICO" } }),
      ad({ id: "grande", spend: 500, results: 50, creative: { thumbnailUrl: null, body: "y", title: null, objectType: null, storyId: "GRANDE" } }),
    ]);
    const r = creativos([c], tasas);
    assert.equal(r[0].clave, "GRANDE");
  });
});
