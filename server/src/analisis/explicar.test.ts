import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { explicar, score } from "./explicar.js";
import type { RoasPais } from "./roasPais.js";

/**
 * El copiloto explicable: motor de reglas determinista sobre señales reales.
 * Lo que se protege acá es la HONESTIDAD del consejo, no su redacción.
 */

function fila(p: Partial<RoasPais>): RoasPais {
  return {
    pais: "Perú",
    gastoUsd: 1000,
    ventasUsd: 5000,
    ventas: 40,
    roas: 5,
    accion: "escalar",
    confianza: "alta",
    oportunidadUsd: 1000,
    budgetSharePct: 20,
    ventasSharePct: 30,
    cacVenta: 25,
    ...p,
  };
}

describe("score — la confianza MULTIPLICA, no suma", () => {
  test("un ROAS altísimo con muestra chica NO da score alto (el caso Uruguay)", () => {
    // 641× con confianza baja: si la confianza sumara, esto seguiría dando un número alto y
    // alguien movería plata detrás de ruido estadístico.
    const ruido = score(641, "baja", 1, 1);
    const solido = score(6, "alta", 30, 20);
    assert.ok(ruido < solido, `el ruido (${ruido}) no puede superar al dato sólido (${solido})`);
  });

  test("el score se capa: rendir 20× no vale cinco veces más que rendir 8×", () => {
    assert.equal(score(8, "alta", 10, 10), score(20, "alta", 10, 10));
  });

  test("sin ROAS medible, el score es 0 (no medible ≠ bueno)", () => {
    assert.equal(score(null, "alta", 10, 10), 0);
  });

  test("premia la eficiencia de share: más ventas de las que su gasto haría esperar", () => {
    const eficiente = score(4, "alta", 30, 10); // trae 30% de ventas con 10% del gasto
    const caro = score(4, "alta", 10, 30);
    assert.ok(eficiente > caro);
  });
});

describe("explicar — responde las cuatro preguntas, con sus caveats", () => {
  test("escalar: da el techo y AVISA que la estimación es lineal", () => {
    const e = explicar(fila({ accion: "escalar", oportunidadUsd: 25000 }));
    assert.match(e.recomendacion, /\$25\.000/); // el techo, en plata y con separador de miles
    // El caveat de honestidad no es letra chica: viaja en el texto.
    assert.match(e.quePasaSi, /LINEAL/);
  });

  test("sin_ventas NO dice 'cortá': dice 'revisá la atribución'", () => {
    // Un país que gastó y no vendió puede ser un problema de atribución, no plata perdida.
    // Recomendarle cortar a ciegas es el error caro.
    const e = explicar(fila({ accion: "sin_ventas", ventas: 0, ventasUsd: 0, roas: 0 }));
    assert.match(e.recomendacion, /atribución/i);
    assert.ok(!/cort[aá]/i.test(e.recomendacion));
    assert.ok(e.riesgos.some((r) => /atribución/i.test(r)));
  });

  test("escalar con confianza no-alta agrega el riesgo de escalar a ciegas", () => {
    const e = explicar(fila({ accion: "escalar", confianza: "media" }));
    assert.ok(e.riesgos.some((r) => /pasos chicos/i.test(r)));
  });

  test("marca al país sobrefinanciado: se lleva mucho gasto y trae pocas ventas", () => {
    const e = explicar(fila({ budgetSharePct: 40, ventasSharePct: 10, accion: "recortar", roas: 1.2 }));
    assert.ok(e.riesgos.some((r) => /sobrefinanciado/i.test(r)));
    assert.ok(e.evidencia.some((x) => x.tipo === "warn" && /caro/.test(x.texto)));
  });

  test("observar: no propone mover plata sobre una muestra chica", () => {
    const e = explicar(fila({ accion: "observar", ventas: 2, confianza: "baja", roas: 641 }));
    assert.match(e.recomendacion, /más datos|muestra/i);
    assert.ok(e.score < 40, "un 641× con 2 ventas no puede tener score alto");
  });
});
