import { describe, it } from "node:test";
import assert from "node:assert";
import { destinosPosibles, esDestinoValido } from "./destino.js";

/**
 * A QUIÉN SE LE PUEDE PASAR UNA CONVERSACIÓN.
 *
 * Lo que estos tests protegen es UN fallo silencioso: el `vendedora_id` es el
 * username de Cerberus y Hermes no tiene padrón contra el cual verificarlo, así
 * que un dedazo (`sindi` por `sindy`) escribe una fila perfectamente válida y la
 * conversación desaparece de la cola de todo el mundo **sin un solo síntoma**.
 */

describe("destinosPosibles", () => {
  it("junta la rueda y el mapa de Cerberus, sin repetir", () => {
    // El caso real del 4-ago: los seis están en la rueda, y Luz solo en el mapa
    // (no entra a la rueda a propósito, decisión 2). A Luz hay que poder pasarle.
    const d = destinosPosibles({ rueda: ["ana", "beto", "caro"], mapa: ["luz", "ana"] });
    assert.deepEqual(d, ["ana", "beto", "caro", "luz"]);
  });

  it("el orden es estable: es la lista que la UI ofrece y la que el error enumera", () => {
    const a = destinosPosibles({ rueda: ["zoe", "ana"], mapa: ["beto"] });
    const b = destinosPosibles({ rueda: ["beto"], mapa: ["ana", "zoe"] });
    assert.deepEqual(a, b);
  });

  it("ignora vacíos y espacios sueltos", () => {
    assert.deepEqual(destinosPosibles({ rueda: [" ana ", ""], mapa: ["  "] }), ["ana"]);
  });

  /**
   * EL CASO REAL DE PRODUCCIÓN (medido en VPS1 el 4-ago-2026): Cerberus empuja
   * `Luz` a `numero_vendedora` y ella entra al login como `luz`. Ofrecer las dos
   * pondría al mismo humano dos veces en la lista, cada uno con la mitad de sus
   * conversaciones. Gana la grafía de la RUEDA, que es con la que se están
   * escribiendo las asignaciones.
   */
  it("la misma persona con dos grafías es UNA sola, y manda la de la rueda", () => {
    const d = destinosPosibles({ rueda: ["luz"], mapa: ["Luz", "Sindy"] });
    assert.deepEqual(d, ["luz", "Sindy"]);
  });

  it("sin rueda ni mapa no hay a quién pasarle", () => {
    assert.deepEqual(destinosPosibles({ rueda: [], mapa: [] }), []);
  });
});

describe("esDestinoValido", () => {
  const posibles = ["ana", "beto", "Luz"];

  it("acepta a quien está en la lista", () => {
    assert.equal(esDestinoValido("beto", posibles), true);
  });

  /** EL CASO QUE JUSTIFICA TODO EL MÓDULO. */
  it("RECHAZA el dedazo, que es lo único que no tiene síntoma", () => {
    assert.equal(esDestinoValido("bet", posibles), false);
    assert.equal(esDestinoValido("betoo", posibles), false);
  });

  /**
   * ⚠️ ESTE TEST ESTABA AL REVÉS, y lo dio vuelta la evidencia de producción.
   *
   * Se había escrito «distingue mayúsculas» razonando que normalizar reabriría el
   * agujero. Lo que reabre el agujero es normalizar de UN SOLO lado. Medido en
   * VPS1 el 4-ago-2026, el mismo humano tiene dos grafías vivas —Cerberus empuja
   * `Luz`, ella entra como `luz`—, así que exigir la grafía exacta rechaza a la
   * persona correcta, o escribe una asignación que su propio token nunca ve.
   */
  it("la misma persona con otra grafía SÍ es un destino válido (`Luz` ≡ `luz`)", () => {
    assert.equal(esDestinoValido("Beto", posibles), true);
    assert.equal(esDestinoValido("  LUZ  ", posibles), true);
  });

  it("y aun así el dedazo sigue cayendo: normalizar no es aflojar", () => {
    assert.equal(esDestinoValido("Bet", posibles), false);
    assert.equal(esDestinoValido("betoo", posibles), false);
  });

  /**
   * FAIL-CLOSED, y es la decisión que separa esto de un adorno: con la lista
   * vacía bastaría pedir la reasignación en una línea sin configurar para escribir
   * cualquier `vendedora_id` en la tabla.
   */
  it("con la lista vacía rechaza a todos: no es «acá vale cualquiera»", () => {
    assert.equal(esDestinoValido("ana", []), false);
  });

  it("una cadena vacía o de espacios nunca es un destino", () => {
    assert.equal(esDestinoValido("", posibles), false);
    assert.equal(esDestinoValido("   ", posibles), false);
  });
});
