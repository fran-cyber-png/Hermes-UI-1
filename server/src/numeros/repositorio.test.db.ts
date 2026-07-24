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
