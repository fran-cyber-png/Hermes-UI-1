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

  test("ROAS medio (entre stop-loss 2x y piso 3x) → mantener", () => {
    assert.equal(clasificar(seg({ gastoUsd: 1000, ventasUsd: 2500, ventas: 40 })), "mantener");
  });

  test("ROAS en el piso operativo (3x) → escalar (recalibrado para info-product, docs/27)", () => {
    // Antes el corte era 4x (heredado de e-commerce); a margen ~90% el piso es 3x.
    assert.equal(clasificar(seg({ gastoUsd: 1000, ventasUsd: 3000, ventas: 40 })), "escalar");
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
    const chico = oportunidadUsd(seg({ gastoUsd: 20, ventasUsd: 160, ventas: 2 }));      // ROAS 8, $20
    const grande = oportunidadUsd(seg({ gastoUsd: 5000, ventasUsd: 25000, ventas: 100 })); // ROAS 5, $5000
    assert.ok(grande > chico, "el de más plata en juego pesa más");
  });

  // ── LA INVARIANTE QUE FALTABA. Una auditoría encontró que la fórmula era `|objetivo − roas| ×
  //    gasto`, que NO tiene unidades de presupuesto sino de facturación: daba exactamente CUATRO
  //    VECES la cifra correcta, y en `recortar` producía imposibles que la pantalla imprimía como
  //    plata recuperable. ──

  test("NO SE PUEDE DESPERDICIAR MÁS PLATA DE LA QUE SE GASTÓ", () => {
    // El caso que lo delató: $5.000 de gasto, ROAS 0,5. La fórmula vieja decía «$17.500 de
    // desperdicio» sobre un presupuesto de $5.000. Es aritméticamente imposible.
    const s = seg({ gastoUsd: 5000, ventasUsd: 2500, ventas: 20 });
    const opp = oportunidadUsd(s);
    assert.ok(opp <= s.gastoUsd, `el desperdicio ($${opp}) no puede superar el gasto ($${s.gastoUsd})`);
    // Al objetivo de 3×, $2.500 de venta justifican ~$833 de pauta. Sobran ~$4.167.
    assert.equal(Math.round(opp), 4167);
  });

  test("el peor caso posible desperdicia EXACTAMENTE el gasto, ni un dólar más", () => {
    assert.equal(oportunidadUsd(seg({ gastoUsd: 1000, ventasUsd: 0, ventas: 0 })), 1000);
  });

  test("escalar: el margen es cuánto MÁS se puede invertir, no un múltiplo inflado", () => {
    // $5.000 devolviendo $40.000 (8×). Al objetivo de 3×, esas ventas sostienen ~$13.333 de pauta:
    // caben ~$8.333 más.
    assert.equal(Math.round(oportunidadUsd(seg({ gastoUsd: 5000, ventasUsd: 40000, ventas: 50 }))), 8333);
  });

  test("un segmento que rinde JUSTO el objetivo (3×) no tiene plata en juego", () => {
    assert.equal(Math.round(oportunidadUsd(seg({ gastoUsd: 1000, ventasUsd: 3000, ventas: 10 }))), 0);
  });
});
