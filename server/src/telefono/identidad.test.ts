import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claveTelefono, mismaIdentidadTelefonica, normalizarE164 } from "./identidad.js";
import { sufijoTelefono } from "../whatsapp/identidadWa.js";

/**
 * LA IDENTIDAD DE UN TELÉFONO, en la mesa.
 *
 * Los casos de acá no son inventados: salen de medir los 448 cruces reales entre
 * `interactions` y `leads` en producción (11-ago-2026) y de los 292 sufijos con
 * más de un número detrás en `leads`.
 */

describe("normalizarE164 — las deformaciones del dato real", () => {
  test("saca el código de país cargado dos veces", () => {
    assert.equal(normalizarE164("5151987654321"), "51987654321");
    assert.equal(normalizarE164("593593987654321"), "593987654321");
  });

  test("saca el cero troncal que se dicta adentro del país", () => {
    assert.equal(normalizarE164("5930987654321"), "593987654321");
  });

  test("NO toca un número legítimo que empieza con su propio código", () => {
    // `51` + `519876543` es un peruano válido de 9 dígitos locales. Sacarle un
    // `51` lo dejaría en 7 dígitos, que no es un largo nacional de Perú, así que
    // la condición «sólo si el resultado parsea» lo protege.
    assert.equal(normalizarE164("51519876543"), "51519876543");
  });

  test("deja en paz lo que ya está bien", () => {
    assert.equal(normalizarE164("51987654321"), "51987654321");
    assert.equal(normalizarE164("+502 1234-5678"), "50212345678");
  });
});

describe("claveTelefono", () => {
  test("parte el E.164 en país y local", () => {
    assert.deepEqual(claveTelefono("51987654321"), { local: "987654321", codigoPais: "51" });
    assert.deepEqual(claveTelefono("50212345678"), { local: "12345678", codigoPais: "502" });
  });

  test("saca el dígito heredado de México y Argentina", () => {
    assert.deepEqual(claveTelefono("5219912345678"), { local: "9912345678", codigoPais: "52" });
    assert.deepEqual(claveTelefono("5491112345678"), { local: "1112345678", codigoPais: "54" });
  });

  test("sin país legible cae al sufijo de 9 y lo DICE (codigoPais null)", () => {
    assert.deepEqual(claveTelefono("987654321"), { local: "987654321", codigoPais: null });
  });

  test("un número demasiado corto no identifica a nadie", () => {
    assert.deepEqual(claveTelefono("1234"), { local: "", codigoPais: null });
    assert.equal(mismaIdentidadTelefonica("1234", "1234"), false);
  });
});

describe("los 14 falsos positivos medidos en producción", () => {
  // Cada par comparte los últimos 9 dígitos y es gente DISTINTA. Con el sufijo
  // de 9 pelado, los 14 matcheaban; el local + la guarda de país los separa.
  const paresDeDistintaGente: ReadonlyArray<readonly [string, string]> = [
    ["51987654321", "56987654321"], // Perú ↔ Chile
    ["51987654321", "593987654321"], // Perú ↔ Ecuador
    // Panamá tiene 8 dígitos locales, así que su sufijo de 9 arranca adentro del
    // código de país (`507` + `12345678` → `712345678`) y choca con el peruano
    // cuyo local es justamente `712345678`. Es el caso que más engaña.
    ["51712345678", "50712345678"], // Perú ↔ Panamá
    ["51987654321", "34987654321"], // Perú ↔ España
    ["51987654321", "595987654321"], // Perú ↔ Paraguay
  ];

  for (const [a, b] of paresDeDistintaGente) {
    test(`${a} y ${b} comparten sufijo y NO son la misma persona`, () => {
      assert.equal(sufijoTelefono(a), sufijoTelefono(b), "premisa: comparten el sufijo de 9");
      assert.equal(mismaIdentidadTelefonica(a, b), false);
    });
  }
});

describe("los 61 aciertos que NO se pueden perder", () => {
  test("E.164 de un lado y local suelto del otro siguen siendo la misma persona", () => {
    // 27 de los 448 cruces reales. Exigir dígitos idénticos los mataría a todos.
    assert.equal(mismaIdentidadTelefonica("51987654321", "987654321"), true);
  });

  test("el código de país cargado dos veces sigue siendo la misma persona", () => {
    // 34 de los 448: `5151…` contra `51…`.
    assert.equal(mismaIdentidadTelefonica("5151987654321", "51987654321"), true);
  });

  test("con y sin el dígito heredado de México", () => {
    assert.equal(mismaIdentidadTelefonica("5219912345678", "529912345678"), true);
  });

  test("el mismo número escrito con adornos", () => {
    assert.equal(mismaIdentidadTelefonica("+51 987 654 321", "51-987-654-321"), true);
  });
});

describe("Guatemala — los «393 clientes invisibles» del CLAUDE.md", () => {
  test("el sufijo de 9 se comía el código de país y producía una llave imposible", () => {
    // Premisa del defecto: el local guatemalteco tiene 8 dígitos, así que los 9
    // finales del E.164 arrancan ADENTRO del código de país.
    assert.equal(sufijoTelefono("50212345678"), "212345678");
    assert.notEqual(sufijoTelefono("50212345678"), "12345678");
  });

  test("con la clave, el E.164 y el local guatemalteco se encuentran", () => {
    assert.equal(claveTelefono("50212345678").local, "12345678");
    assert.equal(mismaIdentidadTelefonica("50212345678", "12345678"), true);
  });
});

describe("la degradación es honesta, nunca más laxa", () => {
  test("dos números sin país legible se comparan por el sufijo de siempre", () => {
    assert.equal(mismaIdentidadTelefonica("987654321", "987654321"), true);
    assert.equal(mismaIdentidadTelefonica("987654321", "987654322"), false);
  });

  test("país nulo de UN lado es comodín, no un no", () => {
    // Es la misma decisión que `clientes_padron.codigo_pais IS NULL`: sabemos
    // menos, no decidimos que no.
    const conPais = claveTelefono("51987654321");
    const sinPais = claveTelefono("987654321");
    assert.equal(conPais.codigoPais, "51");
    assert.equal(sinPais.codigoPais, null);
    assert.equal(mismaIdentidadTelefonica("51987654321", "987654321"), true);
  });
});
