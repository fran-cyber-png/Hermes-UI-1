import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MOMENTOS_DE_VENTA } from "../sugerencias/estado.js";
import { CATALOGO_POR_DEFECTO, type Hecho } from "./catalogo.js";
import { elegirHechos, TOPE_HECHOS } from "./elegir.js";

function hecho(p: Partial<Hecho>): Hecho {
  return { clave: "x", rotulo: "X", texto: "x", momentos: [], orden: 1, ...p };
}

describe("elegirHechos — la munición que corresponde ahora", () => {
  it("un hecho sin momentos vale en todos: es el default de lo que se agregue sin pensarlo", () => {
    const c = [hecho({ clave: "libre" })];
    for (const m of MOMENTOS_DE_VENTA) {
      assert.deepEqual(
        elegirHechos(c, m).map((h) => h.clave),
        ["libre"],
      );
    }
  });

  it("filtra por el momento: lo de después del precio no se ofrece antes del precio", () => {
    const c = [hecho({ clave: "cuotas", momentos: ["cotizada"] })];
    assert.deepEqual(elegirHechos(c, "cotizada").map((h) => h.clave), ["cuotas"]);
    assert.deepEqual(elegirHechos(c, "primer-contacto"), []);
  });

  it("respeta el orden del catálogo, no el de la base", () => {
    const c = [hecho({ clave: "c", orden: 3 }), hecho({ clave: "a", orden: 1 }), hecho({ clave: "b", orden: 2 })];
    assert.deepEqual(elegirHechos(c, "cotizada").map((h) => h.clave), ["a", "b", "c"]);
  });

  it("dos hechos con el mismo orden no salen en un orden distinto en cada request", () => {
    const c = [hecho({ clave: "zeta", orden: 1 }), hecho({ clave: "alfa", orden: 1 })];
    assert.deepEqual(elegirHechos(c, "cotizada").map((h) => h.clave), ["alfa", "zeta"]);
  });

  it("corta en tres: el bloque vive en 360 px, siete chips serían un menú", () => {
    const c = Array.from({ length: 9 }, (_, i) => hecho({ clave: `h${i}`, orden: i }));
    assert.equal(elegirHechos(c, "cotizada").length, TOPE_HECHOS);
  });

  it("no muta el catálogo que recibe (lo sirve un caché compartido)", () => {
    const c = [hecho({ clave: "b", orden: 2 }), hecho({ clave: "a", orden: 1 })];
    elegirHechos(c, "cotizada");
    assert.deepEqual(c.map((h) => h.clave), ["b", "a"]);
  });

  it("un catálogo vacío no inventa nada", () => {
    assert.deepEqual(elegirHechos([], "cotizada"), []);
  });
});

describe("el catálogo por defecto (#153)", () => {
  it("ningún momento de la venta se queda sin munición", () => {
    for (const m of MOMENTOS_DE_VENTA) {
      assert.ok(
        elegirHechos(CATALOGO_POR_DEFECTO, m).length > 0,
        `«${m}» se quedó sin ningún dato recomendado`,
      );
    }
  });

  it("las claves son únicas: son la identidad contra la que se edita", () => {
    const claves = CATALOGO_POR_DEFECTO.map((h) => h.clave);
    assert.equal(new Set(claves).size, claves.length);
  });

  it("después del precio ofrece las cuotas — el dato que cerró una venta en un minuto", () => {
    assert.ok(elegirHechos(CATALOGO_POR_DEFECTO, "cotizada").some((h) => h.clave === "cuotas"));
  });

  it("antes del precio ofrece el fit, no la forma de pago", () => {
    const primeros = elegirHechos(CATALOGO_POR_DEFECTO, "primer-contacto").map((h) => h.clave);
    assert.ok(primeros.includes("publico-general"));
    assert.ok(!primeros.includes("cuotas"));
  });

  it("son frases sueltas, no secuencias: una línea, sin saltos", () => {
    for (const h of CATALOGO_POR_DEFECTO) {
      assert.ok(!h.texto.includes("\n"), `«${h.clave}» tiene más de un párrafo: eso es una plantilla`);
      assert.ok(h.rotulo.length <= 30, `el rótulo de «${h.clave}» no entra en el chip`);
    }
  });
});
