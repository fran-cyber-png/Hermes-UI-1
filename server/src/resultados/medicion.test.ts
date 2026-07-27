import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  BASES_DE_MEDICION,
  MUESTRA_MINIMA,
  formatearMedicion,
  leGanaClaramente,
  medir,
  muestraInsuficiente,
} from "./medicion.js";

const RESP = "respondio_despues_de" as const;

describe("una proporción no se puede leer sin su muestra", () => {
  test("EL CASO QUE ESTE ARCHIVO EXISTE PARA IMPEDIR: 2/3 no le gana a 180/400", () => {
    const chica = medir(RESP, 2, 3); // 67 %
    const grande = medir(RESP, 180, 400); // 45 %

    assert.ok(chica.tasa! > grande.tasa!, "el porcentaje suelto dice que la chica gana…");
    assert.equal(
      leGanaClaramente(chica, grande),
      false,
      "…y es exactamente el error: con 3 usos no se sabe nada",
    );
    assert.equal(muestraInsuficiente(chica), true, "y el gate lo frena antes de recomendarla");
    assert.equal(muestraInsuficiente(grande), false);
    assert.ok(chica.intervalo!.alto - chica.intervalo!.bajo > 0.5, "la chica abarca medio universo");
    assert.ok(grande.intervalo!.alto - grande.intervalo!.bajo < 0.15, "la grande sí es un número");
  });

  test("n = 0 no es «0 %»: es que no hay dato", () => {
    const m = medir(RESP, 0, 0);
    assert.equal(m.tasa, null);
    assert.equal(m.intervalo, null);
    assert.equal(m.muestraSuficiente, false);
    assert.equal(formatearMedicion(m), "— (0 casos)");
  });

  test("0 de 20 NO es «seguro que es 0 %»: el intervalo sigue teniendo ancho", () => {
    const m = medir(RESP, 0, 20);
    assert.equal(m.tasa, 0);
    assert.ok(
      m.intervalo!.alto > 0.1,
      `con 20 casos el techo sigue siendo alto: ${m.intervalo!.alto}`,
    );
    assert.equal(m.intervalo!.bajo, 0);
  });

  test("20 de 20 tampoco es «seguro que es 100 %»", () => {
    const m = medir(RESP, 20, 20);
    assert.ok(m.intervalo!.bajo < 0.9);
    assert.equal(m.intervalo!.alto, 1);
  });

  test("el intervalo nunca se sale de [0, 1] — la fórmula normal sí lo hace", () => {
    for (const [e, n] of [[1, 100], [0, 3], [3, 3], [99, 100]] as const) {
      const m = medir(RESP, e, n);
      assert.ok(m.intervalo!.bajo >= 0, `${e}/${n} bajo=${m.intervalo!.bajo}`);
      assert.ok(m.intervalo!.alto <= 1, `${e}/${n} alto=${m.intervalo!.alto}`);
    }
  });

  test("con muestras grandes y separadas, sí se puede afirmar que una gana", () => {
    assert.equal(leGanaClaramente(medir(RESP, 300, 400), medir(RESP, 100, 400)), true);
  });

  test("intervalos que se tocan: la respuesta honesta es «todavía no se sabe»", () => {
    assert.equal(leGanaClaramente(medir(RESP, 52, 100), medir(RESP, 48, 100)), false);
  });

  test("el formato SIEMPRE lleva la muestra pegada al porcentaje", () => {
    assert.equal(formatearMedicion(medir(RESP, 180, 400)), "45% (180/400) [40%–50%]");
    assert.equal(formatearMedicion(medir(RESP, 2, 3)), "67% (2/3) [21%–94%] ⚠muestra chica");
  });

  test("Wilson al 95 % coincide con el cálculo a mano (12/20)", () => {
    // Hecho a mano, que es la única forma de que este test valga algo:
    //   p = 0,6 · z² = 3,8415 · denominador = 1 + 3,8415/20 = 1,192075
    //   centro = (0,6 + 3,8415/40) / 1,192075                = 0,583887
    //   margen = 1,96·√(0,6·0,4/20 + 3,8415/6400) / 1,192075  = 0,197310
    //   ⇒ [0,386577 · 0,781197]
    const m = medir(RESP, 12, 20);
    assert.ok(Math.abs(m.intervalo!.bajo - 0.386577) < 0.0005, `bajo=${m.intervalo!.bajo}`);
    assert.ok(Math.abs(m.intervalo!.alto - 0.781197) < 0.0005, `alto=${m.intervalo!.alto}`);
  });

  test("el umbral de la muestra es el declarado, no uno escondido", () => {
    assert.equal(medir(RESP, 0, MUESTRA_MINIMA - 1).muestraSuficiente, false);
    assert.equal(medir(RESP, 0, MUESTRA_MINIMA).muestraSuficiente, true);
  });
});

describe("`n` y `base` son campos del CONTRATO, no buena práctica", () => {
  test("toda medición serializada lleva `n` y `base` — no hay forma de armarla sin ellos", () => {
    // `medir()` es el único constructor y los dos son requeridos, así que esto
    // vale para CUALQUIER medición que salga de este módulo.
    for (const base of BASES_DE_MEDICION) {
      const json = JSON.parse(JSON.stringify(medir(base, 1, 2)));
      assert.equal(json.base, base, "el JSON dice qué se midió");
      assert.equal(json.n, 2, "y sobre cuántos casos");
    }
    // Incluso la vacía, que es donde más tentador sería omitirlos.
    const vacia = JSON.parse(JSON.stringify(medir(RESP, 0, 0)));
    assert.equal(vacia.base, RESP);
    assert.equal(vacia.n, 0);
  });

  test("GUARDARRAÍL: ninguna base puede prometer una causa", () => {
    // La regla del brief, exigible desde el test: si es «respondió después de»,
    // que no se llame «efectividad». Estos números deciden qué se escribe
    // después, así que el vocabulario importa más acá que en ningún otro módulo.
    const PROHIBIDAS = [
      "efectividad",
      "efectivo",
      "conversion",
      "convierte",
      "rendimiento",
      "performance",
      "exito",
      "gana",
      "mejor",
      "causa",
      "impacto",
    ];
    for (const base of BASES_DE_MEDICION) {
      for (const mala of PROHIBIDAS) {
        assert.ok(
          !base.includes(mala),
          `la base «${base}» contiene «${mala}»: eso promete una causa que no medimos`,
        );
      }
      assert.ok(
        base.includes("_despues_de"),
        `la base «${base}» tiene que decir que habla de lo que pasó DESPUÉS`,
      );
    }
  });
});
