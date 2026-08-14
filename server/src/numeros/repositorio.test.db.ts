import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  listarNumeros,
  obtenerNumero,
  upsertNumero,
  desactivarNumero,
  marcarVinculado,
} from "./repositorio.js";

test("upsert crea, y un segundo PUT sobre el mismo número actualiza sin duplicar", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51986394450", {
    etiqueta: "Escuela",
    proposito: "escuela",
    referencia: null,
    activo: true,
    vendedoras: ["ana"],
  });
  let fila = await obtenerNumero(db, "51986394450");
  assert.equal(fila?.etiqueta, "Escuela");
  assert.deepEqual(fila?.vendedoras, ["ana"]);

  await upsertNumero(db, "51986394450", {
    etiqueta: "Escuela principal",
    proposito: "escuela",
    referencia: null,
    activo: true,
    vendedoras: ["ana", "bea"],
  });
  const todas = await listarNumeros(db);
  assert.equal(todas.length, 1, "el mismo número no se duplica");
  fila = await obtenerNumero(db, "51986394450");
  assert.equal(fila?.etiqueta, "Escuela principal");
  assert.deepEqual(fila?.vendedoras, ["ana", "bea"]);
});

test("el set de vendedoras se REEMPLAZA, no se suma (quitar una)", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51900000001", {
    etiqueta: "Campaña",
    proposito: "campana",
    referencia: "ad_1",
    activo: true,
    vendedoras: ["ana", "bea"],
  });
  await upsertNumero(db, "51900000001", {
    etiqueta: "Campaña",
    proposito: "campana",
    referencia: "ad_1",
    activo: true,
    vendedoras: ["bea"],
  });
  const fila = await obtenerNumero(db, "51900000001");
  assert.deepEqual(fila?.vendedoras, ["bea"]);
});

test("desactivar marca activo=false y dice si el número existía", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51900000002", {
    etiqueta: "Y",
    proposito: "escuela",
    referencia: null,
    activo: true,
    vendedoras: [],
  });
  assert.equal(await desactivarNumero(db, "51900000002"), true);
  assert.equal((await obtenerNumero(db, "51900000002"))?.activo, false);
  assert.equal(await desactivarNumero(db, "99999999999"), false, "un número que no existe → false");
});

test("marcarVinculado setea vinculado_at", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51900000003", {
    etiqueta: "Z",
    proposito: "escuela",
    referencia: null,
    activo: true,
    vendedoras: [],
  });
  assert.equal((await obtenerNumero(db, "51900000003"))?.vinculadoAt, null);
  await marcarVinculado(db, "51900000003");
  assert.notEqual((await obtenerNumero(db, "51900000003"))?.vinculadoAt, null);
});

/**
 * 🔴 LOS DOS AGUJEROS DEL PUT DECLARATIVO — encontrados el 14-ago-2026.
 *
 * `PUT /api/admin/numeros/:numero` es declarativo y su dueño es Cerberus. El
 * problema no era el reemplazo: era que **la ausencia de un campo se leía como
 * "poné el default"** y que **el reemplazo alcanzaba a identidades que Cerberus no
 * puede nombrar**. Los dos rompían el aislamiento entre los planos del negocio, en
 * direcciones opuestas y sin un solo síntoma.
 */

test("🔴 un push sin `proposito` NO baja la línea de campaña a escuela", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51963139984", {
    etiqueta: "Betto",
    proposito: "campana",
    referencia: null,
    activo: true,
    vendedoras: [],
  });

  // El push de todos los días de Cerberus: manda SU modelo, que no tiene
  // `proposito` ni `activo` porque son campos que inventó Hermes.
  await upsertNumero(db, "51963139984", {
    etiqueta: "Betto",
    referencia: null,
    vendedoras: ["luz"],
  });

  const fila = await obtenerNumero(db, "51963139984");
  assert.equal(
    fila?.proposito,
    "campana",
    "con `escuela` acá, `soloSusLineas` da false y el comando de campaña ve la cola entera de la Escuela",
  );
  assert.equal(fila?.activo, true, "un `activo` ausente tampoco resucita ni retira una línea");
  assert.equal(fila?.etiqueta, "Betto");
});

test("una fila NUEVA sin `proposito` sí toma el default: no hay nada previo que conservar", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51900000001", { etiqueta: "Nueva", referencia: null, vendedoras: [] });
  const fila = await obtenerNumero(db, "51900000001");
  assert.equal(fila?.proposito, "escuela");
  assert.equal(fila?.activo, true);
});

test("🔴 el push de Cerberus NO borra a una identidad de Centurión de la línea", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51963139984", {
    etiqueta: "Betto",
    proposito: "campana",
    referencia: null,
    activo: true,
    vendedoras: ["luz", "centurion:betto.romero"],
  });
  assert.deepEqual((await obtenerNumero(db, "51963139984"))?.vendedoras, [
    "centurion:betto.romero",
    "luz",
  ]);

  // Cerberus manda su set completo — que jamás va a incluir una identidad de
  // Centurión, porque no la conoce.
  await upsertNumero(db, "51963139984", {
    etiqueta: "Betto",
    referencia: null,
    vendedoras: ["luz", "sindy"],
  });

  const fila = await obtenerNumero(db, "51963139984");
  assert.deepEqual(
    fila?.vendedoras,
    ["centurion:betto.romero", "luz", "sindy"],
    "sin esto, el agente digital pierde su línea y come 403, sin error y sin log",
  );
});

test("y Cerberus SÍ sigue pudiendo sacar a los suyos: el reemplazo de lo propio no se aflojó", async (t) => {
  const db = await baseDePrueba(t);
  await upsertNumero(db, "51963139984", {
    etiqueta: "Betto",
    referencia: null,
    vendedoras: ["luz", "sindy", "centurion:betto.romero"],
  });
  await upsertNumero(db, "51963139984", { etiqueta: "Betto", referencia: null, vendedoras: ["luz"] });

  assert.deepEqual((await obtenerNumero(db, "51963139984"))?.vendedoras, [
    "centurion:betto.romero",
    "luz",
  ]);
});
