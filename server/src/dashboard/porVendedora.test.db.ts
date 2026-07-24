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

test("envíos Y ventas de la MISMA vendedora no se multiplican entre sí (producto cartesiano)", async (t) => {
  const db = await baseDePrueba(t);

  // 2 envíos (a teléfonos distintos) + 3 ventas, todos "hoy" (Lima) para
  // `gaby`. Con el JOIN crudo viejo (envíos × ventas por vendedora_id, sin
  // pre-agregar) esto daba 2×3 = 6 filas ANTES de contar: `mensajes_hoy`
  // (`count(e.*)`, sin DISTINCT) reportaba 6 en vez de 2. Los números exactos
  // de este test tienen que romper si ese cartesiano vuelve.
  await sembrarEnvioWa(db, {
    vendedoraId: "gaby",
    telefono: "51900000001",
    estado: "enviado",
    creadoAt: new Date("2026-07-24T01:00:00Z"), // 2026-07-23T20:00 Lima — hoy.
  });
  await sembrarEnvioWa(db, {
    vendedoraId: "gaby",
    telefono: "51900000002",
    estado: "enviado",
    creadoAt: new Date("2026-07-24T02:00:00Z"), // 2026-07-23T21:00 Lima — hoy.
  });
  await sembrarConversionWa(db, { vendedoraId: "gaby", iniciadaAt: new Date("2026-07-24T00:30:00Z") });
  await sembrarConversionWa(db, { vendedoraId: "gaby", iniciadaAt: new Date("2026-07-24T02:30:00Z") });
  await sembrarConversionWa(db, { vendedoraId: "gaby", iniciadaAt: new Date("2026-07-24T03:30:00Z") });

  const filas = await consultarPorVendedora(db, AHORA);
  const gaby = filas.find((f) => f.vendedora === "gaby");

  assert.equal(gaby?.mensajes_hoy, 2, "2 envíos — NO 2×3 (el cartesiano con ventas)");
  assert.equal(gaby?.conversaciones_hoy, 2, "2 teléfonos distintos");
  assert.equal(gaby?.ventas_hoy, 3, "3 ventas — NO 3×2 (el cartesiano con envíos)");
  // `mensajes_7d`/`ventas_7d` NO se asertan acá a propósito: ese filtro
  // compara contra el `now()` REAL de Postgres (ventana rodante, ver el
  // comentario del módulo), no contra `AHORA` — atarlo a una fecha fija
  // haría flaky el test según cuándo corra. La corrección de esos dos campos
  // la garantiza la MISMA CTE pre-agregada que ya prueban `mensajes_hoy` y
  // `ventas_hoy` arriba: es el mismo `GROUP BY vendedora_id`, el mismo JOIN
  // 1-a-1, solo cambia el FILTER.
});
