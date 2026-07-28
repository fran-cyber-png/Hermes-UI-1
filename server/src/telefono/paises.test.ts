import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { partirE164, variantesLocales, mismoTelefono } from "./paises.js";

/**
 * QUÉ PARTE DE UN TELÉFONO IDENTIFICA A LA PERSONA.
 *
 * El caso que obliga a que este módulo exista es el **imposible**, no el
 * improbable: con local de 8 dígitos (Guatemala, Bolivia, Panamá…), los últimos
 * 9 del E.164 arrancan adentro del código de país, y ninguna comparación contra
 * un padrón que guarda el número local puede dar verdadero. La cola ya lo tenía
 * resuelto desde #119; la búsqueda contra Cerberus no, y por eso la fila decía
 * «Cliente» y el panel no encontraba ni una compra.
 *
 * El otro eje es la contracara: ensanchar la búsqueda sin una verificación
 * estricta cambia el falso negativo de hoy por un falso positivo mañana.
 */

describe("partirE164 — el código de país sale del número, no de una suposición", () => {
  test("Perú: 51 + 9", () => {
    assert.deepEqual(partirE164("51986394450")?.codigoPais, "51");
    assert.equal(partirE164("51986394450")?.local, "986394450");
  });

  test("Guatemala: 502 + 8 — el código largo le gana a `5`", () => {
    const p = partirE164("50212345678");
    assert.equal(p?.codigoPais, "502");
    assert.equal(p?.local, "12345678");
  });

  test("México con el `1` heredado: 52 + 11", () => {
    assert.equal(partirE164("5215512345678")?.codigoPais, "52");
    assert.equal(partirE164("5215512345678")?.local, "15512345678");
  });

  test("lo que no cierra con ningún país es `null`, no una partición inventada", () => {
    assert.equal(partirE164("123"), null);
    assert.equal(partirE164("99999999999999999"), null);
  });
});

describe("variantesLocales — con qué se le pregunta a Cerberus", () => {
  test("EL CASO IMPOSIBLE: Guatemala pregunta por los 8 locales, no por 9", () => {
    const v = variantesLocales("50212345678");
    assert.equal(v[0], "12345678", "la primera forma tiene que ser el local");
    // Y el sufijo de 9 —lo único que se preguntaba antes— es una cadena que NO
    // puede estar adentro de un `numero` de 8 dígitos. Ese era el bug entero.
    assert.equal("50212345678".slice(-9), "212345678");
    assert.ok(!"12345678".includes("212345678"));
  });

  test("Bolivia y Panamá, el mismo largo local de 8", () => {
    assert.equal(variantesLocales("59171234567")[0], "71234567");
    assert.equal(variantesLocales("50761234567")[0], "61234567");
  });

  test("México: primero SIN el `1` heredado, que es como Cerberus lo guarda", () => {
    const v = variantesLocales("5215512345678");
    assert.equal(v[0], "5512345678");
    assert.ok(v.includes("15512345678"), "la forma con el heredado también se prueba");
  });

  test("SIN REGRESIÓN: el sufijo de 9 siempre está, y para Perú es lo primero", () => {
    const peru = variantesLocales("51986394450");
    assert.equal(peru[0], "986394450");
    for (const e164 of ["51986394450", "50212345678", "5215512345678", "573001234567"]) {
      assert.ok(
        variantesLocales(e164).includes(e164.slice(-9)),
        `${e164} tiene que conservar el respaldo de siempre`,
      );
    }
  });

  test("un número que no se deja leer cae al sufijo de 9 y nada más", () => {
    assert.deepEqual(variantesLocales("99999999999999999"), ["999999999"]);
    assert.deepEqual(variantesLocales("123"), []);
  });
});

describe("mismoTelefono — la verificación estricta", () => {
  test("EL FALSO POSITIVO DE #119: mismo sufijo de 9, países distintos", () => {
    const mexicano = "529912345678"; // +52 991 234 5678
    const peruano = "51912345678"; //  +51 912 345 678
    assert.equal(mexicano.slice(-9), peruano.slice(-9), "comparten sufijo, ese es el punto");
    assert.equal(mismoTelefono(mexicano, peruano), false);
  });

  test("el mismo número escrito de las cuatro formas de Cerberus", () => {
    const conversacion = "51986394450";
    for (const guardado of ["986394450", "+51 986 394 450", "51986394450", "51-986-394-450"]) {
      assert.equal(mismoTelefono(guardado, conversacion), true, guardado);
    }
  });

  test("México: con y sin el `1` heredado es la misma persona", () => {
    assert.equal(mismoTelefono("5215512345678", "525512345678"), true);
    assert.equal(mismoTelefono("5512345678", "5215512345678"), true);
  });

  test("Guatemala: el local de 8 cierra contra su E.164", () => {
    assert.equal(mismoTelefono("12345678", "50212345678"), true);
  });

  test("no dice que sí por default: dos números distintos son distintos", () => {
    assert.equal(mismoTelefono("51986394450", "51986394451"), false);
    assert.equal(mismoTelefono("", "51986394450"), false);
    assert.equal(mismoTelefono(null, "51986394450"), false);
    assert.equal(mismoTelefono("12345", "51912345"), false);
  });
});
