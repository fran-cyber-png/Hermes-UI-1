import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test, describe } from "node:test";
import { firmaValida } from "./firma.js";

/**
 * La firma es lo único que separa "una venta de Cerberus" de "cualquiera que descubra la URL".
 * Sin esto, alguien podría inventarnos ventas falsas y contaminar la optimización de Meta con
 * conversiones que nunca ocurrieron. Es la puerta, y tiene que cerrar bien.
 */

const SECRETO = "un-secreto-de-prueba";

function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

describe("firmaValida", () => {
  test("acepta una firma correcta", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), SECRETO), true);
  });

  test("rechaza un cuerpo alterado — aunque sea un byte", () => {
    const cuerpo = '{"folio":"GOB-11851","monto":350}';
    const firma = firmar(cuerpo);
    const alterado = '{"folio":"GOB-11851","monto":3500}'; // le agregaron un cero al monto
    assert.equal(firmaValida(alterado, firma, SECRETO), false);
  });

  test("rechaza una firma hecha con OTRO secreto", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    const firmaAjena = firmar(cuerpo, "secreto-del-atacante");
    assert.equal(firmaValida(cuerpo, firmaAjena, SECRETO), false);
  });

  test("rechaza firma vacía o ausente", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, "", SECRETO), false);
    assert.equal(firmaValida(cuerpo, undefined, SECRETO), false);
    assert.equal(firmaValida(cuerpo, null, SECRETO), false);
  });

  test("acepta el prefijo 'sha256=' o sin prefijo — distintos emisores lo escriben distinto", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    const hex = createHmac("sha256", SECRETO).update(cuerpo).digest("hex");
    assert.equal(firmaValida(cuerpo, `sha256=${hex}`, SECRETO), true);
    assert.equal(firmaValida(cuerpo, hex, SECRETO), true);
  });

  test("es resistente a timing: una firma de largo equivocado no explota, devuelve false", () => {
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, "sha256=abc", SECRETO), false);
    assert.equal(firmaValida(cuerpo, "basura", SECRETO), false);
  });

  test("sin secreto configurado NUNCA valida — falla cerrado, no abierto", () => {
    // Si el secreto no está seteado, la puerta se cierra. Jamás se abre por descuido.
    const cuerpo = '{"folio":"GOB-11851"}';
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), ""), false);
    assert.equal(firmaValida(cuerpo, firmar(cuerpo), undefined), false);
  });
});
