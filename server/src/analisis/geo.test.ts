import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { aUsd, cruzarPorPais, normalizarPais, nombreBonito, type GastoPais, type VentaPais } from "./geo.js";

/**
 * Atribución geográfica, portada de `goberna-dashboard/core/services/geo_report.py`.
 *
 * Las dos decisiones que ellos aprendieron a los golpes, y que acá vienen de fábrica:
 *
 *   1. El gasto se atribuye al país de la AUDIENCIA alcanzada, no al de la cuenta publicitaria.
 *      La cuenta "Perú" gasta ~45% en audiencias no peruanas (targeting pan-LATAM).
 *   2. Las ventas se atribuyen al país del CLIENTE, no al de la sede que registró la venta.
 *
 * El caso documentado: México aparentaba ROAS 1,59 (mal atribuido) → 4,06+ (bien atribuido).
 * Casi recortan el país que en realidad era el mejor.
 */

describe("normalizarPais — unir 'Perú' con 'peru' con 'PERÚ'", () => {
  test("saca tildes y baja a minúsculas", () => {
    assert.equal(normalizarPais("Perú"), normalizarPais("peru"));
    assert.equal(normalizarPais("MÉXICO"), normalizarPais("mexico"));
    assert.equal(normalizarPais("  Bolivia  "), normalizarPais("bolivia"));
  });
  test("países distintos no colisionan", () => {
    assert.notEqual(normalizarPais("Perú"), normalizarPais("Paraguay"));
  });
});

describe("aUsd — normalizar con la tasa CONGELADA de la venta", () => {
  test("usa el radio de la venta, no la tasa de hoy", () => {
    // Cerberus congela el tipo de cambio en cada venta (radio_divisor_usado). Si recalculáramos
    // con la tasa actual, una venta vieja daría un monto distinto al que realmente entró.
    assert.equal(aUsd(1350, 6.9), Math.round((1350 / 6.9) * 100) / 100); // 1350 BOB / 6.9
  });
  test("radio 0 o faltante → no revienta, cae a null", () => {
    // radioMultiplicador=0 es un caso real y recurrente en Cerberus (moneda mal configurada).
    // Un 0 acá haría una división por cero, o peor, multiplicaría por cero en silencio.
    assert.equal(aUsd(100, 0), null);
    assert.equal(aUsd(100, null), null);
  });
  test("USD queda igual (radio 1)", () => {
    assert.equal(aUsd(350, 1), 350);
  });
});

describe("cruzarPorPais — gasto (audiencia) vs ventas (cliente)", () => {
  const gasto: GastoPais[] = [
    { pais: "Perú", gastoUsd: 1000 },
    { pais: "México", gastoUsd: 500 },
    { pais: "Bolivia", gastoUsd: 300 },
  ];
  const ventas: VentaPais[] = [
    { pais: "peru", ventasUsd: 3000, ventas: 20 },
    { pais: "MEXICO", ventasUsd: 2100, ventas: 12 }, // el caso México: bien atribuido = ROAS 4.2
    // Bolivia: gastó pero no registró ventas (posible problema de atribución)
  ];

  test("une por país normalizado — 'peru' con 'Perú', 'MEXICO' con 'México'", () => {
    const r = cruzarPorPais(gasto, ventas);
    const mx = r.find((x) => x.nombre === "México");
    assert.ok(mx, "México aparece");
    assert.equal(mx!.gastoUsd, 500);
    assert.equal(mx!.ventasUsd, 2100);
    // ROAS 4,2 → escalar. Si lo hubiéramos atribuido mal, habría dado ~1,6 → recortar.
    assert.equal(mx!.ventas, 12);
  });

  test("un país con gasto y sin ventas aparece igual (para verlo, no para esconderlo)", () => {
    const r = cruzarPorPais(gasto, ventas);
    const bo = r.find((x) => x.nombre === "Bolivia");
    assert.ok(bo, "Bolivia aparece aunque no tenga ventas atribuidas");
    assert.equal(bo!.gastoUsd, 300);
    assert.equal(bo!.ventasUsd, 0);
  });

  test("no pierde plata: la suma de gasto se conserva", () => {
    const r = cruzarPorPais(gasto, ventas);
    assert.equal(r.reduce((s, x) => s + x.gastoUsd, 0), 1800);
  });

  test('los países a los gritos de Cerberus salen presentables: "CROACIA" → "Croacia"', () => {
    const r = cruzarPorPais([], [{ pais: "CROACIA", ventasUsd: 200, ventas: 2 }]);
    assert.equal(r[0].nombre, "Croacia");
  });

  test('nombreBonito no toca lo que ya está bien ni los códigos: "Perú" y "XX" quedan igual', () => {
    assert.equal(nombreBonito("Perú"), "Perú");
    assert.equal(nombreBonito("XX"), "XX");
    assert.equal(nombreBonito("REPUBLICA DOMINICANA"), "Republica Dominicana");
  });
});
