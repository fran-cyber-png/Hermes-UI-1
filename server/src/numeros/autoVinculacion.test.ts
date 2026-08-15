import { test } from "node:test";
import assert from "node:assert/strict";
import { puedeAutoVincular } from "./autoVinculacion.js";

const SIN_SUPERVISORES = {} as NodeJS.ProcessEnv;
const CON_ANA_SUPERVISORA = { HERMES_SUPERVISORES: "ana" } as NodeJS.ProcessEnv;

test("puedeAutoVincular: una vendedora sin línea y sin ser supervisora, puede", () => {
  assert.deepEqual(puedeAutoVincular("luz", SIN_SUPERVISORES, []), { ok: true });
});

test("puedeAutoVincular: una supervisora NO puede, tenga o no línea", () => {
  assert.deepEqual(puedeAutoVincular("ana", CON_ANA_SUPERVISORA, []), {
    ok: false,
    motivo: "es_supervisor",
  });
});

test("puedeAutoVincular: normaliza los DOS lados, como el resto del reparto", () => {
  // Cerberus empuja `Ana`, ella entra escribiendo `ana`: sigue siendo supervisora.
  assert.deepEqual(
    puedeAutoVincular("ANA", { HERMES_SUPERVISORES: "ana" } as NodeJS.ProcessEnv, []),
    { ok: false, motivo: "es_supervisor" },
  );
});

test("puedeAutoVincular: quien ya tiene una línea no puede traer otra — 'solo 1'", () => {
  assert.deepEqual(puedeAutoVincular("luz", SIN_SUPERVISORES, ["51987654321"]), {
    ok: false,
    motivo: "ya_tiene_linea",
  });
});

test("puedeAutoVincular: sin HERMES_SUPERVISORES configurado, nadie es supervisor (fail-closed heredado)", () => {
  assert.deepEqual(puedeAutoVincular("cualquiera", SIN_SUPERVISORES, []), { ok: true });
});
