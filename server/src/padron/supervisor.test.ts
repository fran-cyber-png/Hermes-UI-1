import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { esSupervisor, supervisoresConfigurados, ENV_SUPERVISORES } from "./supervisor.js";

/**
 * La frontera del padrón, interrogada sobre los casos que la abrirían de par en
 * par. Puro: no hace falta base ni server para preguntar quién manda.
 */

const con = (valor?: string) => (valor === undefined ? {} : { [ENV_SUPERVISORES]: valor });

describe("quién ve el padrón entero", () => {
  test("sin la variable configurada NADIE es supervisor", () => {
    // Fail-closed. La alternativa —«sin configurar, todos»— convierte una config
    // que falta en la fuga de 72.923 contactos con nombre, teléfono y correo.
    assert.equal(esSupervisor("ventas10@grupogoberna.com", con()), false);
    assert.equal(esSupervisor("cualquiera", con()), false);
  });

  test("una variable vacía tampoco habilita a nadie", () => {
    assert.equal(esSupervisor("ventas10@grupogoberna.com", con("")), false);
    assert.equal(esSupervisor("ventas10@grupogoberna.com", con("   ")), false);
  });

  test("el supervisor configurado entra", () => {
    assert.equal(esSupervisor("ventas10@grupogoberna.com", con("ventas10@grupogoberna.com")), true);
  });

  test("una vendedora que no está en la lista NO entra", () => {
    assert.equal(esSupervisor("ventas11@grupogoberna.com", con("ventas10@grupogoberna.com")), false);
  });

  test("un token vacío nunca entra, ni con supervisores configurados", () => {
    // `mismaVendedora` rechaza la cadena vacía a propósito: sin eso, un token sin
    // `vendedoraId` matchearía contra una entrada vacía de la lista.
    assert.equal(esSupervisor("", con("ventas10@grupogoberna.com")), false);
    assert.equal(esSupervisor("   ", con("ventas10@grupogoberna.com,")), false);
  });

  test("🔴 la grafía no decide: `Ventas10` configurado y `ventas10` tipeado son la misma persona", () => {
    // El defecto que este test existe para impedir está VIVO en producción con
    // otra persona: Cerberus empuja `Luz` y ella entra como `luz`. Un supervisor
    // que se cae por una mayúscula no ve un error — ve su pantalla vacía y lee
    // «no me habilitaron nada».
    assert.equal(esSupervisor("ventas10@grupogoberna.com", con("Ventas10@grupogoberna.com")), true);
    assert.equal(esSupervisor("  ventas10@grupogoberna.com  ", con("VENTAS10@GRUPOGOBERNA.COM")), true);
  });

  test("varios supervisores, separados por coma y con espacios de más", () => {
    const env = con(" ventas10@grupogoberna.com , luz ");
    assert.equal(esSupervisor("luz", env), true);
    assert.equal(esSupervisor("Luz", env), true);
    assert.equal(esSupervisor("ventas10@grupogoberna.com", env), true);
    assert.equal(esSupervisor("ventas14@grupogoberna.com", env), false);
  });

  test("se conserva la grafía configurada, no se reescribe", () => {
    // Se compara normalizado, pero lo que se guarda y se muestra es lo que se
    // escribió: reescribir grafías rompe el cruce con `gestiones` y el resto.
    assert.deepEqual(supervisoresConfigurados(con("Ventas10@grupogoberna.com, Luz")), [
      "Ventas10@grupogoberna.com",
      "Luz",
    ]);
  });

  test("las entradas vacías de la lista se descartan, no habilitan a nadie", () => {
    assert.deepEqual(supervisoresConfigurados(con(",,  ,")), []);
    assert.equal(esSupervisor("x", con(",,  ,")), false);
  });
});
