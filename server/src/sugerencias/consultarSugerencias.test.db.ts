import test from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarInteres, sembrarMensaje } from "../pruebas/sembrar.js";
import { crearPlantilla } from "../plantillas/repositorio.js";
import { consultarSugerencias } from "./consultarSugerencias.js";

/**
 * EL CABLEADO de las dos respuestas contra Postgres de verdad (ADR 0008).
 *
 * Lo puro ya está fijado (`sugerir.test.ts`): acá se prueba que el ESTADO que
 * se le pasa salga bien de la base — que «primer contacto» sea de verdad cero
 * salientes, que «vio material» mire la media de ESTA conversación, y que la
 * cotización venga del detector de las señales y no de otro criterio.
 */

const V = "vendedora-prueba";
const CLAVE = "conv:whatsapp:51900000000:51999999999";
const AHORA = new Date("2026-07-25T12:00:00Z");
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);

const paso = (texto: string, conMedia = false) => ({
  orden: 1,
  texto,
  media: conMedia
    ? { archivo: "f.jpg", mime: "image/jpeg", clase: "imagen", nombre: "f.jpg" }
    : null,
  mediaPendiente: false,
});

/** Un catálogo chico que cubre las intenciones que las reglas piden. */
async function sembrarCatalogo(db: Awaited<ReturnType<typeof baseDePrueba>>) {
  await crearPlantilla(db, V, { nombre: "Flyer del diploma", pasos: [paso("DIPLOMA INTERNACIONAL", true)] });
  await crearPlantilla(db, V, { nombre: "Temario", pasos: [paso("Te paso el temario del diploma")] });
  await crearPlantilla(db, V, { nombre: "Cotización", pasos: [paso("La inversión es S/250")] });
  await crearPlantilla(db, V, { nombre: "Seguimiento", pasos: [paso("¿Pudiste ver el temario? ¿Alguna duda?")] });
  await crearPlantilla(db, V, { nombre: "Última llamada", pasos: [paso("Vuelvo a escribirte: quedan pocas vacantes")] });
  await crearPlantilla(db, V, { nombre: "Saludo", pasos: [paso("Hola, te saluda Luz, asesora comercial de Goberna")] });
}

test("sin ningún saliente, es PRIMER CONTACTO y sugiere el flyer", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola", occurredAt: haceDias(1) });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.esPrimerContacto, true);
  assert.equal(r.sugerencias[0].intencion, "flyer");
  assert.equal(r.sugerencias.length, 2);
});

test("con el flyer ya mandado y sin precio, lo primero es COTIZAR", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  await sembrarMensaje(db, { direccion: "entrante", texto: "info", occurredAt: haceDias(3) });
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "DIPLOMA INTERNACIONAL",
    mediaClase: "imagen",
    occurredAt: haceDias(2),
  });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.esPrimerContacto, false);
  assert.equal(r.estado.vioMaterial, true, "la media saliente es «vio material»");
  assert.equal(r.estado.cotizada, false);
  assert.equal(r.sugerencias[0].intencion, "precio");
});

test("cotizada y muda hace días: el estado dice enfriada y sugiere REACTIVAR", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  await sembrarMensaje(db, { direccion: "entrante", texto: "cuánto sale", occurredAt: haceDias(8) });
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "La inversión del diploma es de S/250",
    occurredAt: haceDias(6),
  });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.cotizada, true);
  assert.equal(r.estado.enfriada, true);
  assert.equal(r.sugerencias[0].intencion, "reactivar");
  assert.match(r.sugerencias[0].porque, /no contestó/);
});

test("«tenemos cuenta bancaria en soles» no la marca cotizada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "Tenemos cuenta bancaria en soles y en dólares",
    occurredAt: haceDias(6),
  });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.cotizada, false);
  assert.equal(r.estado.enfriada, false);
});

test("el último entrante que pide info se detecta, y el curso registrado también", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  await sembrarInteres(db, { clave: CLAVE, curso: "Diploma de Inteligencia 26" });
  await sembrarMensaje(db, { direccion: "saliente", texto: "hola", occurredAt: haceDias(3) });
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola de nuevo", occurredAt: haceDias(2) });
  await sembrarMensaje(db, { direccion: "entrante", texto: "¿me pasás el temario?", occurredAt: haceDias(1) });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.pidioInfo, true, "el ÚLTIMO entrante manda, no el primero");
  assert.equal(r.estado.curso, "Diploma de Inteligencia 26");
});

test("los mensajes de OTRA conversación no ensucian el estado de esta", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarCatalogo(db);
  // Otra persona, mismo número propio: le mandamos flyer y precio.
  await sembrarMensaje(db, {
    direccion: "saliente",
    personaId: "51911111111",
    texto: "La inversión es S/250",
    mediaClase: "imagen",
    occurredAt: haceDias(6),
  });
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola", occurredAt: haceDias(1) });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.equal(r.estado.esPrimerContacto, true);
  assert.equal(r.estado.vioMaterial, false);
  assert.equal(r.estado.cotizada, false);
});

test("sin plantillas aprobadas no se sugiere nada — el panel manda a las secuencias", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola", occurredAt: haceDias(1) });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.deepEqual(r.sugerencias, []);
});

test("las plantillas de OTRA vendedora no se sugieren", async (t) => {
  const db = await baseDePrueba(t);
  await crearPlantilla(db, "otra-vendedora", { nombre: "Flyer", pasos: [paso("DIPLOMA", true)] });
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola", occurredAt: haceDias(1) });

  const r = await consultarSugerencias(db, { clave: CLAVE, vendedoraId: V, ahora: AHORA });
  assert.deepEqual(r.sugerencias, []);
});
