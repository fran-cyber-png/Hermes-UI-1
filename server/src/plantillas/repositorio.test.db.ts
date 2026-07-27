import test from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import {
  aprobarPlantilla,
  archivarPlantilla,
  crearPlantilla,
  editarPlantilla,
  guardarPropuestas,
  listarPlantillas,
  obtenerPlantilla,
  sumarUso,
  type PasoPlantilla,
} from "./repositorio.js";

/**
 * EL CABLEADO de las plantillas contra Postgres de verdad (ADR 0008).
 *
 * Lo que fija: que la SECUENCIA sea una secuencia (orden estable, reemplazo
 * entero), que el estado `propuesta` sobreviva al viaje, que el minado sea
 * idempotente y —lo más importante— que **re-correr el minado nunca pise una
 * plantilla que una persona ya aprobó**.
 */

const V = "vendedora-prueba";
const OTRA = "otra-vendedora";

const paso = (p: Partial<PasoPlantilla> & { orden: number }): PasoPlantilla => ({
  texto: `paso ${p.orden}`,
  media: null,
  mediaPendiente: false,
  ...p,
});

const SECUENCIA = [paso({ orden: 1 }), paso({ orden: 2 }), paso({ orden: 3 })];

test("una plantilla creada a mano nace APROBADA y con sus pasos en orden", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, V, { nombre: "Bienvenida", pasos: SECUENCIA });

  assert.equal(p.estado, "aprobada");
  assert.deepEqual(
    p.pasos.map((x) => x.orden),
    [1, 2, 3],
  );
  assert.equal(p.pasos[1].texto, "paso 2");
});

test("los pasos se renumeran solos: no existe una secuencia con dos pasos 3", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, V, {
    nombre: "Desordenada",
    pasos: [paso({ orden: 7 }), paso({ orden: 9 })],
  });
  assert.deepEqual(
    p.pasos.map((x) => x.orden),
    [1, 2],
  );
});

test("editar reemplaza la secuencia entera, no parchea un paso suelto", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, V, { nombre: "A", pasos: SECUENCIA });

  const editada = await editarPlantilla(db, V, p.id, {
    pasos: [paso({ orden: 1, texto: "nuevo único" })],
  });
  assert.equal(editada?.pasos.length, 1);
  assert.equal(editada?.pasos[0].texto, "nuevo único");
});

test("la plantilla de otra vendedora no se ve, no se edita y no se archiva", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, OTRA, { nombre: "Ajena", pasos: SECUENCIA });

  assert.equal(await obtenerPlantilla(db, V, p.id), null);
  assert.equal(await editarPlantilla(db, V, p.id, { nombre: "mía" }), null);
  assert.equal(await archivarPlantilla(db, V, p.id), false);
  assert.deepEqual(await listarPlantillas(db, V), []);
});

test("archivar la saca de la lista sin borrarla", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, V, { nombre: "A", pasos: SECUENCIA });

  assert.equal(await archivarPlantilla(db, V, p.id), true);
  assert.deepEqual(await listarPlantillas(db, V), []);
  assert.equal(await archivarPlantilla(db, V, p.id), false, "archivar dos veces no vuelve a contar");
});

test("una propuesta minada nace PROPUESTA y con la imagen pendiente marcada", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    {
      nombre: "Flyer y temario",
      respaldo: 415,
      familia: "DIPICOT",
      curso: "Inteligencia y Contrainteligencia",
      pasos: [
        { orden: 1, texto: "DIPLOMA…", conMedia: true, respaldo: 415, cuota: 0.7 },
        { orden: 2, texto: "Temario del diploma", conMedia: true, respaldo: 190, cuota: 0.4 },
      ],
    },
  ]);

  const [p] = await listarPlantillas(db, V);
  assert.equal(p.estado, "propuesta");
  assert.equal(p.origen, "minado");
  assert.equal(p.respaldo, 415);
  assert.equal(p.pasos[0].mediaPendiente, true, "el minado sabe QUE iba imagen, no CUÁL");
  assert.equal(p.pasos[0].media, null);
});

test("re-correr el minado no duplica: reemplaza las propuestas sin aprobar", async (t) => {
  const db = await baseDePrueba(t);
  const propuesta = {
    nombre: "Flyer",
    respaldo: 100,
    familia: null,
    curso: null,
    pasos: [{ orden: 1, texto: "hola", conMedia: false, respaldo: 100, cuota: 1 }],
  };

  await guardarPropuestas(db, V, [propuesta]);
  await guardarPropuestas(db, V, [propuesta]);

  assert.equal((await listarPlantillas(db, V)).length, 1);
});

test("re-correr el minado NUNCA pisa una propuesta que alguien ya aprobó", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    { nombre: "Vieja", respaldo: 10, familia: null, curso: null, pasos: [{ orden: 1, texto: "x", conMedia: false, respaldo: 10, cuota: 1 }] },
  ]);
  const [vieja] = await listarPlantillas(db, V);
  await aprobarPlantilla(db, V, vieja.id, null);

  await guardarPropuestas(db, V, [
    { nombre: "Nueva", respaldo: 20, familia: null, curso: null, pasos: [{ orden: 1, texto: "y", conMedia: false, respaldo: 20, cuota: 1 }] },
  ]);

  const vivas = await listarPlantillas(db, V);
  assert.equal(vivas.length, 2);
  assert.equal(vivas[0].nombre, "Vieja", "la aprobada va primero: es la que se puede mandar");
  assert.equal(vivas[0].estado, "aprobada");
  assert.equal(vivas[1].nombre, "Nueva");
});

test("aprobar es lo único que vuelve enviable una propuesta", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    { nombre: "P", respaldo: 5, familia: null, curso: null, pasos: [{ orden: 1, texto: "x", conMedia: false, respaldo: 5, cuota: 1 }] },
  ]);
  const [p] = await listarPlantillas(db, V);
  assert.equal(p.estado, "propuesta");

  const aprobada = await aprobarPlantilla(db, V, p.id, "DIPICOT");
  assert.equal(aprobada?.estado, "aprobada");
});

test("la lista ordena: aprobadas por uso, después propuestas por respaldo", async (t) => {
  const db = await baseDePrueba(t);
  const a = await crearPlantilla(db, V, { nombre: "Poco usada", pasos: SECUENCIA });
  const b = await crearPlantilla(db, V, { nombre: "Muy usada", pasos: SECUENCIA });
  await sumarUso(db, b.id);
  await sumarUso(db, b.id);
  await sumarUso(db, a.id);
  await guardarPropuestas(db, V, [
    { nombre: "Propuesta", respaldo: 999, familia: null, curso: null, pasos: [{ orden: 1, texto: "x", conMedia: false, respaldo: 9, cuota: 1 }] },
  ]);

  const vivas = await listarPlantillas(db, V);
  assert.deepEqual(
    vivas.map((p) => p.nombre),
    ["Muy usada", "Poco usada", "Propuesta"],
  );
  assert.equal(vivas[0].usos, 2);
});

/**
 * ══ LA REVISIÓN DE PROPUESTAS (26-jul-2026) ═════════════════════════════════
 *
 * El bug en producción: el minado guardó DOS propuestas (418 y 296
 * conversaciones de respaldo) y la app le decía «Todavía no hay secuencias» al
 * dueño, porque la visibilidad estaba atada al `vendedoraId` con el que corrió
 * el script. Invisibles, y sin ninguna forma de aprobarlas desde la app.
 */
test("una propuesta minada la ve CUALQUIER vendedora: no es de nadie hasta que se aprueba", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    {
      nombre: "Flyer del diploma",
      respaldo: 418,
      familia: "DIPICOT",
      curso: "Inteligencia y Contrainteligencia",
      pasos: [{ orden: 1, texto: "DIPLOMA…", conMedia: true, respaldo: 418, cuota: 0.8 }],
    },
  ]);

  const desdeOtra = await listarPlantillas(db, OTRA);
  assert.equal(desdeOtra.length, 1, "la propuesta del equipo se ve desde otra sesión");
  assert.equal(desdeOtra[0].estado, "propuesta");
  assert.equal(desdeOtra[0].familiaCurso, "DIPICOT", "el minado ya infirió el curso");
});

test("una plantilla APROBADA de otra vendedora sigue siendo privada", async (t) => {
  const db = await baseDePrueba(t);
  await crearPlantilla(db, V, { nombre: "Mía", pasos: SECUENCIA });
  assert.deepEqual(await listarPlantillas(db, OTRA), []);
});

test("aprobar la vuelve activa, con su curso, y disponible para sugerir", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    {
      nombre: "Flyer del diploma",
      respaldo: 418,
      familia: "DIPICOT",
      curso: "Inteligencia y Contrainteligencia",
      pasos: [{ orden: 1, texto: "Te comparto la info del diploma", conMedia: false, respaldo: 418, cuota: 0.8 }],
    },
  ]);
  const [propuesta] = await listarPlantillas(db, OTRA);

  const aprobada = await aprobarPlantilla(db, OTRA, propuesta.id, "DIPICOT");

  assert.equal(aprobada?.estado, "aprobada");
  assert.equal(aprobada?.familiaCurso, "DIPICOT");
  // Y ahora es de quien la aprobó: aprobar es hacerse cargo.
  const deQuienAprobo = await listarPlantillas(db, OTRA);
  assert.equal(deQuienAprobo[0].estado, "aprobada");
  assert.deepEqual(await listarPlantillas(db, V), [], "deja de estar en el pozo común");
});

test("aprobar puede CAMBIAR la familia que el minado infirió", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    {
      nombre: "P",
      respaldo: 30,
      familia: "DIPICOT",
      curso: "Inteligencia y Contrainteligencia",
      pasos: [{ orden: 1, texto: "x", conMedia: false, respaldo: 30, cuota: 1 }],
    },
  ]);
  const [p] = await listarPlantillas(db, V);

  const aprobada = await aprobarPlantilla(db, V, p.id, "DIPOSOC");
  assert.equal(aprobada?.familiaCurso, "DIPOSOC");
});

test("descartar una propuesta del equipo se puede: es parte de revisarla", async (t) => {
  const db = await baseDePrueba(t);
  await guardarPropuestas(db, V, [
    {
      nombre: "No sirve",
      respaldo: 25,
      familia: null,
      curso: null,
      pasos: [{ orden: 1, texto: "x", conMedia: false, respaldo: 25, cuota: 1 }],
    },
  ]);
  const [p] = await listarPlantillas(db, OTRA);

  assert.equal(await archivarPlantilla(db, OTRA, p.id), true);
  assert.deepEqual(await listarPlantillas(db, OTRA), []);
  assert.deepEqual(await listarPlantillas(db, V), []);
});

test("un paso con archivo guarda su media y no queda pendiente", async (t) => {
  const db = await baseDePrueba(t);
  const p = await crearPlantilla(db, V, {
    nombre: "Con flyer",
    pasos: [
      {
        orden: 1,
        texto: "Mirá el diploma",
        media: { archivo: "flyer.jpg", mime: "image/jpeg", clase: "imagen", nombre: "flyer.jpg" },
        mediaPendiente: false,
      },
    ],
  });
  assert.equal(p.pasos[0].media?.archivo, "flyer.jpg");
  assert.equal(p.pasos[0].mediaPendiente, false);
});
