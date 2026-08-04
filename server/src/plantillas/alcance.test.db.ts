import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  crearPlantilla,
  editarPlantilla,
  fijarAlcance,
  listarPlantillas,
  obtenerPlantilla,
} from "./repositorio.js";

/**
 * EL CATÁLOGO COMPARTIDO — «ver es del equipo, editar es de la dueña».
 *
 * Desde el 4-ago-2026 cinco personas comparten una línea. Con el catálogo
 * personal de siempre, cada una arrancaba VACÍA y —peor— `aprobarPlantilla`
 * reasigna el dueño, así que la primera que aprobaba una propuesta minada se la
 * llevaba y desaparecía para las otras cuatro.
 *
 * Lo que estos tests protegen es la mitad que no se ve: que compartir para USAR
 * no haya abierto también la puerta a EDITAR. Cinco personas mandando la misma
 * plantilla no rompen nada; cinco reescribiéndola sin historial hacen que un
 * cambio silencioso en la más usada se descubra por el resultado.
 */

const PASOS = [{ orden: 1, texto: "Hola {nombre}", media: null, mediaPendiente: false }];

test("lo PERSONAL sigue siendo invisible para las demás", async (t) => {
  const db = await baseDePrueba(t);
  await crearPlantilla(db, "ana", { nombre: "La de Ana", pasos: PASOS });

  assert.equal((await listarPlantillas(db, "ana")).length, 1);
  assert.equal((await listarPlantillas(db, "beto")).length, 0);
});

test("marcada como del EQUIPO, la ven y la pueden abrir todas", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, "ana", { nombre: "La del equipo", pasos: PASOS });

  assert.equal(await fijarAlcance(db, "ana", p.id, "equipo"), true);
  const deBeto = await listarPlantillas(db, "beto");
  assert.deepEqual(deBeto.map((x) => x.nombre), ["La del equipo"]);
  // Y la puede ABRIR, que es lo que necesita para mandarla.
  assert.ok(await obtenerPlantilla(db, "beto", p.id));
});

/** LA MITAD QUE NO SE VE, y la razón de que `puedeEditar` exista aparte. */
test("compartir para USAR no abre la puerta a EDITAR", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, "ana", { nombre: "La del equipo", pasos: PASOS });
  await fijarAlcance(db, "ana", p.id, "equipo");

  // Beto la ve y la puede mandar…
  assert.ok(await obtenerPlantilla(db, "beto", p.id));
  // …pero no la puede reescribir.
  assert.equal(await editarPlantilla(db, "beto", p.id, { nombre: "Se la robé" }), null);
  // Ana sí.
  const editada = await editarPlantilla(db, "ana", p.id, { nombre: "La de Ana, editada" });
  assert.equal(editada?.nombre, "La de Ana, editada");
});

/**
 * Ni des-compartirla: si esto fuera por visibilidad, cualquiera de las cinco
 * podría hacerla desaparecer de la lista de las otras cuatro sin avisar.
 */
test("tampoco la puede des-compartir quien no es la dueña", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, "ana", { nombre: "La del equipo", pasos: PASOS });
  await fijarAlcance(db, "ana", p.id, "equipo");

  assert.equal(await fijarAlcance(db, "beto", p.id, "personal"), false);
  assert.equal((await listarPlantillas(db, "beto")).length, 1, "sigue compartida");

  assert.equal(await fijarAlcance(db, "ana", p.id, "personal"), true);
  assert.equal((await listarPlantillas(db, "beto")).length, 0);
});

test("el alcance viaja en la lectura: la app puede dibujar quién la comparte", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, "ana", { nombre: "La del equipo", pasos: PASOS });
  await fijarAlcance(db, "ana", p.id, "equipo");

  const [vista] = await listarPlantillas(db, "beto");
  assert.equal(vista!.alcance, "equipo");
  assert.equal(vista!.vendedoraId, "ana", "se sabe de quién es, aunque la mande otra");
});
