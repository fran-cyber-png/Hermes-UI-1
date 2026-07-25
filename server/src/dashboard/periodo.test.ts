import test from "node:test";
import assert from "node:assert/strict";
import { rangoDePeriodo, rangoLibre, resolverRango, CLAVES_PERIODO } from "./periodo.js";

/**
 * EL PERÍODO DEL PANEL DE NEGOCIO — puro, sin base y sin reloj implícito.
 *
 * Todo se ancla a la MEDIANOCHE DE LIMA (el negocio corta el día allá, #4). Las
 * fechas de referencia de estos tests son instantes UTC elegidos a propósito
 * para caer del otro lado del corte: 2026-07-25T02:00Z son las 21:00 del 24 en
 * Lima — si el corte fuera UTC, «hoy» daría el 25 y todos los rangos se
 * correrían un día.
 */

/** 21:00 del jueves 24-jul-2026 en Lima (02:00Z del 25). */
const NOCHE_DEL_24 = new Date("2026-07-25T02:00:00Z");
/** 09:00 del viernes 25-jul-2026 en Lima. */
const MANANA_DEL_25 = new Date("2026-07-25T14:00:00Z");

test("«hoy» es el día-calendario de Lima, no el de UTC", () => {
  const r = rangoDePeriodo(NOCHE_DEL_24, "hoy");
  assert.equal(r.desde.toISOString(), "2026-07-24T05:00:00.000Z"); // 00:00 Lima del 24
  assert.equal(r.hasta.toISOString(), "2026-07-25T05:00:00.000Z"); // 00:00 Lima del 25
});

test("«hoy» a las 9 de la mañana da el mismo día que a las 9 de la noche", () => {
  const noche = rangoDePeriodo(new Date("2026-07-25T23:00:00Z"), "hoy"); // 18:00 Lima del 25
  const manana = rangoDePeriodo(MANANA_DEL_25, "hoy");
  assert.equal(noche.desde.toISOString(), manana.desde.toISOString());
  assert.equal(noche.hasta.toISOString(), manana.hasta.toISOString());
});

test("«7d» son SIETE días de calendario contando hoy, no siete por 24 horas", () => {
  const r = rangoDePeriodo(MANANA_DEL_25, "7d");
  assert.equal(r.desde.toISOString(), "2026-07-19T05:00:00.000Z"); // 00:00 Lima del 19
  assert.equal(r.hasta.toISOString(), "2026-07-26T05:00:00.000Z"); // 00:00 Lima del 26
  assert.equal((r.hasta.getTime() - r.desde.getTime()) / 86_400_000, 7);
});

test("«30d» y «90d» abarcan exactamente esa cantidad de días", () => {
  for (const [clave, dias] of [
    ["30d", 30],
    ["90d", 90],
  ] as const) {
    const r = rangoDePeriodo(MANANA_DEL_25, clave);
    assert.equal((r.hasta.getTime() - r.desde.getTime()) / 86_400_000, dias, clave);
  }
});

test("todas las claves declaradas producen un rango (nadie queda sin implementar)", () => {
  for (const clave of CLAVES_PERIODO) {
    const r = rangoDePeriodo(MANANA_DEL_25, clave);
    assert.ok(r.desde < r.hasta, `${clave} tiene que ir de menos a más`);
  }
});

test("el rango libre incluye el día final entero (hasta es exclusivo, el día no)", () => {
  const r = rangoLibre("2026-06-01", "2026-06-30");
  assert.ok(r !== null);
  assert.equal(r.desde.toISOString(), "2026-06-01T05:00:00.000Z");
  assert.equal(r.hasta.toISOString(), "2026-07-01T05:00:00.000Z"); // el 30 entero adentro
});

test("un rango libre de un solo día es un día entero", () => {
  const r = rangoLibre("2026-06-15", "2026-06-15");
  assert.ok(r !== null);
  assert.equal((r.hasta.getTime() - r.desde.getTime()) / 86_400_000, 1);
});

test("el rango libre rechaza lo que no es una fecha de calendario", () => {
  assert.equal(rangoLibre("ayer", "hoy"), null);
  assert.equal(rangoLibre("2026-13-01", "2026-13-05"), null);
  assert.equal(rangoLibre("2026-06-01", ""), null);
});

test("el rango libre rechaza el orden invertido (no se adivina la intención)", () => {
  assert.equal(rangoLibre("2026-06-30", "2026-06-01"), null);
});

test("resolverRango prefiere el rango libre cuando vienen las dos fechas", () => {
  const r = resolverRango(MANANA_DEL_25, { periodo: "7d", desde: "2026-06-01", hasta: "2026-06-30" });
  assert.equal(r.clave, "libre");
  assert.equal(r.desde.toISOString(), "2026-06-01T05:00:00.000Z");
});

test("resolverRango cae al preset cuando el rango libre no es usable", () => {
  const r = resolverRango(MANANA_DEL_25, { periodo: "hoy", desde: "no-es-fecha", hasta: "tampoco" });
  assert.equal(r.clave, "hoy");
});

test("resolverRango sin nada usable devuelve 7d — el default de la pantalla", () => {
  assert.equal(resolverRango(MANANA_DEL_25, {}).clave, "7d");
  assert.equal(resolverRango(MANANA_DEL_25, { periodo: "el-mes-pasado" }).clave, "7d");
});
