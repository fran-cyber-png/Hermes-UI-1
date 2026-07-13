import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { aUsd, type Tasas } from "./tasas.js";

/**
 * La conversión a USD con las tasas del NEGOCIO (tb_moneda). La misma vara para lo que entra
 * (ventas) y lo que sale (pauta), o el ROAS por país compararía peras con manzanas.
 */
describe("aUsd — convertir gasto a USD con la tasa del negocio", () => {
  const tasas: Tasas = new Map([
    ["PEN", 3.49],
    ["BOB", 9.07],
    ["MXN", 17.19],
  ]);

  test("USD se devuelve igual (no se convierte)", () => {
    assert.equal(aUsd(100, "USD", tasas), 100);
  });

  test("moneda local se divide por su tasa", () => {
    assert.equal(aUsd(349, "PEN", tasas), 100); // 349 soles / 3.49
    assert.equal(aUsd(907, "BOB", tasas), 100);
  });

  test("moneda desconocida → null, no se inventa el monto", () => {
    // Sin tasa no hay conversión honesta: meter el número crudo mezclaría monedas en el total.
    assert.equal(aUsd(1000, "ARS", tasas), null);
  });

  test("es indiferente a mayúsculas/espacios", () => {
    assert.equal(aUsd(349, " pen ", tasas), 100);
    assert.equal(aUsd(50, "usd", tasas), 50);
  });
});
