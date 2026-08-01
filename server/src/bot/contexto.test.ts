import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolverIdentidad, PAIS_DE_MEMORIA, PAIS_DE_CERBERUS, PAIS_DEL_PREFIJO } from "./identidad.js";
import type { HechosLead } from "./memoria.js";

const cerberus = { nombre: "María Pérez", pais: "Perú" };

describe("resolverIdentidad — de dónde sale el nombre del lead", () => {
  it("la memoria (lo dicho en el chat) gana sobre Cerberus y el perfil", () => {
    const r = resolverIdentidad(
      { nombre: "Javier", pais: "México" } satisfies HechosLead,
      cerberus,
      "Javier M",
      "+5215512345678",
    );
    assert.equal(r.nombre, "Javier");
    assert.equal(r.pais, "México");
    assert.equal(r.procedenciaNombre, "la conversación");
    assert.equal(r.procedenciaPais, PAIS_DE_MEMORIA);
  });

  it("Cerberus (teléfono verificado) gana sobre el perfil de WhatsApp", () => {
    const r = resolverIdentidad({}, cerberus, "Maria", "+593991234567");
    assert.equal(r.nombre, "María Pérez");
    assert.equal(r.pais, "Perú");
    assert.equal(r.procedenciaNombre, "de Cerberus");
    assert.equal(r.procedenciaPais, PAIS_DE_CERBERUS);
  });

  it("el perfil de WhatsApp es el último recurso (y no aporta país)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, "Lucia", null);
    assert.equal(r.nombre, "Lucia");
    assert.equal(r.pais, null);
    assert.equal(r.procedenciaNombre, "su perfil de WhatsApp");
  });

  it("la memoria aporta solo nombre y el país sale de Cerberus", () => {
    const r = resolverIdentidad({ nombre: "Javier" }, cerberus, null, "+5215512345678");
    assert.equal(r.nombre, "Javier");
    assert.equal(r.pais, "Perú");
    assert.equal(r.procedenciaNombre, "la conversación");
    assert.equal(r.procedenciaPais, PAIS_DE_CERBERUS);
  });

  it("sin ninguna fuente, todo es null (el bot pregunta)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, null, null);
    assert.deepEqual(r, {
      nombre: null,
      procedenciaNombre: null,
      pais: null,
      procedenciaPais: null,
    });
  });

  it("la memoria con solo país no pisa el nombre de Cerberus", () => {
    const r = resolverIdentidad({ pais: "Ecuador" }, cerberus, "Maria", "+5215512345678");
    assert.equal(r.nombre, "María Pérez");
    assert.equal(r.pais, "Ecuador");
    assert.equal(r.procedenciaNombre, "de Cerberus");
    assert.equal(r.procedenciaPais, PAIS_DE_MEMORIA);
  });

  it("el prefijo del teléfono es el último recurso del país", () => {
    const r = resolverIdentidad(
      {},
      { nombre: null, pais: null },
      null,
      "+5215512345678",
    );
    assert.equal(r.pais, "México");
    assert.equal(r.procedenciaPais, PAIS_DEL_PREFIJO);
  });

  it("la memoria y Cerberus ganan sobre el prefijo del teléfono", () => {
    const conMemoria = resolverIdentidad({ pais: "Chile" }, { nombre: null, pais: null }, null, "+5215512345678");
    assert.equal(conMemoria.pais, "Chile");
    assert.equal(conMemoria.procedenciaPais, PAIS_DE_MEMORIA);

    const conCerberus = resolverIdentidad({}, { nombre: null, pais: "Colombia" }, null, "+5215512345678");
    assert.equal(conCerberus.pais, "Colombia");
    assert.equal(conCerberus.procedenciaPais, PAIS_DE_CERBERUS);
  });

  it("un número sin país conocido no inventa país", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, null, "+99912345678");
    assert.equal(r.pais, null);
    assert.equal(r.procedenciaPais, null);
  });

  it("el país de Cerberus se lleva a su forma canónica (MX → México)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: "MX" }, null, null);
    assert.equal(r.pais, "México");
    assert.equal(r.procedenciaPais, PAIS_DE_CERBERUS);
  });

  it("un teléfono peruano se lee con la línea local (sin el +)", () => {
    const r = resolverIdentidad({}, { nombre: null, pais: null }, null, "51930169613");
    assert.equal(r.pais, "Perú");
    assert.equal(r.procedenciaPais, PAIS_DEL_PREFIJO);
  });
});
