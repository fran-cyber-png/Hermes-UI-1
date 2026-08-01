import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { piezaDeUnMensaje, piezaDeUnaSecuencia } from "../catalogo/armar.js";
import { piezasParaElBot } from "./recuperador.js";

function hecho(clave: string): ReturnType<typeof piezaDeUnMensaje> {
  return piezaDeUnMensaje({
    clase: "hecho",
    id: clave,
    rotulo: clave,
    contenido: { texto: `texto de ${clave}` },
  });
}

function plantilla(
  id: string,
  familia: string | null,
  estado: "vigente" | "borrador" = familia ? "vigente" : "borrador",
): ReturnType<typeof piezaDeUnaSecuencia> {
  return piezaDeUnaSecuencia({
    id,
    rotulo: `plantilla ${id}`,
    estado,
    pasos: [{ orden: 1, texto: "hola", mediaClase: null, mediaArchivo: null }],
    familia: familia ? { vocabulario: "sku-cerberus", valor: familia } : null,
  });
}

function acuse(): ReturnType<typeof piezaDeUnMensaje> {
  return piezaDeUnMensaje({
    clase: "acuse",
    id: "fuera-de-horario",
    rotulo: "Acuse",
    contenido: { texto: "Gracias por escribirnos" },
  });
}

describe("piezasParaElBot — qué ve el bot (enfoque DIPCINTE)", () => {
  const catalogo = [
    plantilla("1", "DIPCINTE"),
    plantilla("2", "DIPICOT"),
    plantilla("3", null),
    hecho("cuotas"),
    acuse(),
  ];

  it("entran las del enfoque, las genéricas y los hechos", () => {
    const resultado = piezasParaElBot(catalogo, "DIPCINTE");
    const ids = resultado.map((p) => `${p.clase}:${p.id}`);
    assert.deepStrictEqual(ids, ["plantilla:1", "plantilla:3", "hecho:cuotas"]);
  });

  it("una plantilla de otra familia no entra", () => {
    const resultado = piezasParaElBot(catalogo, "DIPCINTE");
    assert.equal(resultado.some((p) => p.id === "2"), false);
  });

  it("los acuses y ganchos jamás entran: son de la auto-respuesta", () => {
    const resultado = piezasParaElBot([...catalogo, acuse()], "DIPCINTE");
    assert.equal(resultado.some((p) => p.clase === "acuse" || p.clase === "gancho"), false);
  });

  it("el enfoque es parametrizable", () => {
    const resultado = piezasParaElBot(catalogo, "DIPICOT");
    const ids = resultado.map((p) => `${p.clase}:${p.id}`);
    assert.deepStrictEqual(ids, ["plantilla:2", "plantilla:3", "hecho:cuotas"]);
  });

  it("`enviable` viaja tal cual: la tool rechaza lo que no se puede mandar", () => {
    const vigente = plantilla("1", "DIPCINTE");
    const propuesta = plantilla("4", "DIPCINTE", "borrador");
    const resultado = piezasParaElBot([vigente, propuesta], "DIPCINTE");
    const porId = new Map(resultado.map((p) => [p.id, p]));
    assert.equal(porId.get("1")?.enviable, true);
    assert.equal(porId.get("4")?.enviable, false);
  });

  it("vacío se queda vacío", () => {
    assert.deepStrictEqual(piezasParaElBot([], "DIPCINTE"), []);
  });
});
