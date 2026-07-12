import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { normalizarEmail, normalizarTelefono, type Pais } from "./normalizar.js";

/**
 * Los casos salen de leer 150 textos REALES de nuestra base (RG-006), no de ejemplos inventados.
 * Ahí descubrimos que 97 de cada 100 "teléfonos" son teléfonos de verdad — pero que el regex
 * ingenuo (`[0-9]{8,}`) acertaba de casualidad, porque el contexto es gente respondiendo a
 * "déjanos tu número". Estos tests existen para que acierte por la razón correcta.
 *
 * Meta exige E.164 CON código de país y SIN el '+' antes de hashear:
 *   "quitar símbolos, letras y ceros iniciales; incluir código de país"
 *   (developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information)
 */

describe("normalizarTelefono", () => {
  test("Perú: 9 dígitos empezando en 9", () => {
    assert.equal(normalizarTelefono("987654321", "PE"), "51987654321");
    assert.equal(normalizarTelefono("+51 987 654 321", "PE"), "51987654321");
    assert.equal(normalizarTelefono("(51) 987-654-321", "PE"), "51987654321");
    // Ya viene con código de país pero sin '+': no se lo duplicamos.
    assert.equal(normalizarTelefono("51987654321", "PE"), "51987654321");
  });

  test("México: 10 dígitos", () => {
    assert.equal(normalizarTelefono("5512345678", "MX"), "525512345678");
    assert.equal(normalizarTelefono("+52 55 1234 5678", "MX"), "525512345678");
  });

  test("Bolivia: 8 dígitos empezando en 6 o 7", () => {
    assert.equal(normalizarTelefono("71234567", "BO"), "59171234567");
    assert.equal(normalizarTelefono("+591 71234567", "BO"), "59171234567");
  });

  test("Colombia: 10 dígitos, móvil empieza en 3", () => {
    assert.equal(normalizarTelefono("3101234567", "CO"), "573101234567");
  });

  test("Chile: 9 dígitos empezando en 9", () => {
    assert.equal(normalizarTelefono("912345678", "CL"), "56912345678");
  });

  test("Ecuador: el 0 inicial es de marcación nacional y se descarta", () => {
    // 09XXXXXXXX marcado localmente == +593 9XXXXXXXX en E.164
    assert.equal(normalizarTelefono("0987654321", "EC"), "593987654321");
    assert.equal(normalizarTelefono("+593987654321", "EC"), "593987654321");
  });

  test("Guatemala: 8 dígitos — el caso real '(502) XXXXXXXX'", () => {
    assert.equal(normalizarTelefono("(502) 51234567", "GT"), "50251234567");
    assert.equal(normalizarTelefono("51234567", "GT"), "50251234567");
  });

  test("el código de país explícito gana sobre el país por defecto", () => {
    // Un peruano dejando un número mexicano en un formulario marcado como Perú.
    assert.equal(normalizarTelefono("+52 5512345678", "PE"), "525512345678");
  });

  test("rechaza la basura real que encontramos en los textos", () => {
    // Los 3 casos malos de la muestra de 100 (RG-006), tal cual aparecen en la base.
    assert.equal(normalizarTelefono("0084581911", "PE"), null); // no calza con ningún plan
    assert.equal(normalizarTelefono("099056777", "EC"), null); // a Ecuador le falta un dígito
    assert.equal(normalizarTelefono("0059177197052", "BO"), null); // dos números pegados
  });

  test("rechaza lo que NO es un teléfono aunque tenga 8+ dígitos", () => {
    assert.equal(normalizarTelefono("12345678", "PE"), null); // DNI peruano: 8 dígitos
    assert.equal(normalizarTelefono("2026", "PE"), null); // un año
    assert.equal(normalizarTelefono("", "PE"), null);
    assert.equal(normalizarTelefono("   ", "PE"), null);
  });

  test("sin país no adivina: si el número no trae código, no se acepta", () => {
    // Preferimos perder un match a fusionar dos personas distintas (identidad DÉBIL).
    assert.equal(normalizarTelefono("987654321", null), null);
    // Pero si trae el código de país, no hace falta saber de dónde es.
    assert.equal(normalizarTelefono("+51987654321", null), "51987654321");
  });

  test("es idempotente: normalizar dos veces da lo mismo", () => {
    const una = normalizarTelefono("+51 987 654 321", "PE");
    assert.equal(normalizarTelefono(una!, "PE"), una);
  });
});

describe("normalizarEmail", () => {
  test("minúsculas y trim, como exige Meta", () => {
    assert.equal(normalizarEmail("  Juan.Perez@GMAIL.com  "), "juan.perez@gmail.com");
  });

  test("acepta los dominios reales que vimos en la base", () => {
    assert.equal(
      normalizarEmail("alguien@vicepresidencia.gob.bo"),
      "alguien@vicepresidencia.gob.bo",
    );
  });

  test("rechaza lo que no es un correo", () => {
    assert.equal(normalizarEmail("no-es-un-correo"), null);
    assert.equal(normalizarEmail("falta@dominio"), null);
    assert.equal(normalizarEmail("@sinusuario.com"), null);
    assert.equal(normalizarEmail(""), null);
    assert.equal(normalizarEmail("   "), null);
  });

  test("NO corrige typos de dominio — eso es una inferencia, no un hecho", () => {
    // Caso real de la base: 'gimei.com' probablemente quiso decir 'gmail.com'.
    // Lo guardamos tal cual. Corregirlo sería inventar un dato que la persona no escribió.
    assert.equal(normalizarEmail("fredy@gimei.com"), "fredy@gimei.com");
  });

  test("es idempotente", () => {
    const uno = normalizarEmail("  Juan@Gmail.COM ");
    assert.equal(normalizarEmail(uno!), uno);
  });
});
