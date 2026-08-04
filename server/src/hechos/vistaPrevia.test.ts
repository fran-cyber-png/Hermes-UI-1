import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { MOMENTOS_DE_VENTA } from "../sugerencias/estado.js";
import { TOPE_HECHOS, elegirHechos, vistaPreviaPorMomento } from "./elegir.js";
import type { Hecho } from "./catalogo.js";

/**
 * LA VISTA PREVIA NO PUEDE SER UNA SEGUNDA OPINIÓN.
 *
 * La pantalla de edición existe para contestar «¿esto se llega a ver?» —con 27
 * datos cargados y un tope de 3, mirando la lista no se sabe—. El riesgo no es
 * que la vista previa se rompa: es que **acierte casi siempre**. Si dijera «se
 * ve» sobre algo que el panel recorta, la pantalla mentiría y no fallaría nada.
 *
 * Por eso el test de abajo no comprueba un resultado esperado escrito a mano:
 * comprueba que la vista previa **es** `elegirHechos`, momento por momento.
 */

function hecho(clave: string, orden: number, momentos: Hecho["momentos"] = []): Hecho {
  return { clave, rotulo: clave, texto: `texto de ${clave}`, momentos, orden };
}

describe("la vista previa por momento", () => {
  test("es exactamente lo que elige el panel, en cada momento", () => {
    const catalogo = [
      hecho("precio-peru", 100),
      hecho("acceso-un-anio", 2),
      hecho("cuotas", 100, ["cotizada"]),
      hecho("publico-general", 3),
      hecho("quien-certifica", 3),
      hecho("horas-academicas", 4),
      hecho("solo-enfriada", 1, ["enfriada"]),
    ];

    const previa = vistaPreviaPorMomento(catalogo);

    for (const momento of MOMENTOS_DE_VENTA) {
      assert.deepEqual(
        previa[momento],
        elegirHechos(catalogo, momento).map((h) => h.clave),
        `divergió en «${momento}»`,
      );
    }
  });

  test("trae los seis momentos del vocabulario, ni uno más ni uno menos", () => {
    assert.deepEqual(Object.keys(vistaPreviaPorMomento([])).sort(), [...MOMENTOS_DE_VENTA].sort());
  });

  test("ninguna lista supera el tope", () => {
    const catalogo = Array.from({ length: 20 }, (_, i) => hecho(`h${i}`, i));
    for (const claves of Object.values(vistaPreviaPorMomento(catalogo))) {
      assert.ok(claves.length <= TOPE_HECHOS, `salieron ${claves.length}`);
    }
  });

  /**
   * EL CASO QUE MOTIVÓ LA PANTALLA, medido en producción el 4-ago-2026: 21 de
   * 27 datos con `momentos = []` y las 13 frases de plata con `orden = 100` (el
   * default del schema). El resultado es que **el precio no aparece en ningún
   * momento**, y eso mirando la lista no se ve.
   */
  test("reproduce el caso de producción: con orden=100 el precio no entra nunca", () => {
    const catalogo = [
      hecho("acceso-un-anio", 2),
      hecho("publico-general", 3),
      hecho("quien-certifica", 3),
      hecho("horas-academicas", 4),
      hecho("precio-peru", 100),
      hecho("donde-pagar-mexico", 100),
    ];

    const previa = vistaPreviaPorMomento(catalogo);

    for (const momento of MOMENTOS_DE_VENTA) {
      assert.ok(
        !previa[momento].includes("precio-peru"),
        `«precio-peru» no debería llegar a verse en «${momento}» con orden 100`,
      );
    }
    // Y subirlo lo arregla: es la palanca que la pantalla tiene que exponer.
    const conPrecioArriba = catalogo.map((h) => (h.clave === "precio-peru" ? { ...h, orden: 1 } : h));
    assert.ok(vistaPreviaPorMomento(conPrecioArriba).cotizada.includes("precio-peru"));
  });

  test("lo apagado no compite: quien lo llama filtra antes (la ruta lo hace)", () => {
    // `vistaPreviaPorMomento` no sabe de `activo` a propósito — recibe el
    // catálogo ya filtrado, igual que `elegirHechos`. Este test fija el
    // contrato: si le entran apagados, los elige, y por eso la ruta filtra.
    const soloActivos = [hecho("a", 1), hecho("b", 2)];
    assert.deepEqual(vistaPreviaPorMomento(soloActivos).cotizada, ["a", "b"]);
  });
});
