import { test } from "node:test";
import assert from "node:assert/strict";
import { baseDePrueba } from "../pruebas/base.js";
import { sembrarLead, sembrarMensaje } from "../pruebas/sembrar.js";
import { leadDeTelefono } from "./leadDeTelefono.js";

/**
 * EL ENRICHMENT DE LA FICHA (#113): el JOIN de `leads` por sufijo de teléfono.
 *
 * Es SQL, así que va contra la base (harness #33). Prueba que el match cruza los
 * formatos de número (el lead se guarda de una forma, la conversación de otra),
 * que un teléfono sin lead da null, y que la derivación NO copia datos: sale de
 * consultar `leads`, no de otra tabla.
 */

test("un teléfono con lead trae nombre, email y campaña marcados por origen", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, {
    fullName: "Ana Real",
    email: "ana@goberna.com",
    phone: "987654321",
    campaignName: "[ABR] OSINT Y SOCMINT",
    adName: "anuncio-1",
    formName: "form-osint",
    platform: "fb",
  });

  const mapa = await leadDeTelefono(db, ["51987654321"]);
  const lead = mapa["51987654321"];
  assert.ok(lead, "el teléfono de la conversación tiene que matchear el lead");
  assert.equal(lead.nombre, "Ana Real");
  assert.equal(lead.email, "ana@goberna.com");
  assert.equal(lead.campana, "[ABR] OSINT Y SOCMINT");
  assert.equal(lead.anuncio, "anuncio-1");
  assert.equal(lead.formulario, "form-osint");
  assert.equal(lead.fuente, "meta");
});

test("un teléfono sin lead no aparece en el mapa (ausente, no null)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { phone: "987654321", email: "otro@goberna.com" });

  const mapa = await leadDeTelefono(db, ["51999888777"]);
  assert.equal(mapa["51999888777"], undefined);
});

test("el match cruza formatos distintos del mismo número", async (t) => {
  const db = await baseDePrueba(t);
  // El lead se guardó CON separadores y prefijo; la conversación llega pelada.
  await sembrarLead(db, { phone: "+51 987-654-321", email: "cruza@goberna.com" });

  const mapa = await leadDeTelefono(db, ["987654321"]);
  assert.equal(mapa["987654321"]?.email, "cruza@goberna.com");
});

test("un lead de landing web se marca fuente 'web'", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { phone: "987654321", email: "web@goberna.com", platform: "web", formName: "icarus:landing" });

  const mapa = await leadDeTelefono(db, ["51987654321"]);
  assert.equal(mapa["51987654321"]?.fuente, "web");
});

test("con varios leads del mismo número gana el que tiene email (regla del mejor)", async (t) => {
  const db = await baseDePrueba(t);
  // Uno más nuevo sin email, uno más viejo con email: gana el del email.
  await sembrarLead(db, { phone: "987654321", email: null, createdTime: new Date("2026-06-01T00:00:00Z") });
  await sembrarLead(db, { phone: "987654321", email: "elegido@goberna.com", createdTime: new Date("2026-04-01T00:00:00Z") });

  const mapa = await leadDeTelefono(db, ["51987654321"]);
  assert.equal(mapa["51987654321"]?.email, "elegido@goberna.com");
});

test("varios teléfonos en un solo query, cada uno con su lead (batch)", async (t) => {
  const db = await baseDePrueba(t);
  await sembrarLead(db, { phone: "987654321", email: "uno@goberna.com" });
  await sembrarLead(db, { phone: "912345678", email: "dos@goberna.com" });
  // Un mensaje sembrado que también existe como conversación, para no depender de leads sueltos.
  await sembrarMensaje(db, { personaId: "51987654321" });

  const mapa = await leadDeTelefono(db, ["51987654321", "51912345678", "51900000000"]);
  assert.equal(mapa["51987654321"]?.email, "uno@goberna.com");
  assert.equal(mapa["51912345678"]?.email, "dos@goberna.com");
  assert.equal(mapa["51900000000"], undefined, "sin lead → ausente");
});
