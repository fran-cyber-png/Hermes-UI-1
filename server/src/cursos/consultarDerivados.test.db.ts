import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarInteres, sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { consultarInteresesDerivados } from "./consultarDerivados.js";
import { sembrarAliasCurso } from "./repositorio.js";

/**
 * EL CABLEADO del interés derivado contra una base de verdad (ADR 0008): que el
 * `origen` guardado en el evento y el `campaign_name` del lead lleguen de verdad
 * hasta la propuesta. La precedencia en sí ya la cubre el test puro hermano;
 * esto confirma que el SQL trae los candidatos que dice traer.
 */

const TELEFONO = "51999888777";
const MI_NUMERO = "51986394450";
const CLAVE = `conv:whatsapp:${TELEFONO}:${MI_NUMERO}`;

/** Un mensaje que llegó por Click-to-WhatsApp, con el referral del anuncio. */
async function sembrarDesdeAnuncio(db: Awaited<ReturnType<typeof baseDePrueba>>, titulo: string) {
  await sembrarMensaje(db, {
    personaId: TELEFONO,
    numeroPropio: MI_NUMERO,
    texto: "Hola quiero más información",
    origen: { fuente: "anuncio", adId: "1201", titulo },
  });
}

test("la campaña del anuncio se vuelve propuesta de curso (#102)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarDesdeAnuncio(db, "[JUL] INTELIGENCIA | WSP");

  const d = await consultarInteresesDerivados(db, {
    claves: [CLAVE],
    registradosPorClave: {},
  });

  assert.equal(d[CLAVE].curso, "Inteligencia y Contrainteligencia");
  assert.equal(d[CLAVE].familia, "DIPICOT");
  assert.equal(d[CLAVE].fuente, "anuncio");
  assert.equal(d[CLAVE].textoOrigen, "[JUL] INTELIGENCIA | WSP");
});

test("con un interés ya asentado no se propone nada: lo registrado manda", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarDesdeAnuncio(db, "[JUL] INTELIGENCIA | WSP");
  await sembrarInteres(db, { clave: CLAVE, curso: "Diploma Internacional del Consultor Político 25" });

  const d = await consultarInteresesDerivados(db, {
    claves: [CLAVE],
    registradosPorClave: { [CLAVE]: ["Diploma Internacional del Consultor Político 25"] },
  });
  assert.deepEqual(d, {});
});

test("el formulario que llenó la persona gana sobre el anuncio por el que entró", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarDesdeAnuncio(db, "[JUL] INTELIGENCIA | WSP");
  // El mismo teléfono, escrito como lo escribe Meta (con + y espacios): el
  // emparejamiento es por los últimos 9 dígitos.
  await sembrarLead(db, { phone: "+51 999 888 777", campaignName: "[ABR] OSINT Y SOCMINT" });

  const d = await consultarInteresesDerivados(db, { claves: [CLAVE], registradosPorClave: {} });
  assert.equal(d[CLAVE].familia, "DIPOSOC");
  assert.equal(d[CLAVE].fuente, "lead");
});

test("un anuncio que no nombra ningún curso muestra su título crudo, sin familia", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarDesdeAnuncio(db, "Reel spot antiguo");

  const d = await consultarInteresesDerivados(db, { claves: [CLAVE], registradosPorClave: {} });
  assert.equal(d[CLAVE].curso, null);
  assert.equal(d[CLAVE].familia, null);
  assert.equal(d[CLAVE].textoOrigen, "Reel spot antiguo");
});

test("una conversación sin anuncio ni formulario no aparece en el mapa", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarMensaje(db, { personaId: TELEFONO, numeroPropio: MI_NUMERO, texto: "hola" });

  const d = await consultarInteresesDerivados(db, { claves: [CLAVE], registradosPorClave: {} });
  assert.deepEqual(d, {});
});

test("el origen de una conversación no se le pega a la de al lado", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarAliasCurso(db);
  await sembrarDesdeAnuncio(db, "[JUL] INTELIGENCIA | WSP");
  const otra = `conv:whatsapp:51900000001:${MI_NUMERO}`;
  await sembrarMensaje(db, { personaId: "51900000001", numeroPropio: MI_NUMERO, texto: "hola" });

  const d = await consultarInteresesDerivados(db, {
    claves: [CLAVE, otra],
    registradosPorClave: {},
  });
  assert.equal(d[CLAVE].familia, "DIPICOT");
  assert.equal(d[otra], undefined);
});

test("sin alias cargados (tabla vacía) no se propone ningún curso mapeado", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarDesdeAnuncio(db, "[JUL] INTELIGENCIA | WSP");

  const d = await consultarInteresesDerivados(db, { claves: [CLAVE], registradosPorClave: {} });
  assert.equal(d[CLAVE].curso, null);
  assert.equal(d[CLAVE].textoOrigen, "[JUL] INTELIGENCIA | WSP");
});

test("la siembra es idempotente: correrla dos veces no duplica alias", async (t) => {
  const db = await baseDePrueba(t);
  const primera = await sembrarAliasCurso(db);
  const segunda = await sembrarAliasCurso(db);
  assert.ok(primera > 0, "la primera siembra tiene que insertar");
  assert.equal(segunda, 0, "la segunda no puede insertar nada");
});
