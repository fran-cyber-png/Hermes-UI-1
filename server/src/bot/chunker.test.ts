import { describe, it } from "node:test";
import assert from "node:assert";
import { trocear } from "./chunker.js";

describe("trocear", () => {
  it("texto corto (< 300 chars) → una burbuja", () => {
    const corto = "Hola, ¿en qué puedo ayudarte?";
    const r = trocear(corto);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0], corto);
  });

  it("dos párrafos → dos burbujas", () => {
    const p1 = "Primer párrafo con suficiente contenido. ".repeat(15);
    const p2 = "Segundo párrafo también con bastante texto. ".repeat(15);
    const texto = `${p1}\n\n${p2}`;
    const r = trocear(texto);
    assert.strictEqual(r.length, 2);
    assert.ok(r[0]!.includes("Primer"));
    assert.ok(r[1]!.includes("Segundo"));
  });

  it("cinco párrafos, max 3 → tres burbujas (últimos juntos)", () => {
    const base = "Párrafo con contenido sustancial para superar el umbral de trescientos caracteres. ".repeat(3);
    const parrafos = [base + "Uno.", base + "Dos.", base + "Tres.", base + "Cuatro.", base + "Cinco."];
    const texto = parrafos.join("\n\n");
    const r = trocear(texto);
    assert.strictEqual(r.length, 3);
    assert.ok(r[0]!.includes("Uno"));
    assert.ok(r[1]!.includes("Dos"));
    assert.ok(r[2]!.includes("Tres") && r[2]!.includes("Cinco"));
  });

  it("un párrafo largo → cortado por oraciones", () => {
    const largo =
      "Hola. ¿Cómo estás? Bien. Esto es una frase larga con suficiente contenido para superar los trescientos caracteres de longitud que activan el troceo por párrafos y oraciones. Y otra más. Seguimos con más texto. Necesitamos más oraciones para que esto funcione correctamente. Esta debería ser suficiente.";
    const r = trocear(largo);
    assert.ok(r.length >= 2);
    assert.ok(r.length <= 3);
  });

  it("texto vacío → []", () => {
    assert.deepStrictEqual(trocear(""), []);
  });

  it("texto solo espacios → []", () => {
    assert.deepStrictEqual(trocear("   \n  "), []);
  });

  it("un párrafo largo sin oraciones separables → una burbuja", () => {
    const largo = "x".repeat(400);
    const r = trocear(largo);
    assert.strictEqual(r.length, 1);
  });
});
