import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ETAPAS_CONSULTABLES, ESCALA_ETAPAS, SIN_RESPUESTA } from "../cola/etapaEfectivaSql.js";
import { ETAPAS } from "../gestiones/registrarGestion.js";

/**
 * 🔴 EL HUECO DE LA COSTURA — lo que se puede CONSULTAR no es lo que se puede
 * DECLARAR, y confundirlos ya costó un bug.
 *
 * `GET /api/conversaciones?etapa=` validaba contra `ETAPAS` (la lista de lo que
 * una vendedora puede asentar en `gestiones`). Cuando `sin_respuesta` entró como
 * etapa DERIVADA, esa columna del tablero pasó a responder **400**: el SQL la
 * calculaba bien, el desglose la contaba bien, la pantalla la dibujaba… y al
 * pedir sus tarjetas, error.
 *
 * **No lo vio ningún test con base**, y ése es el punto: todos llaman al seam
 * `consultarCola` directo, salteándose la validación de la ruta. El defecto
 * vivía exactamente en la costura entre las dos, que es donde no miraba nadie.
 *
 * Este test es puro a propósito — no necesita base ni servidor: lo que fija es la
 * RELACIÓN entre las dos listas, que es la invariante que se rompió.
 */

describe("las dos listas de etapas: declarables vs. consultables", () => {
  test("todo lo declarable se puede consultar", () => {
    for (const etapa of ETAPAS) {
      assert.ok(
        ETAPAS_CONSULTABLES.includes(etapa),
        `«${etapa}» se puede declarar pero la ruta la rechazaría`,
      );
    }
  });

  test("🔴 toda etapa que el embudo puede DEVOLVER se puede pedir", () => {
    // La invariante que se rompió: si `etapaEfectiva` puede devolver un valor,
    // el tablero tiene que poder cargar esa columna. Al agregar un peldaño a la
    // escala, este test falla hasta que la ruta lo acepte.
    for (const etapa of [...ESCALA_ETAPAS, "perdido"]) {
      assert.ok(
        ETAPAS_CONSULTABLES.includes(etapa),
        `el embudo puede devolver «${etapa}» y la ruta la rechazaría con un 400`,
      );
    }
  });

  test("`sin_respuesta` se consulta pero NO se declara", () => {
    assert.ok(ETAPAS_CONSULTABLES.includes(SIN_RESPUESTA));
    assert.ok(
      !(ETAPAS as readonly string[]).includes(SIN_RESPUESTA),
      "declarable haría que alguien pueda afirmar «nunca me escribió» sobre quien sí escribió",
    );
  });

  test("no hay consultables de más: cada una la puede devolver el embudo", () => {
    // La otra dirección, para que la lista no se llene de valores muertos que
    // devolverían una columna vacía sin explicación.
    const posibles = new Set([...ESCALA_ETAPAS, "perdido"]);
    for (const etapa of ETAPAS_CONSULTABLES) {
      assert.ok(posibles.has(etapa), `«${etapa}» se puede pedir y el embudo no la devuelve nunca`);
    }
  });
});
