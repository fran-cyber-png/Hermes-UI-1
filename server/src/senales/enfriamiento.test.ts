import test from "node:test";
import assert from "node:assert/strict";
import { evaluarEnfriamiento, umbralDeEnv, UMBRAL_ENFRIAMIENTO_DIAS } from "./enfriamiento.js";

const AHORA = new Date("2026-07-25T12:00:00Z");
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);

test("sin cotización no hay enfriamiento (es otra señal)", () => {
  const r = evaluarEnfriamiento({ cotizadaEn: null, ultimoEntranteEn: haceDias(10), ahora: AHORA });
  assert.equal(r.enfriada, false);
  assert.match(r.motivo, /precio/);
});

test("si contestó después del precio, está viva por más vieja que sea", () => {
  const r = evaluarEnfriamiento({
    cotizadaEn: haceDias(20),
    ultimoEntranteEn: haceDias(19),
    ahora: AHORA,
  });
  assert.equal(r.enfriada, false);
  assert.match(r.motivo, /contest/);
});

test("cotizada hoy, sin respuesta: NO está fría todavía", () => {
  const r = evaluarEnfriamiento({ cotizadaEn: haceDias(0), ultimoEntranteEn: null, ahora: AHORA });
  assert.equal(r.enfriada, false);
  assert.equal(r.diasDeSilencio, 0);
});

test("el día 2 sigue siendo tiempo normal de decisión", () => {
  const r = evaluarEnfriamiento({ cotizadaEn: haceDias(2), ultimoEntranteEn: null, ahora: AHORA });
  assert.equal(r.enfriada, false);
  assert.equal(r.diasDeSilencio, 2);
});

test("al tercer día de silencio, se enfrió", () => {
  const r = evaluarEnfriamiento({ cotizadaEn: haceDias(3), ultimoEntranteEn: null, ahora: AHORA });
  assert.equal(r.enfriada, true);
  assert.equal(r.diasDeSilencio, 3);
  assert.match(r.motivo, /3 días/);
});

test("un entrante ANTERIOR a la cotización no la salva", () => {
  const r = evaluarEnfriamiento({
    cotizadaEn: haceDias(5),
    ultimoEntranteEn: haceDias(6),
    ahora: AHORA,
  });
  assert.equal(r.enfriada, true);
  assert.equal(r.diasDeSilencio, 5);
});

test("el umbral es configurable: con 7 días, una de 5 no está fría", () => {
  const r = evaluarEnfriamiento({
    cotizadaEn: haceDias(5),
    ultimoEntranteEn: null,
    ahora: AHORA,
    umbralDias: 7,
  });
  assert.equal(r.enfriada, false);
});

test("un umbral mal escrito en el .env no apaga ni enloquece la señal", () => {
  assert.equal(umbralDeEnv({}), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "cero" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "0" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "-3" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "2.5" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "999" }), UMBRAL_ENFRIAMIENTO_DIAS);
  assert.equal(umbralDeEnv({ SENALES_DIAS_ENFRIAMIENTO: "7" }), 7);
});
