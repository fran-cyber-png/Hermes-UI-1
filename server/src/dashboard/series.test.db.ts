import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarSeriesDashboard } from "./series.js";

/**
 * #4: las series de 14 días cortaban el día en UTC. Este es el caso
 * reportado: un evento que pasó de noche en Lima, pero que en UTC ya cayó en
 * el día siguiente.
 *
 * `ahora` está elegido A PROPÓSITO con el reloj en el filo: su fecha en UTC
 * (24) es DISTINTA de su fecha en Lima (23). Si algo del código vuelve a
 * mirar `now()::date` o `Date().toISOString().slice(0,10)` sin pasar por
 * Lima, este test lo detecta.
 */

const AHORA = new Date("2026-07-24T04:00:00Z"); // 2026-07-23 23:00 en Lima — todavía "hoy".
const HOY_LIMA = "2026-07-23";

test("un mensaje entrante de la noche de Lima cae en el día de HOY (Lima), no en el de mañana", async (t) => {
  const db = await baseDePrueba(t);

  // 2026-07-24T02:00:00Z = 2026-07-23T21:00 en Lima: de noche, pero sigue siendo el 23.
  await sembrarMensaje(db, {
    personaId: "51900000001",
    texto: "hola, quiero info",
    occurredAt: new Date("2026-07-24T02:00:00Z"),
  });

  const { leads_dia } = await consultarSeriesDashboard(db, AHORA);

  assert.equal(leads_dia.length, 14, "siempre 14 puntos, aunque falten datos");
  assert.equal(leads_dia.at(-1)?.dia, HOY_LIMA, "el último punto es HOY en Lima, no en UTC");

  const hoy = leads_dia.find((p) => p.dia === HOY_LIMA);
  assert.equal(hoy?.chats, 1, "el mensaje de anoche (Lima) cuenta en el bucket de HOY");

  // Ningún punto de la serie es del "día siguiente" en UTC (24): esa fecha no
  // debería existir en absoluto en una ventana que termina en HOY (Lima).
  assert.equal(
    leads_dia.some((p) => p.dia === "2026-07-24"),
    false,
    "el 24 en UTC no es un día del calendario de Lima dentro de esta ventana",
  );
});

test("un comentario de la noche de Lima cae en el día de HOY (Lima)", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarMensaje(db, {
    tipo: "comentario",
    personaId: "51900000002",
    texto: "más información porfa",
    occurredAt: new Date("2026-07-24T03:30:00Z"), // 2026-07-23T22:30 Lima.
  });

  const { leads_dia } = await consultarSeriesDashboard(db, AHORA);
  const hoy = leads_dia.find((p) => p.dia === HOY_LIMA);
  assert.equal(hoy?.comentarios, 1);
});

test("un lead de formulario de la noche de Lima cae en el día de HOY (Lima)", async (t) => {
  const db = await baseDePrueba(t);

  await sembrarLead(db, { createdTime: new Date("2026-07-24T01:15:00Z") }); // 2026-07-23T20:15 Lima.

  const { leads_dia } = await consultarSeriesDashboard(db, AHORA);
  const hoy = leads_dia.find((p) => p.dia === HOY_LIMA);
  assert.equal(hoy?.formularios, 1);
});

test("un mensaje EXACTAMENTE en la medianoche de Lima del día más viejo no se pierde (corte >=, no >)", async (t) => {
  const db = await baseDePrueba(t);

  // `hoy` (Lima) para AHORA es 2026-07-23; el día más viejo de la ventana de
  // 14 puntos es 2026-07-23 − 13 = 2026-07-10, y su medianoche de Lima
  // (00:00:00-05:00) es exactamente 2026-07-10T05:00:00.000Z — el mismo
  // instante que `corteDiasAtras(AHORA, 13)`. Ese instante SÍ pertenece al
  // bucket del 10 (`dias` lo genera igual, a partir de `hoy`, no del corte):
  // con un filtro `>` estricto, este evento desaparecía de una serie que
  // igual mostraba el día del 10 — vacío, mintiendo "no pasó nada" cuando sí.
  await sembrarMensaje(db, {
    personaId: "51900000004",
    occurredAt: new Date("2026-07-10T05:00:00.000Z"),
  });

  const { leads_dia } = await consultarSeriesDashboard(db, AHORA);
  assert.equal(leads_dia[0]?.dia, "2026-07-10", "el primer punto de la serie es el día más viejo");
  assert.equal(leads_dia[0]?.chats, 1, "el evento exactamente en el corte cuenta en su propio día");
});

test("un mensaje de la madrugada UTC (antes del filo de Lima) cae en el día de AYER, no en HOY", async (t) => {
  const db = await baseDePrueba(t);

  // 2026-07-24T03:59:59Z = 2026-07-23T22:59:59 en Lima: sigue siendo AYER
  // relativo a un `ahora` de 2026-07-24T04:00:00Z (que también es 23 en Lima) —
  // así que en este caso puntual cae igual que el anterior. Para separar
  // "ayer" de "hoy" de verdad, `ahora` avanza un día completo.
  const ahoraMasUnDia = new Date("2026-07-25T04:00:00Z"); // 2026-07-24T23:00 Lima ⇒ hoy Lima = 24.
  await sembrarMensaje(db, {
    personaId: "51900000003",
    occurredAt: new Date("2026-07-24T02:00:00Z"), // 2026-07-23T21:00 Lima ⇒ AYER relativo al nuevo hoy.
  });

  const { leads_dia } = await consultarSeriesDashboard(db, ahoraMasUnDia);
  const ayer = leads_dia.find((p) => p.dia === "2026-07-23");
  const hoy = leads_dia.find((p) => p.dia === "2026-07-24");
  assert.equal(ayer?.chats, 1, "el mensaje del 23 (Lima) queda en el bucket del 23, no del 24");
  assert.equal(hoy?.chats ?? 0, 0);
});
