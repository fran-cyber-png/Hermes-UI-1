import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nivelDeCliente } from "./nivel.js";

/**
 * LA JERARQUÍA DEL EX-CLIENTE (#133) — qué tan valioso es quien vuelve a escribir.
 *
 * Los casos vienen de la medición contra el padrón real (comentario del issue,
 * 26-jul-2026): de 1.997 conversaciones vivas, 140 ya compraron; de esas, 49
 * compraron más de una vez y 11 son VIP. Son tres poblaciones distintas y la
 * vendedora las trata distinto, así que el nivel se decide UNA vez, acá.
 */

describe("nivelDeCliente — el conteo manda", () => {
  test("una compra es un cliente", () => {
    assert.equal(nivelDeCliente({ compras: 1 }), "compro");
  });

  test("dos compras es alguien que recompró — el lead más barato de convertir", () => {
    assert.equal(nivelDeCliente({ compras: 2 }), "recompro");
  });

  test("cero compras NO es cliente, aunque esté en el padrón", () => {
    assert.equal(nivelDeCliente({ compras: 0 }), null);
  });

  test("un conteo negativo o roto se lee como cero, no como cliente", () => {
    assert.equal(nivelDeCliente({ compras: -3 }), null);
    assert.equal(nivelDeCliente({ compras: Number.NaN }), null);
  });
});

describe("nivelDeCliente — el tier del padrón", () => {
  test("VIP es un juicio comercial del padrón: Hermes no lo reinventa", () => {
    assert.equal(nivelDeCliente({ compras: 1, tier: "vip" }), "vip");
  });

  test("el tier viene con mayúsculas y espacios según quién lo escribió", () => {
    assert.equal(nivelDeCliente({ compras: 3, tier: " VIP " }), "vip");
  });

  test("VIP sin ninguna compra no es VIP: el conteo es el hecho, el tier la etiqueta", () => {
    assert.equal(nivelDeCliente({ compras: 0, tier: "vip" }), null);
  });

  test("«repeat» y «single» no mandan sobre el conteo: son el mismo dato, peor dicho", () => {
    assert.equal(nivelDeCliente({ compras: 1, tier: "repeat" }), "compro");
    assert.equal(nivelDeCliente({ compras: 4, tier: "single" }), "recompro");
  });

  test("«prospect» todavía no compró", () => {
    assert.equal(nivelDeCliente({ compras: 0, tier: "prospect" }), null);
  });

  test("un tier desconocido se ignora en silencio, no rompe ni inventa un nivel", () => {
    assert.equal(nivelDeCliente({ compras: 2, tier: "platino" }), "recompro");
    assert.equal(nivelDeCliente({ compras: 1, tier: null }), "compro");
  });
});
