import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADOS_COMPRA,
  NUNCA_FUE_COMPRA,
  SE_ARREPINTIO,
  esCobrada,
  estadoDe,
  semanticaDe,
} from "./estadosVenta.js";

/**
 * Estos tests son la defensa permanente contra el bug que originó este módulo.
 *
 * `cq-ventas-002` del CQ Engine afirmaba, con confianza 0.98 y marcada como crítica, que los
 * estados eran "1=vendido, 2=señado, 3=confirmado, 4=en_curso, 5=retirado, 6=suspendido,
 * 7=anulado". Todos los mapeos estaban mal, y esa falsedad era exportable como dataset de LoRA
 * (`goberna-kos/src/producers/lora-producer.ts:24-33`) para el modelo que decide qué ve Meta.
 *
 * Si alguien vuelve a escribir esa versión, estos tests tienen que ponerse rojos.
 */
describe("estadosVenta — el mapa contra la data real de Cerberus", () => {
  test("4 es Anulado, NO 'en_curso' (la mentira de cq-ventas-002)", () => {
    assert.equal(estadoDe(4)?.nombre, "Anulado");
    assert.equal(semanticaDe(4), "anulada");
    assert.notEqual(estadoDe(4)?.nombre, "en_curso");
  });

  test("5 es Cotización, NO 'retirado'", () => {
    assert.equal(estadoDe(5)?.nombre, "Cotización");
    assert.equal(semanticaDe(5), "anulada");
  });

  test("7 es Retirado, NO 'anulado'", () => {
    assert.equal(estadoDe(7)?.nombre, "Retirado");
    assert.equal(semanticaDe(7), "reembolsada");
  });

  test("el 8 existe: la doc de Cerberus lo omite, los datos lo tienen (18 ventas)", () => {
    assert.equal(estadoDe(8)?.nombre, "Reembolsado");
    assert.equal(estadoDe(8)?.observado, true);
  });

  test("el 9 se mapea pero NO está observado: no es un hecho, es defensa", () => {
    assert.equal(estadoDe(9)?.semantica, "cobrada");
    assert.equal(estadoDe(9)?.observado, false);
  });

  test("los 8 estados observados son exactamente los que están en los datos (1..8)", () => {
    const observados = ESTADOS_COMPRA.filter((e) => e.observado).map((e) => e.codigo);
    assert.deepEqual(observados, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("cada código aparece una sola vez", () => {
    const codigos = ESTADOS_COMPRA.map((e) => e.codigo);
    assert.equal(new Set(codigos).size, codigos.length);
  });
});

describe("estadosVenta — la semántica que usa el resto del sistema", () => {
  test("cobrada: 1 (Pagado) y 9 (por crédito)", () => {
    assert.equal(esCobrada(1), true);
    assert.equal(esCobrada(9), true);
    assert.equal(esCobrada(2), false);
  });

  test("2 (Pendiente) es en_proceso: en cuotas, cobrándose", () => {
    assert.equal(semanticaDe(2), "en_proceso");
  });

  test("3 (No Validado) y 6 (Preventa) caen en 'otro'", () => {
    assert.equal(semanticaDe(3), "otro");
    assert.equal(semanticaDe(6), "otro");
  });

  test("un código desconocido cae en 'otro' en vez de reventar", () => {
    // Cerberus puede agregar un estado mañana sin avisarnos. Perder la clasificación es malo;
    // perder la venta entera con una excepción es peor.
    assert.equal(semanticaDe(99), "otro");
    assert.equal(estadoDe(99), null);
  });

  test("null (venta sin estado) cae en 'otro'", () => {
    assert.equal(semanticaDe(null), "otro");
    assert.equal(estadoDe(null), null);
  });
});

describe("estadosVenta — las reglas del lazo (qué NO se le manda a Meta)", () => {
  test("NUNCA_FUE_COMPRA son 4 y 5: nunca hubo intención de comprar", () => {
    assert.deepEqual([...NUNCA_FUE_COMPRA].sort(), [4, 5]);
  });

  test("SE_ARREPINTIO son 7 y 8: compró y se arrepintió", () => {
    assert.deepEqual([...SE_ARREPINTIO].sort(), [7, 8]);
  });

  test("los dos conjuntos no se solapan: un estado no puede ser ambas cosas", () => {
    const solape = [...NUNCA_FUE_COMPRA].filter((c) => SE_ARREPINTIO.has(c));
    assert.deepEqual(solape, []);
  });

  test("ningún estado descartado por el lazo cuenta como cobrado", () => {
    // Si esto se rompe, le estaríamos diciendo a Meta que una venta anulada fue una compra.
    for (const codigo of [...NUNCA_FUE_COMPRA, ...SE_ARREPINTIO]) {
      assert.equal(esCobrada(codigo), false, `el estado ${codigo} no puede ser cobrado`);
    }
  });
});
