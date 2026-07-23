import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarCola } from "./consultarCola.js";

/**
 * La cola tiene que decir QUÉ es un mensaje sin texto (una foto, un audio) en vez
 * de «(sin texto)» (#55). El dato sale de la clase de media del ÚLTIMO mensaje.
 * Esto se testea contra la base porque es SQL — justo lo que el harness #33 vino
 * a habilitar.
 */

type Fila = { texto: string | null; ultima_clase: string | null };

test("la cola surfacea la clase del último mensaje cuando es media-only", async (t) => {
  const db = await baseDePrueba(t);
  // Un lead que mandó una foto sin texto.
  await sembrarMensaje(db, { personaId: "51900111", texto: null, mediaClase: "imagen" });

  const { conversaciones } = await consultarCola(db, {});
  assert.equal(conversaciones.length, 1);
  const fila = conversaciones[0] as Fila;
  assert.equal(fila.texto, null, "media-only: el preview no tiene texto");
  assert.equal(fila.ultima_clase, "imagen", "la cola trae la clase para poder mostrar «📷 Foto»");
});

test("un mensaje de texto no trae clase — el preview usa el texto", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarMensaje(db, { personaId: "51900222", texto: "hola, quiero info" });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.texto, "hola, quiero info");
  assert.equal(fila.ultima_clase, null);
});

test("manda el ÚLTIMO mensaje: si lo último es un audio, esa es la clase del preview", async (t) => {
  const db = await baseDePrueba(t);
  const antes = new Date(Date.now() - 60_000);
  const ahora = new Date();
  await sembrarMensaje(db, { personaId: "51900333", texto: "hola", occurredAt: antes });
  await sembrarMensaje(db, { personaId: "51900333", texto: null, mediaClase: "audio", occurredAt: ahora });

  const fila = (await consultarCola(db, {})).conversaciones[0] as Fila;
  assert.equal(fila.ultima_clase, "audio", "la clase es la del último mensaje, no la de cualquiera");
  assert.equal(fila.texto, null, "el preview es el del último (media-only)");
});
