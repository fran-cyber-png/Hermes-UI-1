import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { etapaEfectiva } from "./etapaEfectivaSql.js";

/**
 * LA POLÍTICA DE LA ETAPA EFECTIVA (#88, ADR 0013) — la función pura.
 *
 * Precedencia cerrada por el dueño (2026-07-24):
 *   · derivada = respondida ? contactado : interesado — un PISO que solo sube;
 *   · manual = la última gestión asentada (o null);
 *   · perdido manual es TERMINAL: nada lo resucita solo;
 *   · si no, gana max(manual, derivada) en interesado < contactado < cotizado < cierre.
 *
 * Estos casos son la especificación. La proyección SQL se verifica contra esta
 * misma función en `etapaEfectiva.paridad.test.db.ts` (patrón ADR 0009).
 */

describe("etapa efectiva — la precedencia del dueño", () => {
  test("sin gestión y sin respuesta → interesado (todo lo nuevo cae acá)", () => {
    assert.equal(etapaEfectiva(null, false), "interesado");
  });

  test("sin gestión pero respondida → contactado (contacto = le respondimos)", () => {
    assert.equal(etapaEfectiva(null, true), "contactado");
  });

  test("manual interesado + respondida → contactado (el piso derivado empuja hacia arriba)", () => {
    assert.equal(etapaEfectiva("interesado", true), "contactado");
  });

  test("manual cotizado + no respondida → cotizado (la manual avanzada gana; nada baja)", () => {
    assert.equal(etapaEfectiva("cotizado", false), "cotizado");
  });

  test("manual cotizado + respondida → cotizado (el piso no alcanza a la manual)", () => {
    assert.equal(etapaEfectiva("cotizado", true), "cotizado");
  });

  test("manual contactado + no respondida → contactado (lo asentado no retrocede)", () => {
    assert.equal(etapaEfectiva("contactado", false), "contactado");
  });

  test("manual cierre → cierre, respondida o no (la venta ya se ganó)", () => {
    assert.equal(etapaEfectiva("cierre", false), "cierre");
    assert.equal(etapaEfectiva("cierre", true), "cierre");
  });

  test("perdido es TERMINAL: ni la respondida lo resucita", () => {
    assert.equal(etapaEfectiva("perdido", true), "perdido");
    assert.equal(etapaEfectiva("perdido", false), "perdido");
  });

  test("los valores viejos se normalizan al leer: nuevo→interesado, venta→cierre", () => {
    // 'nuevo' normaliza a interesado, y el piso derivado lo empuja a contactado.
    assert.equal(etapaEfectiva("nuevo", true), "contactado");
    assert.equal(etapaEfectiva("nuevo", false), "interesado");
    assert.equal(etapaEfectiva("venta", false), "cierre");
  });

  test("una etapa manual desconocida no rompe: manda la derivada", () => {
    assert.equal(etapaEfectiva("cualquier-cosa", true), "contactado");
    assert.equal(etapaEfectiva("cualquier-cosa", false), "interesado");
  });
});
