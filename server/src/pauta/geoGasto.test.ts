import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { paisDesdeIso } from "./geoGasto.js";

/**
 * El caso de la respuesta de Ivi del 2026-07-16: "PT y UNKNOWN tienen ROAS cero" —
 * códigos ISO sin mapear y el UNKNOWN de Meta pasaban crudos hasta la prosa del modelo.
 */
describe("paisDesdeIso — códigos de Meta a nombres de Cerberus", () => {
  test("mapea los códigos que aparecieron en la respuesta (PT, BE, CH, HR)", () => {
    assert.equal(paisDesdeIso("PT"), "Portugal");
    assert.equal(paisDesdeIso("BE"), "Bélgica");
    assert.equal(paisDesdeIso("CH"), "Suiza");
    assert.equal(paisDesdeIso("HR"), "Croacia");
  });

  test('UNKNOWN de Meta va al balde "Sin país" (que el ROAS ya excluye), no a la respuesta', () => {
    assert.equal(paisDesdeIso("UNKNOWN"), "Sin país");
    assert.equal(paisDesdeIso(""), "Sin país");
  });

  test("un código no mapeado se muestra crudo: visible para agregarlo, no escondido", () => {
    assert.equal(paisDesdeIso("XK"), "XK");
  });

  test("es case-insensitive y tolera espacios (Meta no siempre es prolijo)", () => {
    assert.equal(paisDesdeIso(" pe "), "Perú");
  });
});
