import assert from "node:assert/strict";
import test from "node:test";
import { porQueFallo } from "./porQueFallo.js";

/** Un error de drizzle+postgres.js, con la forma exacta que llega en producción. */
function errorDeConsulta(causa: string): Error {
  const e = new Error(
    "Failed query: \n      UPDATE envios_wa\n         SET estado_entrega = $1,\n" +
      "             estado_entrega_en = $2\n       WHERE id_externo IN ($3)\nparams: leido,...",
  );
  (e as Error & { cause: unknown }).cause = new Error(causa);
  return e;
}

test("🔴 dice la CAUSA primero — que es lo que `err.message` esconde", () => {
  const linea = porQueFallo(errorDeConsulta('relation "envios_wa" does not exist'));

  assert.ok(
    linea.startsWith('relation "envios_wa" does not exist'),
    `arranca por la causa, no por el SQL: ${linea}`,
  );
  assert.match(linea, /consulta: UPDATE envios_wa/, "y el SQL queda, recortado, después");
});

test("una sola línea: journald intercala los logs de varias", () => {
  const linea = porQueFallo(errorDeConsulta("connection terminated"));
  assert.equal(linea.includes("\n"), false);
});

test("sin causa anidada, el mensaje propio YA es la explicación", () => {
  assert.equal(porQueFallo(new Error("falta META_ACCESS_TOKEN")), "falta META_ACCESS_TOKEN");
});

test("lo que no es un Error no rompe el catch que lo está logueando", () => {
  assert.equal(porQueFallo("se cayó"), "se cayó");
  assert.equal(porQueFallo(null), "null");
  assert.equal(porQueFallo(undefined), "undefined");
});

test("recorta: un SQL de cien líneas no puede tapar el log", () => {
  const linea = porQueFallo(errorDeConsulta("x".repeat(500)));
  assert.ok(linea.length < 420, `quedó en ${linea.length}`);
  assert.ok(linea.includes("…"), "y avisa que recortó");
});
