import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PROPOSITO_CAMPANA } from "../numeros/campana.js";
import { MODULOS, SUPERFICIES, moduloDe } from "./modulo.js";

describe("de qué módulo es una persona", () => {
  test("quien atiende una línea de campaña es de campaña", () => {
    assert.equal(moduloDe([{ proposito: PROPOSITO_CAMPANA }]), "campana");
  });

  test("con una línea de campaña entre varias, es de campaña", () => {
    // Hasta el 15-ago-2026 `usuario2` atendía la campaña Y la Escuela. Que ese
    // caso no exista hoy en los datos no lo hace imposible mañana, y la
    // respuesta segura es la restrictiva.
    assert.equal(
      moduloDe([{ proposito: "vendedora" }, { proposito: PROPOSITO_CAMPANA }]),
      "campana",
    );
  });

  test("las líneas de la Escuela son ventas, con cualquiera de sus dos propósitos", () => {
    // En producción conviven `escuela` y `vendedora`, que significan lo mismo.
    assert.equal(moduloDe([{ proposito: "escuela" }]), "ventas");
    assert.equal(moduloDe([{ proposito: "vendedora" }]), "ventas");
  });

  test("⚠️ sin líneas es ventas — el default INSEGURO, y quien lo sostiene es el middleware", () => {
    // Está escrito en el módulo: invertirlo le cortaría la Escuela a toda
    // vendedora nueva mientras Cerberus todavía no empujó su número. Lo que
    // falla cerrado es la LECTURA, no la ausencia.
    assert.equal(moduloDe([]), "ventas");
    assert.equal(moduloDe(undefined), "ventas");
  });

  test("un propósito nuevo no inventa un módulo: cae en ventas", () => {
    assert.equal(moduloDe([{ proposito: "algo_que_no_existe_todavia" }]), "ventas");
  });
});

describe("la lista de superficies", () => {
  test("toda superficie declara uno de los dos módulos", () => {
    for (const [prefijo, modulo] of Object.entries(SUPERFICIES)) {
      assert.ok(
        (MODULOS as readonly string[]).includes(modulo),
        `«${prefijo}» declara «${modulo}», que no es un módulo`,
      );
    }
  });

  test("todo prefijo empieza con /api/ y no termina en barra", () => {
    // La barra del final rompería el `startsWith` de `moduloDeLaSuperficie`, que
    // la agrega él. Un `/api/notas/` declarado no matchearía `/api/notas`.
    for (const prefijo of Object.keys(SUPERFICIES)) {
      assert.ok(prefijo.startsWith("/api/"), `«${prefijo}» no está bajo /api/`);
      assert.ok(!prefijo.endsWith("/"), `«${prefijo}» termina en barra`);
    }
  });
});
