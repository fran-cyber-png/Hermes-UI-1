import { test } from "node:test";
import assert from "node:assert/strict";
import { diaLimaISO, corteDiasAtras, medianocheLima } from "./horaLima.js";

/**
 * EL BUG (#4): el server corre en UTC, el negocio vive en Lima (UTC-5, sin
 * horario de verano). Cortar el día con `now()::date` corta en UTC — entre
 * las 19:00 y la medianoche de Lima (00:00–05:00 UTC del día siguiente) un
 * evento de HOY se cuenta como de MAÑANA. Estas pruebas fijan el cálculo
 * puro; `dashboard/series.ts` lo usa para armar el SQL.
 */

test("diaLimaISO: 20:00 en Lima sigue siendo el mismo día, aunque en UTC ya sea el día siguiente", () => {
  // 2026-07-22 20:00 Lima === 2026-07-23 01:00 UTC (Lima = UTC-5).
  const instante = new Date("2026-07-23T01:00:00Z");
  assert.equal(diaLimaISO(instante), "2026-07-22");
});

test("diaLimaISO: a la 01:00 Lima (06:00 UTC) ya cruzó a hoy", () => {
  const instante = new Date("2026-07-23T06:00:00Z");
  assert.equal(diaLimaISO(instante), "2026-07-23");
});

test("diaLimaISO: justo en el filo, 05:00:00 UTC es 00:00:00 Lima (ya es el día nuevo)", () => {
  const instante = new Date("2026-07-23T05:00:00.000Z");
  assert.equal(diaLimaISO(instante), "2026-07-23");
});

test("diaLimaISO: un segundo antes del filo (04:59:59 UTC) todavía es el día de ayer en Lima", () => {
  const instante = new Date("2026-07-23T04:59:59.000Z");
  assert.equal(diaLimaISO(instante), "2026-07-22");
});

test("medianocheLima: la medianoche de un día de Lima es las 05:00 UTC de ese mismo día", () => {
  assert.equal(medianocheLima("2026-07-22").toISOString(), "2026-07-22T05:00:00.000Z");
});

test("corteDiasAtras: 13 días antes de la medianoche de HOY (Lima), con hora exacta", () => {
  // "Ahora" = 2026-07-23 20:00 Lima = 2026-07-24 01:00 UTC.
  const ahora = new Date("2026-07-24T01:00:00Z");
  // Hoy en Lima es 2026-07-23; el corte de 13 días es la medianoche de 2026-07-10 (Lima).
  const corte = corteDiasAtras(ahora, 13);
  assert.equal(corte.toISOString(), "2026-07-10T05:00:00.000Z");
});

test("corteDiasAtras: no se contamina con la hora del día — misma fecha de corte a cualquier hora de 'ahora'", () => {
  const temprano = corteDiasAtras(new Date("2026-07-23T05:30:00Z"), 13); // recién cruzó a hoy en Lima
  const tarde = corteDiasAtras(new Date("2026-07-24T04:59:00Z"), 13); // un minuto antes de cruzar a mañana
  assert.equal(temprano.toISOString(), tarde.toISOString());
});
