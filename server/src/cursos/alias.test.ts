import { test } from "node:test";
import assert from "node:assert/strict";
import { familiaDeTexto, normalizarTexto, ALIAS_SEMILLA } from "./alias.js";

/**
 * EL MATCHEO DE ALIAS — puro, con los textos REALES que llegan (#102/#129).
 *
 * Los casos no son inventados: `[JUL] INTELIGENCIA | WSP` es el nombre de campaña
 * que el dueño tenía en pantalla el 25-jul-2026, «Diploma técnico en Osint &
 * Socmint» es un `form_name` de la base de leads y «Reel spot antiguo» es un
 * nombre de anuncio que NO nombra ningún curso — el caso que tiene que devolver
 * `null` en vez de inventar.
 */

test("normalizarTexto: tira acentos, mayúsculas y la puntuación de la campaña", () => {
  assert.equal(normalizarTexto("[JUL] INTELIGENCIA | WSP"), "jul inteligencia wsp");
  assert.equal(normalizarTexto("Diploma técnico en Osint & Socmint"), "diploma tecnico en osint socmint");
  assert.equal(normalizarTexto("   IA  y   Marketing   Político  "), "ia y marketing politico");
  assert.equal(normalizarTexto(""), "");
});

test("el prefijo del mes y el sufijo del canal no estorban: [JUL] INTELIGENCIA | WSP → DIPICOT", () => {
  const r = familiaDeTexto(ALIAS_SEMILLA, "[JUL] INTELIGENCIA | WSP");
  assert.equal(r?.familia, "DIPICOT");
  assert.equal(r?.nombreCurso, "Inteligencia y Contrainteligencia");
});

test("«Inteligencia Estratégica» (el título del anuncio) también cae en DIPICOT", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Inteligencia Estratégica")?.familia, "DIPICOT");
});

test("un anuncio que no nombra ningún curso NO se mapea: «Reel spot antiguo» → null", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Reel spot antiguo"), null);
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, ""), null);
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, null), null);
});

test("gana el alias MÁS ESPECÍFICO: «Analista de Inteligencia» no es «Inteligencia»", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "[MAY] ANALISTA DE INTELIGENCIA")?.familia, "DIPTEEI");
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Diploma de Inteligencia Artificial y Marketing Político")?.familia,
    "DIPIAMP",
  );
});

test("el alias matchea por PALABRA entera, no por pedazo de palabra", () => {
  // «contrainteligencia» contiene «inteligencia» como substring: si el matcheo
  // fuera por substring, cualquier familia se pisaría con cualquier otra.
  const aliases = [
    { alias: "inteligencia", familia: "DIPICOT", nombreCurso: "Inteligencia y Contrainteligencia" },
  ];
  assert.equal(familiaDeTexto(aliases, "Contrainteligencia"), null);
  assert.deepEqual(familiaDeTexto(aliases, "quiero inteligencia"), aliases[0]);
});

test("los nombres limpios de los formularios caen en su familia", () => {
  const casos: [string, string][] = [
    ["Diploma técnico en Osint & Socmint", "DIPOSOC"],
    ["[ABR] OSINT Y SOCMINT", "DIPOSOC"],
    ["Diploma Internacional del Consultor Político", "DIPCPOL"],
    ["Curso de Oratoria para Políticos", "EPCOORP"],
    ["Diploma Élite Internacional de Director de Seguridad Corporativo", "DIPDIRS"],
    ["Diploma en Criminología y Ciencias Forenses", "INCOPIE"],
    ["[JUN] CONTRATERRORISMO | WSP", "DIPCOCO"],
    ["Diploma de Asesor Presidencial", "DIPASEPRE"],
    ["Diploma del Director de Comunicaciones", "DIPSTC"],
  ];
  for (const [texto, familia] of casos) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, texto)?.familia, familia, texto);
  }
});

test("la semilla no tiene alias repetidos: un texto no puede mapear a dos familias", () => {
  const vistos = new Map<string, string>();
  for (const a of ALIAS_SEMILLA) {
    const norm = normalizarTexto(a.alias);
    const previo = vistos.get(norm);
    assert.equal(previo, undefined, `alias repetido «${a.alias}» (${previo} vs ${a.familia})`);
    vistos.set(norm, a.familia);
  }
});

test("cada alias de la semilla se matchea a sí mismo (no hay filas muertas)", () => {
  for (const a of ALIAS_SEMILLA) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, a.alias)?.familia, a.familia, a.alias);
  }
});
