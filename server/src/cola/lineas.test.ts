import { test } from "node:test";
import assert from "node:assert/strict";
import { recorteDeLineas } from "./lineas.js";

const ESCUELA = "51986394450";
const WALTER = "51941654039";
const BOT = "51984429504";

test("sin nada pedido, la cola no se recorta — el comportamiento de siempre", () => {
  assert.deepEqual(recorteDeLineas({}), { lineas: [], sinLineasPropias: false });
});

test("una línea elegida a mano recorta a esa sola", () => {
  assert.deepEqual(recorteDeLineas({ linea: WALTER }), { lineas: [WALTER], sinLineasPropias: false });
});

test("«las mías» recorta a las que el mapa le asigna", () => {
  const r = recorteDeLineas({ misLineas: true, asignadas: [ESCUELA, BOT] });
  assert.deepEqual(r.lineas, [BOT, ESCUELA]); // ordenadas
  assert.equal(r.sinLineasPropias, false);
});

test("SIN líneas asignadas, «las mías» NO recorta nada: se ve todo, y se dice", () => {
  // La decisión que hace que esto sirva o rompa. Si acá devolviera un conjunto
  // vacío que sí filtra, la primera vendedora que se loguee después del deploy
  // abre una cola vacía y lo que ve es «se perdieron las conversaciones».
  // `numero_vendedora` lo puebla Cerberus: un mapa incompleto degrada en «ves de
  // más», nunca en «no ves nada».
  const r = recorteDeLineas({ misLineas: true, asignadas: [] });
  assert.deepEqual(r.lineas, []);
  assert.equal(r.sinLineasPropias, true);
});

test("sin el dato de asignadas (no se pudo leer el mapa) también se ve todo", () => {
  const r = recorteDeLineas({ misLineas: true });
  assert.deepEqual(r.lineas, []);
  assert.equal(r.sinLineasPropias, true);
});

test("la línea elegida a mano le GANA a «las mías»", () => {
  // Tocó «Walter» en el selector: quiere ver Walter aunque Walter no sea suyo.
  // Lo que una persona afirma vale más que lo que una tabla deduce — la misma
  // precedencia del alias por `adId` sobre el título inferido (ADR 0019).
  const r = recorteDeLineas({ linea: WALTER, misLineas: true, asignadas: [ESCUELA] });
  assert.deepEqual(r.lineas, [WALTER]);
  assert.equal(r.sinLineasPropias, false);
});

test("repetidos y espacios no cambian el recorte: el `IN (...)` sale igual", () => {
  const r = recorteDeLineas({ misLineas: true, asignadas: [ESCUELA, ` ${ESCUELA} `, "", WALTER] });
  assert.deepEqual(r.lineas, [WALTER, ESCUELA].sort());
});
