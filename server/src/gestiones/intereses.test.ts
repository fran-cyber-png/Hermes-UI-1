import { test } from "node:test";
import assert from "node:assert/strict";
import { armarPayloadIntereses } from "./intereses.js";

/**
 * LA FORMA DEL PAYLOAD DE /intereses (#57) — probada PURA (sin base): el orden y
 * la retrocompatibilidad no dependen de Postgres, así que se testean acá directo.
 * El SQL que alimenta esto (el `orderBy`) lo confirma el `*.test.db.ts` hermano.
 */

test("ordena cronológicamente (el más viejo primero) y SUMA la fecha sin quitar la forma plana", () => {
  // Llegan al revés a propósito: el más nuevo primero.
  const payload = armarPayloadIntereses([
    { clave: "conv:1", curso: "OSINT", creadoAt: new Date("2026-07-15T12:00:00Z") },
    { clave: "conv:1", curso: "Inteligencia", creadoAt: new Date("2026-07-01T12:00:00Z") },
  ]);

  // RETROCOMPAT: la forma vieja (clave → string[]) sigue existiendo, ya ordenada.
  assert.deepEqual(payload.intereses["conv:1"], ["Inteligencia", "OSINT"]);

  // NUEVO: la misma lista pero con la fecha de cada interés, en el mismo orden.
  // `productoId`/`sku` viajan SIEMPRE, aunque sean `null`: una clave ausente se
  // leería como «el server es viejo» y un `null` explícito como «no se pudo
  // atar», que son dos cosas distintas para quien precarga el carrito.
  assert.deepEqual(payload.interesesDetalle["conv:1"], [
    { curso: "Inteligencia", creadoAt: "2026-07-01T12:00:00.000Z", productoId: null, sku: null },
    { curso: "OSINT", creadoAt: "2026-07-15T12:00:00.000Z", productoId: null, sku: null },
  ]);
});

test("el producto atado viaja en el detalle — es lo que precarga el carrito", () => {
  const payload = armarPayloadIntereses([
    {
      clave: "conv:1",
      curso: "Diploma Internacional de Inteligencia y Contrainteligencia 26",
      creadoAt: new Date("2026-07-01T12:00:00Z"),
      productoId: "1908",
      sku: "DIPICOT026",
    },
    // Y el de texto libre, al lado, sin producto: la lista mezcla los dos y la
    // UI tiene que poder distinguir cuál es cotizable.
    { clave: "conv:1", curso: "Algo que dijo por teléfono", creadoAt: new Date("2026-07-02T12:00:00Z") },
  ]);

  const [atado, suelto] = payload.interesesDetalle["conv:1"];
  assert.equal(atado.productoId, "1908");
  assert.equal(atado.sku, "DIPICOT026");
  assert.equal(suelto.productoId, null);
  assert.equal(suelto.sku, null);

  // RETROCOMPAT intacta: la forma plana sigue siendo sólo nombres.
  assert.deepEqual(payload.intereses["conv:1"], [
    "Diploma Internacional de Inteligencia y Contrainteligencia 26",
    "Algo que dijo por teléfono",
  ]);
});

test("agrupa por conversación (clave): los intereses de una no se mezclan con los de otra", () => {
  const payload = armarPayloadIntereses([
    { clave: "conv:A", curso: "X", creadoAt: new Date("2026-07-01T00:00:00Z") },
    { clave: "conv:B", curso: "Y", creadoAt: new Date("2026-07-02T00:00:00Z") },
  ]);
  assert.deepEqual(Object.keys(payload.intereses).sort(), ["conv:A", "conv:B"]);
  assert.deepEqual(payload.intereses["conv:A"], ["X"]);
  assert.deepEqual(payload.intereses["conv:B"], ["Y"]);
});

test("acepta la fecha como string ISO, no solo como Date", () => {
  const payload = armarPayloadIntereses([
    { clave: "conv:1", curso: "Inteligencia", creadoAt: "2026-07-01T12:00:00.000Z" },
  ]);
  assert.equal(payload.interesesDetalle["conv:1"][0].creadoAt, "2026-07-01T12:00:00.000Z");
});

test("sin filas devuelve objetos vacíos (no rompe)", () => {
  const payload = armarPayloadIntereses([]);
  assert.deepEqual(payload.intereses, {});
  assert.deepEqual(payload.interesesDetalle, {});
});
