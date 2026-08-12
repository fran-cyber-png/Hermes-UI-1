import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarMensaje } from "../pruebas/sembrar.js";
import { hiloDe } from "./hilo.js";
import { resolverCitados, resolverCitaSaliente } from "./citaRepositorio.js";

/**
 * LA CITA, DE LA BASE A LA PANTALLA.
 *
 * Dos mitades que un test puro no puede ver, porque las dos son SQL:
 *   · el hilo tiene que SERVIR la cita que la ingesta dejó en el crudo;
 *   · quién dijo el mensaje citado y qué decía se resuelve en una segunda
 *     consulta, y **cuando el citado no está tiene que degradar**, no romper.
 *
 * El caso feo no es raro: la cita apunta a un mensaje anterior a la vinculación
 * del número o a antes de que Hermes capturara citas, y eso va a ser lo NORMAL
 * las primeras semanas del frente.
 */

const LEAD = "51961506674";
const LINEA = "51986394450";

describe("el hilo sirve la cita del crudo", () => {
  test("🔴 un mensaje que responde a otro llega con su `cita`", async (t) => {
    const db = await baseDePrueba(t);

    await sembrarMensaje(db, {
      personaId: LEAD,
      numeroPropio: LINEA,
      externalId: "EL_PRECIO",
      direccion: "saliente",
      texto: "El diploma sale S/ 450",
      occurredAt: new Date(Date.now() - 60_000),
    });
    await sembrarMensaje(db, {
      personaId: LEAD,
      numeroPropio: LINEA,
      texto: "¿esto incluye certificado?",
      cita: { mensajeExternalId: "wa:EL_PRECIO" },
    });

    const hilo = await hiloDe(db, LEAD, LINEA);
    const respuesta = hilo[1] as { cita: { mensajeExternalId: string } | null };

    assert.deepEqual(respuesta.cita, { mensajeExternalId: "wa:EL_PRECIO" });
  });

  test("un mensaje normal la trae en null — no se inventa nada", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, texto: "hola" });

    const [uno] = await hiloDe(db, LEAD, LINEA);
    assert.equal((uno as { cita: unknown }).cita, null);
  });
});

describe("resolver el mensaje citado", () => {
  test("trae texto y dirección de cada citado, en una sola consulta", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "A", direccion: "saliente", texto: "S/ 450" });
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "B", direccion: "entrante", texto: "¿y en cuotas?" });

    const mapa = await resolverCitados(db, ["wa:A", "wa:B"]);

    assert.equal(mapa.size, 2);
    assert.deepEqual(mapa.get("wa:A"), {
      mensajeExternalId: "wa:A",
      texto: "S/ 450",
      direccion: "saliente",
      mediaClase: null,
    });
    assert.equal(mapa.get("wa:B")?.direccion, "entrante");
  });

  test("🔴 el citado que NO está simplemente no viene en el mapa (y quien llama dibuja el hueco)", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "A", texto: "acá sí" });

    const mapa = await resolverCitados(db, ["wa:A", "wa:NO_EXISTE"]);

    assert.ok(mapa.has("wa:A"));
    assert.ok(!mapa.has("wa:NO_EXISTE"), "no se inventa una fila vacía: la ausencia ES el dato");
  });

  test("un citado que era un ADJUNTO trae su clase, para poder decir «Foto»", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, {
      personaId: LEAD,
      numeroPropio: LINEA,
      externalId: "FLYER",
      direccion: "saliente",
      texto: null,
      mediaClase: "imagen",
    });

    const mapa = await resolverCitados(db, ["wa:FLYER"]);

    assert.equal(mapa.get("wa:FLYER")?.texto, null);
    assert.equal(mapa.get("wa:FLYER")?.mediaClase, "imagen");
  });

  test("sin ids no toca la base", async (t) => {
    const db = await baseDePrueba(t);
    assert.equal((await resolverCitados(db, [])).size, 0);
  });
});

describe("la cita que SALE con un envío", () => {
  test("🔴 `esNuestro` sale de la dirección guardada, no de lo que declare el navegador", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "MIO", direccion: "saliente", texto: "S/ 450" });
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "SUYO", direccion: "entrante", texto: "¿cuánto?" });

    // El `participant` del proto sale de acá: mal puesto, el lead ve la tirita
    // atribuida a la persona equivocada.
    assert.deepEqual(await resolverCitaSaliente(db, "wa:MIO"), {
      mensajeId: "MIO",
      esNuestro: true,
      texto: "S/ 450",
    });
    assert.deepEqual(await resolverCitaSaliente(db, "wa:SUYO"), {
      mensajeId: "SUYO",
      esNuestro: false,
      texto: "¿cuánto?",
    });
  });

  test("el prefijo `wa:` se pela, y da igual si el navegador lo mandó o no", async (t) => {
    const db = await baseDePrueba(t);
    await sembrarMensaje(db, { personaId: LEAD, numeroPropio: LINEA, externalId: "X", texto: "hola" });

    assert.deepEqual(await resolverCitaSaliente(db, "wa:X"), await resolverCitaSaliente(db, "X"));
  });

  test("🔴 un id que Hermes no conoce SE CITA IGUAL, sin texto", async (t) => {
    const db = await baseDePrueba(t);

    // Quien tiene que resolver el link es WhatsApp, que sí lo tiene. Lo que se
    // pierde es el preview, no la cita.
    assert.deepEqual(await resolverCitaSaliente(db, "wa:DESCONOCIDO"), {
      mensajeId: "DESCONOCIDO",
      esNuestro: false,
      texto: null,
    });
  });

  test("sin `citaDe` no hay cita: un envío normal no cambia", async (t) => {
    const db = await baseDePrueba(t);

    assert.equal(await resolverCitaSaliente(db, null), undefined);
    assert.equal(await resolverCitaSaliente(db, ""), undefined);
    assert.equal(await resolverCitaSaliente(db, "   "), undefined);
    assert.equal(await resolverCitaSaliente(db, "wa:"), undefined);
  });
});
