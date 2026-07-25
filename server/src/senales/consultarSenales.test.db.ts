import test from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarSenales } from "./consultarSenales.js";

/**
 * EL CABLEADO de las señales contra Postgres de verdad (ADR 0008).
 *
 * Los tests puros fijan el CRITERIO (`cotizacion.test.ts`, `enfriamiento.test.ts`);
 * estos fijan que el criterio llegue a la conversación correcta: que el prefiltro
 * SQL no se coma una cotización, que el saliente y el entrante se distingan, y que
 * la corroboración por flyer/temario mire los mensajes de ESA conversación.
 */

const CLAVE = "conv:whatsapp:51900000000:51999999999";
const AHORA = new Date("2026-07-25T12:00:00Z");
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);

test("una conversación sin salientes no tiene ninguna señal", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola", occurredAt: haceDias(1) });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion, null);
  assert.equal(s[CLAVE].enfriamiento.enfriada, false);
});

test("el precio enviado hace 5 días sin respuesta: cotizada Y enfriada", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { direccion: "entrante", texto: "hola, info", occurredAt: haceDias(7) });
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "La inversión del diploma es de S/250",
    occurredAt: haceDias(5),
  });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion?.esCotizacion, true);
  assert.equal(s[CLAVE].cotizacion?.confianza, "alta");
  assert.equal(s[CLAVE].enfriamiento.enfriada, true);
  assert.equal(s[CLAVE].enfriamiento.diasDeSilencio, 5);
});

test("si la persona contestó después del precio, no está fría", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "La inversión es S/250",
    occurredAt: haceDias(5),
  });
  await sembrarMensaje(db, { direccion: "entrante", texto: "lo pienso", occurredAt: haceDias(4) });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion?.esCotizacion, true);
  assert.equal(s[CLAVE].enfriamiento.enfriada, false);
});

test("«tenemos cuenta bancaria en soles» NO cotiza — el falso positivo no entra", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "Tenemos cuenta bancaria en soles y en dólares",
    occurredAt: haceDias(6),
  });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion, null);
  assert.equal(s[CLAVE].enfriamiento.enfriada, false);
});

test("el flyer previo corrobora la cotización", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "🕵️ DIPLOMA INTERNACIONAL DE INTELIGENCIA",
    mediaClase: "imagen",
    occurredAt: haceDias(6),
  });
  await sembrarMensaje(db, { direccion: "saliente", texto: "S/250", occurredAt: haceDias(5) });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion?.esCotizacion, true);
  assert.equal(s[CLAVE].corroborada, true, "el flyer anterior tiene que corroborar");
});

test("una cifra suelta sin flyer ni temario queda SIN corroborar", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { direccion: "saliente", texto: "S/250", occurredAt: haceDias(5) });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion?.confianza, "media");
  assert.equal(s[CLAVE].corroborada, false);
});

test("con dos cotizaciones, el enfriamiento se mide desde la última", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "El precio es S/250",
    occurredAt: haceDias(10),
  });
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "Te dejo la promoción en S/199",
    occurredAt: haceDias(4),
  });

  const s = await consultarSenales(db, { claves: [CLAVE], ahora: AHORA });
  assert.equal(s[CLAVE].enfriamiento.diasDeSilencio, 4);
  assert.match(s[CLAVE].cotizacion!.motivo, /199/);
});

test("las señales de una conversación no se filtran a otra", async (t) => {
  const db = await baseDePrueba(t);
  const OTRA = "conv:whatsapp:51911111111:51999999999";
  await sembrarMensaje(db, {
    direccion: "saliente",
    texto: "La inversión es S/250",
    occurredAt: haceDias(6),
  });
  await sembrarMensaje(db, {
    direccion: "saliente",
    personaId: "51911111111",
    texto: "hola, ¿cómo estás?",
    occurredAt: haceDias(6),
  });

  const s = await consultarSenales(db, { claves: [CLAVE, OTRA], ahora: AHORA });
  assert.equal(s[CLAVE].cotizacion?.esCotizacion, true);
  assert.equal(s[OTRA].cotizacion, null);
});

test("un comentario suelto (`int:`) devuelve señal vacía, no un error", async (t) => {
  const db = await baseDePrueba(t);
  const s = await consultarSenales(db, { claves: ["int:42"], ahora: AHORA });
  assert.deepEqual(Object.keys(s), ["int:42"]);
  assert.equal(s["int:42"].cotizacion, null);
});

test("sin claves, no se consulta nada", async (t) => {
  const db = await baseDePrueba(t);
  assert.deepEqual(await consultarSenales(db, { claves: [], ahora: AHORA }), {});
});
