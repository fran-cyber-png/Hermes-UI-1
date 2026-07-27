import { test } from "node:test";
import assert from "node:assert/strict";
import { cursoDeConversacion } from "./precedencia.js";

/**
 * LA PRECEDENCIA, PURA — la regla que el Dashboard no estaba aplicando (#128).
 *
 * El caso que originó todo: 68 de 70 conversaciones «sin curso identificado» en
 * el Dashboard mientras la cola les pintaba el chip. La diferencia era una sola:
 * el Dashboard miraba solo el formulario y se perdía el anuncio.
 */

const anuncio = (titulo: string | null, adId: string | null = null) => ({
  fuente: "anuncio",
  titulo,
  adId,
});

test("el interés registrado manda sobre todo lo demás", () => {
  const r = cursoDeConversacion({
    interesCurso: "Diploma de OSINT",
    leadCurso: "Inteligencia Estratégica",
    anuncio: anuncio("[JUL] INTELIGENCIA | WSP"),
  });
  assert.deepEqual(r, { crudo: "Diploma de OSINT", fuente: "interes", adId: null });
});

test("sin interés, el formulario que llenó gana sobre el anuncio", () => {
  const r = cursoDeConversacion({
    leadCurso: "Ciberinteligencia y Ciberdefensa",
    anuncio: anuncio("[JUL] INTELIGENCIA | WSP"),
  });
  assert.equal(r?.fuente, "lead");
  assert.equal(r?.crudo, "Ciberinteligencia y Ciberdefensa");
});

test("EL CASO DEL BUG: sin lead ni interés, el anuncio identifica el curso", () => {
  const r = cursoDeConversacion({ anuncio: anuncio("[JUL] INTELIGENCIA | WSP") });
  assert.deepEqual(r, { crudo: "[JUL] INTELIGENCIA | WSP", fuente: "anuncio", adId: null });
});

test("un anuncio sin título pero con adId sigue siendo candidato", () => {
  const r = cursoDeConversacion({ anuncio: anuncio(null, "120215551234567") });
  assert.deepEqual(r, { crudo: "", fuente: "anuncio", adId: "120215551234567" });
});

test("un origen que no es anuncio (una landing) no nombra ningún curso", () => {
  assert.equal(cursoDeConversacion({ anuncio: { fuente: "landing", titulo: "goberna.us" } }), null);
});

test("sin ninguna de las tres fuentes no se infiere: el «sin atribuir» es honesto", () => {
  assert.equal(cursoDeConversacion({}), null);
  assert.equal(cursoDeConversacion({ interesCurso: "  ", leadCurso: "", anuncio: null }), null);
});
