import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverIdentidad } from "./identidad.js";
import type { HechosLead } from "./memoria.js";

const cerberus = { nombre: "María Pérez", pais: "Perú" };

describe("resolverIdentidad — de dónde sale el nombre del lead", () => {
  it("la memoria (lo dicho en el chat) gana sobre Cerberus y el perfil", () => {
    const r = resolverIdentidad(
      { nombre: "Javier", pais: "México" } satisfies HechosLead,
      cerberus,
      "Javier M",
    );
    assert.equal(r.nombre, "Javier");
    assert.equal(r.pais, "México");
    assert.equal(r.procedenciaNombre, "la conversación");
  });

  it("Cerberus (teléfono verificado) gana sobre el perfil de WhatsApp", () => {
    const r = resolverIdentidad({}, cerberus, "Maria");
    assert.equal(r.nombre, "María Pérez");
    assert.equal(r.pais, "Perú");
    assert.equal(r.procedenciaNombre, "de Cerberus");
  });

  it("el perfil de WhatsApp es el último recurso (y no aporta país)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, "Lucia");
    assert.equal(r.nombre, "Lucia");
    assert.equal(r.pais, null);
    assert.equal(r.procedenciaNombre, "su perfil de WhatsApp");
  });

  it("la memoria aporta solo nombre y el país sale de Cerberus", () => {
    const r = resolverIdentidad({ nombre: "Javier" }, cerberus, null);
    assert.equal(r.nombre, "Javier");
    assert.equal(r.pais, "Perú");
    assert.equal(r.procedenciaNombre, "la conversación");
  });

  it("sin ninguna fuente, todo es null (el bot pregunta)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, null);
    assert.deepEqual(r, { nombre: null, procedenciaNombre: null, pais: null });
  });

  it("la memoria con solo país no pisa el nombre de Cerberus", () => {
    const r = resolverIdentidad({ pais: "Ecuador" }, cerberus, "Maria");
    assert.equal(r.nombre, "María Pérez");
    assert.equal(r.pais, "Ecuador");
    assert.equal(r.procedenciaNombre, "de Cerberus");
  });
});
