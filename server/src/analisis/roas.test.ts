import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { clasificar, confianza, oportunidadUsd, safeDiv, type Segmento } from "./roas.js";

/**
 * El cerebro de decisiones de pauta, portado de `goberna-dashboard/core/services/roas_analysis.py`.
 *
 * No lo reinventamos: lo copiamos, porque es criterio humano sedimentado en producción. Los casos
 * de prueba son los REALES que ellos bakearon en sus tests — sobre todo Uruguay, que con $0,56 de
 * gasto y una venta de suerte daba ROAS 641× y el sistema decía "escalar". El umbral de volumen
 * mínimo nació de ese incidente.
 *
 * Diferencia con el dashboard: allá el ROAS bueno vive solo en una rama sin pushear, y producción
 * corre uno sin umbrales que MIENTE ($1,50 de gasto → badge verde 50×). Acá está desde el día uno.
 */

function seg(sobre: Partial<Segmento> = {}): Segmento {
  return { nombre: "Perú", gastoUsd: 500, ventasUsd: 2000, ventas: 20, ...sobre };
}

describe("safeDiv — nunca inventa un número", () => {
  test("divide normal", () => {
    assert.equal(safeDiv(10, 2), 5);
  });
  test("denominador cero → null, NO cero", () => {
    // Un ROAS de "0" y un ROAS de "no medible" son cosas distintas. Confundirlos es el bug del
    // dashboard: gasto=0 → utilidad=ventas → badge verde de 100% de margen.
    assert.equal(safeDiv(10, 0), null);
    assert.equal(safeDiv(0, 0), null);
  });
});

describe("clasificar — escalar / recortar / mantener / observar", () => {
  test("ROAS alto y volumen suficiente → escalar", () => {
    assert.equal(clasificar(seg({ gastoUsd: 1000, ventasUsd: 5000, ventas: 40 })), "escalar");
  });

  test("ROAS bajo y volumen suficiente → recortar", () => {
    assert.equal(clasificar(seg({ gastoUsd: 1000, ventasUsd: 1500, ventas: 40 })), "recortar");
  });

  test("ROAS medio → mantener", () => {
    assert.equal(clasificar(seg({ gastoUsd: 1000, ventasUsd: 3000, ventas: 40 })), "mantener");
  });

  test("EL CASO URUGUAY: ROAS espectacular pero volumen ínfimo → observar, NUNCA escalar", () => {
    // $0,56 de gasto, 4 ventas → ROAS 641×. El sistema NO debe decir "escalá presupuesto" hacia
    // ruido estadístico. Es el incidente real que creó el umbral (commit 5240ec9).
    assert.equal(clasificar(seg({ gastoUsd: 0.56, ventasUsd: 359, ventas: 4 })), "observar");
  });

  test("gasto sin ventas → sin_ventas (posible problema de atribución, no 'recortá')", () => {
    // Podría ser que sí vende pero la venta no está atribuida (el eterno problema del origen
    // manual). No decimos "recortar" a ciegas.
    assert.equal(clasificar(seg({ gastoUsd: 500, ventasUsd: 0, ventas: 0 })), "sin_ventas");
  });

  test("ventas sin gasto → sin_gasto (demanda orgánica)", () => {
    assert.equal(clasificar(seg({ gastoUsd: 0, ventasUsd: 2000, ventas: 20 })), "sin_gasto");
  });
});

describe("confianza — cuánto podemos creerle al número", () => {
  test("mucho volumen → alta", () => {
    assert.equal(confianza(30, 500), "alta");
  });
  test("volumen medio → media", () => {
    assert.equal(confianza(5, 100), "media");
  });
  test("EL CASO URUGUAY: 4 ventas → baja", () => {
    assert.equal(confianza(4, 1), "baja");
  });
});

describe("oportunidadUsd — priorizar por PLATA, no por ROAS", () => {
  test("un país con ROAS 8 pero $20 de gasto importa MENOS que uno con ROAS 3 y $5000", () => {
    // Sin esto se rankea por ROAS crudo y se persigue el ratio lindo de bajo volumen.
    const chico = oportunidadUsd(seg({ gastoUsd: 20, ventasUsd: 160, ventas: 2 }));
    const grande = oportunidadUsd(seg({ gastoUsd: 5000, ventasUsd: 15000, ventas: 100 }));
    assert.ok(grande > chico, "el de más plata en juego pesa más");
  });
});
