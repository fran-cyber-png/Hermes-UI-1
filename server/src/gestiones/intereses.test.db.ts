import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarInteres } from "../pruebas/sembrar.js";
import { consultarIntereses } from "./intereses.js";

/**
 * EL SQL de /intereses contra una base de verdad (harness #33): que el `orderBy`
 * y la forma con fecha salgan bien end-to-end. La lógica de ordenamiento en sí ya
 * la cubre el test puro hermano; esto confirma el cableado con Postgres.
 *
 * Corre con `npm run test:db` contra la Postgres efímera en 5439 (local, tras
 * `docker compose -f docker-compose.test.yml up -d --wait`, o en CI). El glob puro
 * (`npm test`) NO lo toma. Ver CLAUDE.md §Tests con base.
 */

test("devuelve los intereses ordenados por fecha y con creadoAt (#57)", async (t) => {
  const db = await baseDePrueba(t);
  const clave = "conv:whatsapp:51999:mi";
  // Se registran EN DESORDEN a propósito: el más nuevo primero.
  await sembrarInteres(db, { clave, curso: "OSINT", creadoAt: new Date("2026-07-15T12:00:00Z") });
  await sembrarInteres(db, { clave, curso: "Inteligencia", creadoAt: new Date("2026-07-01T12:00:00Z") });

  const payload = await consultarIntereses(db, [clave]);

  // RETROCOMPAT: la forma plana sigue estando, ahora cronológica.
  assert.deepEqual(payload.intereses[clave], ["Inteligencia", "OSINT"]);

  // NUEVO: cada interés con su fecha, del más viejo al más nuevo.
  const detalle = payload.interesesDetalle[clave];
  assert.equal(detalle.length, 2);
  assert.equal(detalle[0].curso, "Inteligencia");
  assert.equal(detalle[0].creadoAt, "2026-07-01T12:00:00.000Z");
  assert.equal(detalle[1].curso, "OSINT");
  assert.equal(detalle[1].creadoAt, "2026-07-15T12:00:00.000Z");
});

test("un interés nuevo NO pisa el viejo: cursos distintos coexisten (#57)", async (t) => {
  const db = await baseDePrueba(t);
  const clave = "conv:whatsapp:51888:mi";
  await sembrarInteres(db, { clave, curso: "Inteligencia", creadoAt: new Date("2026-07-01T00:00:00Z") });
  await sembrarInteres(db, { clave, curso: "OSINT", creadoAt: new Date("2026-07-08T00:00:00Z") });

  const payload = await consultarIntereses(db, [clave]);
  assert.deepEqual(payload.intereses[clave], ["Inteligencia", "OSINT"]);
});

test("filtra por clave: no trae los intereses de otra conversación", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarInteres(db, { clave: "conv:A", curso: "X", creadoAt: new Date("2026-07-01T00:00:00Z") });
  await sembrarInteres(db, { clave: "conv:B", curso: "Y", creadoAt: new Date("2026-07-02T00:00:00Z") });

  const payload = await consultarIntereses(db, ["conv:A"]);
  assert.deepEqual(Object.keys(payload.intereses), ["conv:A"]);
  assert.deepEqual(payload.intereses["conv:A"], ["X"]);
});
