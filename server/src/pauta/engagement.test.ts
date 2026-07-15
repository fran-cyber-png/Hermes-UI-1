import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { extraerEngagement } from "./engagement.js";

describe("extraerEngagement — el engagement vive adentro de `actions`, no en campos sueltos", () => {
  test("lee cada action_type en su propio campo", () => {
    const actions = [
      { action_type: "post_reaction", value: "120" },
      { action_type: "comment", value: "8" },
      { action_type: "post", value: "3" },
      { action_type: "onsite_conversion.post_save", value: "15" },
      { action_type: "lead", value: "42" },
      { action_type: "link_click", value: "999" }, // ruido: no debe contaminar nada
    ];
    assert.deepEqual(extraerEngagement(actions), {
      reacciones: 120,
      comentarios: 8,
      compartidos: 3,
      guardados: 15,
      leads: 42,
    });
  });

  test("sin esa acción en la ventana, el campo es null (no cero: cero sería inventar un dato)", () => {
    const actions = [{ action_type: "post_reaction", value: "5" }];
    const r = extraerEngagement(actions);
    assert.equal(r.reacciones, 5);
    assert.equal(r.comentarios, null);
    assert.equal(r.leads, null);
  });

  test("sin `actions` (undefined) no revienta: todo null", () => {
    assert.deepEqual(extraerEngagement(undefined), {
      reacciones: null,
      comentarios: null,
      compartidos: null,
      guardados: null,
      leads: null,
    });
  });

  test("un `actions` que no es arreglo (malformado) tampoco revienta", () => {
    assert.deepEqual(extraerEngagement({ oops: true }), {
      reacciones: null,
      comentarios: null,
      compartidos: null,
      guardados: null,
      leads: null,
    });
  });

  test("un value no numérico cae a null en vez de NaN", () => {
    const r = extraerEngagement([{ action_type: "comment", value: "no-es-numero" }]);
    assert.equal(r.comentarios, null);
  });
});
