import test from "node:test";
import assert from "node:assert/strict";
import { MAX_COLUMNAS, parsearColumnas } from "./columnasPedidas.js";

const ETAPAS = ["interesado", "sin_respuesta", "contactado", "cotizado", "cierre", "perdido"];
const parsear = (crudo: string) => parsearColumnas(crudo, ETAPAS);

test("el tablero de siempre: cinco etapas sin recorte", () => {
  const r = parsear("interesado,sin_respuesta,contactado,cotizado,cierre");
  assert.equal(r.ok, true);
  assert.ok(r.ok);
  assert.deepEqual(
    r.columnas.map((c) => c.etapa),
    ["interesado", "sin_respuesta", "contactado", "cotizado", "cierre"],
  );
  // Sin recorte los cuatro booleanos van en false: es lo que hace que el total
  // de la columna salga del desglose y no cueste una consulta más.
  assert.ok(r.columnas.every((c) => !c.precio && !c.ventana && !c.seguir && !c.seCallo));
});

test("el ORDEN que se pide es el que vuelve: la pantalla lo usa para dibujar", () => {
  const r = parsear("cierre,interesado");
  assert.ok(r.ok);
  assert.deepEqual(r.columnas.map((c) => c.etapa), ["cierre", "interesado"]);
});

test("cada columna trae SU recorte, no uno global", () => {
  const r = parsear("interesado,cotizado:seguir,contactado:ventana");
  assert.ok(r.ok);
  assert.deepEqual(r.columnas[0], {
    etapa: "interesado",
    precio: false,
    ventana: false,
    seguir: false,
    seCallo: false,
  });
  assert.equal(r.columnas[1]?.seguir, true);
  assert.equal(r.columnas[1]?.ventana, false);
  assert.equal(r.columnas[2]?.ventana, true);
  assert.equal(r.columnas[2]?.seguir, false);
});

test("los cuatro recortes se entienden", () => {
  for (const recorte of ["precio", "ventana", "seguir", "seCallo"] as const) {
    const r = parsear(`cotizado:${recorte}`);
    assert.ok(r.ok, `${recorte} tendría que ser válido`);
    assert.equal(r.columnas[0]?.[recorte], true);
  }
});

/**
 * 🔴 EL GRUPO DE GUARDAS QUE JUSTIFICA QUE ESTO SEA UN MÓDULO.
 *
 * Todas contestan lo mismo: **un pedido mal escrito es un 400, nunca un valor
 * que se cae solo**. Un recorte ignorado no deja la pantalla vacía —eso se
 * vería— sino la columna entera bajo un chip que promete 82 tarjetas.
 */
test("una etapa que no existe es un error, no una columna que se cae", () => {
  const r = parsear("interesado,ventas");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.motivo.includes("ventas"));
  // El mensaje enumera a qué sí se puede pedir: un 400 sin la lista obliga a
  // adivinar, y la lista la sabe el server.
  assert.ok(!r.ok && r.motivo.includes("cotizado"));
});

test("un recorte con un dedazo es un error, no la columna entera", () => {
  const r = parsear("cotizado:segir");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.motivo.includes("segir"));
  assert.ok(!r.ok && r.motivo.includes("seguir"));
});

test("la etapa repetida es un error: la segunda pisaría a la primera", () => {
  const r = parsear("cotizado,interesado,cotizado:seguir");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.motivo.includes("dos veces"));
});

test("dos recortes en una columna es un error: el eje es UNO", () => {
  const r = parsear("cotizado:seguir:precio");
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.motivo.includes("uno solo"));
});

test("sin columnas es un error, no un tablero vacío", () => {
  for (const crudo of ["", "   ", ",", ",,"]) {
    const r = parsear(crudo);
    assert.equal(r.ok, false, `«${crudo}» tendría que fallar`);
  }
});

test("hay tope de columnas: cada una es una pasada de la consulta más cara", () => {
  const muchas = Array.from({ length: MAX_COLUMNAS + 1 }, () => "cotizado").join(",");
  const r = parsear(muchas);
  assert.equal(r.ok, false);
  // Cae por el tope, ANTES de la guarda de repetidas: el tope es sobre el
  // trabajo pedido, y contarlo después de validar cada una ya sería tarde.
  assert.ok(!r.ok && r.motivo.includes(String(MAX_COLUMNAS)));
});

test("los espacios alrededor no cambian nada", () => {
  const r = parsear(" interesado , cotizado : seguir ");
  assert.ok(r.ok);
  assert.deepEqual(r.columnas.map((c) => c.etapa), ["interesado", "cotizado"]);
  assert.equal(r.columnas[1]?.seguir, true);
});
