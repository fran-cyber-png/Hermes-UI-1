import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { VIGENCIA_PAREO_MS, esMiPareo, pareoVigente } from "./pareoPropio.js";

const T0 = 1_700_000_000_000;
const DE_ANA = { numero: "51955135507", vendedoraId: "Ana", tocadoEn: T0 } as const;

describe("pareoVigente — el candado caduca solo", () => {
  test("sin candado no hay nada que soltar", () => {
    assert.equal(pareoVigente(null, T0), null);
  });

  test("recién tomado, vigente", () => {
    assert.equal(pareoVigente(DE_ANA, T0), DE_ANA);
  });

  test("justo en el borde todavía vale — el corte es ESTRICTAMENTE mayor", () => {
    assert.equal(pareoVigente(DE_ANA, T0 + VIGENCIA_PAREO_MS), DE_ANA);
  });

  test("🔴 pasada la vigencia se suelta: cerrar el modal no puede bloquear a todas", () => {
    assert.equal(pareoVigente(DE_ANA, T0 + VIGENCIA_PAREO_MS + 1), null);
  });
});

describe("esMiPareo — dueño y vigencia, en una pregunta", () => {
  test("es mío si lo empecé yo y sigue vivo", () => {
    assert.equal(esMiPareo(DE_ANA, "Ana", T0), true);
  });

  test("🔴 normaliza los DOS lados: `Ana` empezó, `ana` vuelve a preguntar", () => {
    // La cicatriz de siempre (Cerberus empuja `Luz`, ella entra como `luz`). Con
    // `!==` exacto, esto daba `expirado` sobre un pareo vivo.
    assert.equal(esMiPareo(DE_ANA, "ana", T0), true);
    assert.equal(esMiPareo(DE_ANA, "  ANA  ", T0), true);
  });

  test("el pareo de otra persona nunca es mío", () => {
    assert.equal(esMiPareo(DE_ANA, "bea", T0), false);
  });

  test("un pareo caducado no es de nadie, ni de quien lo empezó", () => {
    assert.equal(esMiPareo(DE_ANA, "ana", T0 + VIGENCIA_PAREO_MS + 1), false);
  });

  test("sin candado, no es de nadie", () => {
    assert.equal(esMiPareo(null, "ana", T0), false);
  });
});
