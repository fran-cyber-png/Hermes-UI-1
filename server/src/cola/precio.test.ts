import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mencionaPrecio } from "./precio.js";

/**
 * ¿ESTE TEXTO NUESTRO LE PASÓ EL PRECIO? — los casos salen de mensajes SALIENTES
 * reales del número de producción (leídos el 2026-07-25, sin PII): son las
 * plantillas que la vendedora manda todos los días. El predicado se diseñó
 * contra ellos, no contra una idea de cómo se cotiza.
 */

describe("mencionaPrecio — el monto", () => {
  test("un monto en pesos con símbolo", () => {
    assert.equal(mencionaPrecio("$3400 pesos mexicanos"), true);
  });

  test("un monto en soles con S/", () => {
    assert.equal(mencionaPrecio("La inversión es S/ 450 en dos cuotas"), true);
  });

  test("un monto escrito con la moneda al final", () => {
    assert.equal(
      mencionaPrecio("por el valor de 17476 Pesos Mexicanos por la entrada Elite"),
      true,
    );
  });

  test("un número suelto NO es un precio", () => {
    assert.equal(mencionaPrecio("El diploma dura 3 semanas de clases en vivo"), false);
  });
});

describe("mencionaPrecio — la forma de pagar", () => {
  test("el link de pago de la pasarela", () => {
    assert.equal(
      mencionaPrecio("*LINK DE PAGO* https://buy.stripe.com/cNi6oG67V6X93Ed7384gl3U"),
      true,
    );
  });

  test("la pasarela local, aunque el texto no diga «pago»", () => {
    assert.equal(mencionaPrecio("https://express.culqi.com/pago/0535001555"), true);
  });

  test("la instrucción de depósito con la cuenta bancaria", () => {
    assert.equal(
      mencionaPrecio(
        "*PAGO DE SU INSCRIPCIÓN LO PUEDE REALIZAR* Mediante depósito a nombre de GOBERNA LATAM",
      ),
      true,
    );
  });

  test("«Cuenta Pesos: 0119760830» — los datos bancarios pelados", () => {
    assert.equal(mencionaPrecio("BANCO BBVA Cuenta Pesos: 0119760830"), true);
  });
});

describe("mencionaPrecio — lo que NO es cotizar", () => {
  test("el saludo de apertura", () => {
    assert.equal(mencionaPrecio("Hola buenas tardes, te saluda Sofía, asesora comercial"), false);
  });

  test("el temario y la logística del curso", () => {
    assert.equal(
      mencionaPrecio("Las clases serán los días lunes, miércoles y viernes por zoom"),
      false,
    );
  });

  test("sin texto no hay precio", () => {
    assert.equal(mencionaPrecio(null), false);
    assert.equal(mencionaPrecio(""), false);
  });
});
