import { test } from "node:test";
import assert from "node:assert/strict";
import { recorteDeLineas, soloSusLineas, PROPOSITO_CAMPANA } from "./lineas.js";

const ESCUELA = "51986394450";
const WALTER = "51941654039";
const BOT = "51984429504";
const CAMPANA = "51963139984";

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

/**
 * EL RECORTE EXCLUSIVO — quien atiende una campaña no ve la cola de la Escuela.
 *
 * Lo decide el PROPÓSITO de la línea (`numeros_wa.proposito`), no una lista de
 * usuarios a mano: el dato ya existe y no hay una segunda lista que se pueda
 * desincronizar. Lo que estos tests fijan es que quien NO tiene una línea de
 * campaña se comporte exactamente como antes.
 */

test("soloSusLineas: lo prende una línea de campaña, y nada más", () => {
  assert.equal(soloSusLineas([{ proposito: PROPOSITO_CAMPANA }]), true);
  assert.equal(soloSusLineas([{ proposito: "escuela" }, { proposito: PROPOSITO_CAMPANA }]), true);
  assert.equal(soloSusLineas([{ proposito: "escuela" }]), false);
  assert.equal(soloSusLineas([]), false);
  assert.equal(soloSusLineas(undefined), false);
});

test("exclusiva: recorta a las suyas SIN que el cliente pida `?mias=1`", () => {
  // Si dependiera de `mias`, el recorte se apagaría dejando de mandar el
  // parámetro — o sea que no recortaría nada.
  const r = recorteDeLineas({ exclusivas: true, asignadas: [CAMPANA] });
  assert.deepEqual(r.lineas, [CAMPANA]);
  assert.equal(r.sinLineasPropias, false);
});

test("🔴 exclusiva: una `?linea=` AJENA no se sirve — el selector no saltea el recorte", () => {
  // Es la inversión deliberada de la precedencia de abajo: si lo explícito
  // ganara acá, el recorte se esquivaría con un query-param.
  const r = recorteDeLineas({ exclusivas: true, linea: ESCUELA, asignadas: [CAMPANA] });
  assert.deepEqual(r.lineas, [CAMPANA]);
});

test("exclusiva: una `?linea=` PROPIA sí se respeta — elegir entre las suyas", () => {
  const r = recorteDeLineas({ exclusivas: true, linea: CAMPANA, asignadas: [CAMPANA, WALTER] });
  assert.deepEqual(r.lineas, [CAMPANA]);
});

test("exclusiva sin asignadas: fail-open, se sirve todo y se DICE", () => {
  // El mapa lo puebla Cerberus y puede estar incompleto. Una cola vacía se lee
  // como «se perdieron las conversaciones», no como «no tenés líneas».
  const r = recorteDeLineas({ exclusivas: true, asignadas: [] });
  assert.deepEqual(r.lineas, []);
  assert.equal(r.sinLineasPropias, true);
});

test("🔴 sin línea de campaña NADA cambia: la Escuela sigue viendo todo", () => {
  const r = recorteDeLineas({ exclusivas: false, asignadas: [ESCUELA, BOT] });
  assert.deepEqual(r.lineas, []);
  assert.equal(r.sinLineasPropias, false);
});
