import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { roasPorPais } from "./roasPais.js";
import type { GastoPais } from "./geo.js";
import type { VentaPaisUsd } from "./ventasPorPais.js";

/**
 * El ROAS real por país: gasto (audiencia) × ventas (cliente), pasado por el cerebro de decisiones.
 * Ordena por PLATA EN JUEGO, no por el ROAS crudo, y no acciona sobre volumen insuficiente.
 */
describe("roasPorPais — cruzar gasto y ventas, decidir con volumen", () => {
  const gasto: GastoPais[] = [
    { pais: "México", gastoUsd: 5000 },
    { pais: "Perú", gastoUsd: 4000 },
    { pais: "Uruguay", gastoUsd: 10 }, // el caso Uruguay: ROAS altísimo, volumen ridículo
  ];
  const ventas: VentaPaisUsd[] = [
    { pais: "México", ventasUsd: 20000, ventas: 120 }, // ROAS 4 → escalar
    { pais: "Perú", ventasUsd: 4000, ventas: 40 }, //     ROAS 1 → recortar
    { pais: "Uruguay", ventasUsd: 6410, ventas: 2 }, //   ROAS 641 pero 2 ventas → observar
  ];

  test("clasifica escalar / recortar / observar según ROAS y volumen", () => {
    const r = roasPorPais(gasto, ventas);
    const find = (p: string) => r.find((x) => x.pais === p)!;
    assert.equal(find("México").accion, "escalar");
    assert.equal(find("Perú").accion, "recortar");
    // El portón de Uruguay: ROAS 641 pero solo 2 ventas y $10 de gasto → NO se acciona.
    assert.equal(find("Uruguay").accion, "observar");
  });

  test("ordena por plata en juego (oportunidad), no por ROAS", () => {
    const r = roasPorPais(gasto, ventas);
    // Uruguay tiene el ROAS más alto pero mueve $10: nunca puede ir primero.
    assert.notEqual(r[0].pais, "Uruguay");
  });

  test("roas es null (no 0) cuando no hay gasto: no medible ≠ cero", () => {
    const r = roasPorPais([], [{ pais: "Chile", ventasUsd: 500, ventas: 4 }]);
    const cl = r.find((x) => x.pais === "Chile")!;
    assert.equal(cl.roas, null);
    assert.equal(cl.accion, "sin_gasto"); // vende sin que le hayamos gastado: demanda orgánica
  });

  test("un país con gasto y sin ventas aparece, para verlo (posible atribución rota)", () => {
    const r = roasPorPais([{ pais: "Bolivia", gastoUsd: 800 }], []);
    const bo = r.find((x) => x.pais === "Bolivia")!;
    assert.equal(bo.ventasUsd, 0);
    assert.equal(bo.accion, "sin_ventas");
  });

  test('"Sin país" se excluye del ROAS: cruzar dos incógnitas no es una decisión', () => {
    // Gasto en audiencia de país desconocido × ventas de clientes sin país resuelto = ruido.
    const r = roasPorPais(
      [{ pais: "Sin país", gastoUsd: 500 }],
      [{ pais: "Sin país", ventasUsd: 9000, ventas: 40 }],
    );
    assert.equal(r.find((x) => x.pais === "Sin país"), undefined);
  });

  test("céntimos que redondean a 0 y cero ventas no producen fila (caso Bélgica USD 0,30)", () => {
    const r = roasPorPais([{ pais: "Bélgica", gastoUsd: 0.3 }], []);
    assert.equal(r.find((x) => x.pais === "Bélgica"), undefined);
  });

  test("ventas sin gasto SÍ queda aunque el gasto sea 0: demanda orgánica es información", () => {
    const r = roasPorPais([], [{ pais: "Uruguay", ventasUsd: 300, ventas: 3 }]);
    assert.notEqual(r.find((x) => x.pais === "Uruguay"), undefined);
  });
});
