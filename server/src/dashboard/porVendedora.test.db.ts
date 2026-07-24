import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarConversionWa, sembrarEnvioWa } from "../pruebas/sembrar.js";
import { consultarPorVendedora } from "./porVendedora.js";

/**
 * #4: el «hoy» de `porVendedora` (los números de comisión de la vendedora)
 * también cortaba en UTC. Mismo `ahora` en el filo que `series.test.db.ts` —
 * ver ese archivo para el porqué de la fecha elegida.
 */

const AHORA = new Date("2026-07-24T04:00:00Z"); // 2026-07-23 23:00 en Lima.

test("un envío de WhatsApp de la noche de Lima cuenta en «hoy», aunque en UTC ya sea el día siguiente", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarEnvioWa(db, {
    vendedoraId: "gaby",
    estado: "enviado",
    creadoAt: new Date("2026-07-24T02:00:00Z"), // 2026-07-23T21:00 Lima.
  });

  const filas = await consultarPorVendedora(db, AHORA);
  const gaby = filas.find((f) => f.vendedora === "gaby");
  assert.equal(gaby?.mensajes_hoy, 1, "el envío de anoche (Lima) es de HOY, no de mañana");
  assert.equal(gaby?.conversaciones_hoy, 1);
});

test("una venta (conversión) de la noche de Lima cuenta en «hoy»", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarConversionWa(db, {
    vendedoraId: "gaby",
    iniciadaAt: new Date("2026-07-24T03:45:00Z"), // 2026-07-23T22:45 Lima.
  });

  const filas = await consultarPorVendedora(db, AHORA);
  const gaby = filas.find((f) => f.vendedora === "gaby");
  assert.equal(gaby?.ventas_hoy, 1);
});

test("un envío de la madrugada UTC que ya es de MAÑANA en Lima no cuenta como hoy", async (t) => {
  const db = await baseDePrueba(t);

  // 2026-07-24T06:00:00Z = 2026-07-24T01:00 en Lima: para un `ahora` cuyo
  // "hoy" de Lima es el 23, esto ya es del día siguiente — no debería sumar.
  await sembrarEnvioWa(db, {
    vendedoraId: "gaby",
    estado: "enviado",
    creadoAt: new Date("2026-07-24T06:00:00Z"),
  });

  const filas = await consultarPorVendedora(db, AHORA);
  const gaby = filas.find((f) => f.vendedora === "gaby");
  assert.equal(gaby?.mensajes_hoy, 0, "es de mañana en Lima, no de hoy");
});
