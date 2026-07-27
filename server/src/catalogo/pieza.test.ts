import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { marcadoresDe } from "./pieza.js";
import { versionDeContenido } from "./version.js";
import { piezasDeCodigo } from "./codigo.js";

describe("la versión de una pieza", () => {
  test("mismo contenido, misma versión: es lo que hace que el join del lazo cierre", () => {
    assert.equal(versionDeContenido(["hola"]), versionDeContenido(["hola"]));
  });

  test("cambiar el texto cambia la versión — el pedido irreparable de Ivi", () => {
    assert.notEqual(versionDeContenido(["hola"]), versionDeContenido(["hola!"]));
  });

  test("las partes no se pueden confundir entre sí", () => {
    // Sin separador, `["ab","c"]` y `["a","bc"]` hashearían igual y dos
    // plantillas distintas quedarían con la misma versión.
    assert.notEqual(versionDeContenido(["ab", "c"]), versionDeContenido(["a", "bc"]));
  });

  test("un paso vacío no es lo mismo que un paso ausente", () => {
    assert.notEqual(versionDeContenido(["a"]), versionDeContenido(["a", ""]));
  });

  test("es una cadena opaca, corta y comparable", () => {
    assert.match(versionDeContenido(["x"]), /^sha256:[0-9a-f]{16}$/);
  });
});

describe("los marcadores", () => {
  test("la sintaxis doble de los acuses", () => {
    const r = marcadoresDe("{{saludo}}, atendemos desde las {{hora_apertura}}");
    assert.equal(r.sintaxis, "llave-doble");
    assert.deepEqual(r.placeholders, ["hora_apertura", "saludo"]);
  });

  test("la sintaxis simple de las plantillas-secuencia", () => {
    const r = marcadoresDe("Hola {nombre}, el {curso} cuesta {precio}");
    assert.equal(r.sintaxis, "llave-simple");
    assert.deepEqual(r.placeholders, ["curso", "nombre", "precio"]);
  });

  test("`{{curso}}` no se lee como la sintaxis simple", () => {
    // `{curso}` matchea dentro de `{{curso}}`: si se probara la simple primero,
    // un acuse quedaría publicado con la sintaxis equivocada y Ivi creería que
    // Hermes lo va a expandir con la otra máquina.
    assert.equal(marcadoresDe("dale {{curso}}").sintaxis, "llave-doble");
  });

  test("sin marcadores, no se inventa ninguno", () => {
    assert.deepEqual(marcadoresDe("texto pelado").placeholders, []);
    assert.equal(marcadoresDe("texto pelado").sintaxis, null);
  });
});

describe("las piezas que viven en código", () => {
  test("existen SIN base — por eso un catálogo vacío del todo es un bug", () => {
    assert.ok(piezasDeCodigo().length > 0);
  });

  test("los cuatro acuses y los cinco ganchos, cada uno con su versión", () => {
    const piezas = piezasDeCodigo();
    const acuses = piezas.filter((p) => p.clase === "acuse");
    const ganchos = piezas.filter((p) => p.clase === "gancho");
    assert.ok(acuses.length >= 4);
    assert.ok(ganchos.length >= 5);
    for (const p of piezas) assert.match(p.version, /^sha256:[0-9a-f]{16}$/);
  });

  test("un gancho NO es enviable: es media frase, no un mensaje", () => {
    const gancho = piezasDeCodigo().find((p) => p.clase === "gancho");
    assert.equal(gancho?.enviable, false);
    assert.equal(gancho?.motivoNoEnviable, "fragmento");
  });

  test("el gancho declara SU vocabulario de familia, no el de Cerberus", () => {
    // Hay dos vocabularios de familia en el repo y no mapean 1:1: el prefijo de
    // SKU (`DIPICOT`) de las plantillas y el área de campaña (`osint`) de los
    // ganchos. Publicarlos como un `familia: string` pelado invitaría a cruzarlos.
    const gancho = piezasDeCodigo().find((p) => p.id === "osint");
    assert.deepEqual(gancho?.familia, { vocabulario: "campana-goberna", valor: "osint" });
  });

  test("el par {clase, id} es único: no hay dos piezas direccionables igual", () => {
    const claves = piezasDeCodigo().map((p) => `${p.clase}:${p.id}`);
    assert.equal(new Set(claves).size, claves.length);
  });

  test("los acuses publican sus marcadores: sin contexto no se pueden mandar", () => {
    const campana = piezasDeCodigo().find((p) => p.id === "fuera-de-horario-campana");
    assert.equal(campana?.sintaxisPlaceholder, "llave-doble");
    assert.ok(campana?.placeholders.includes("gancho"));
  });
});
