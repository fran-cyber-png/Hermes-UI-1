import assert from "node:assert/strict";
import test from "node:test";
import {
  nombreEsValido,
  revisar,
  sugerirNombre,
  variablesDe,
  type PlantillaNueva,
} from "./nombrePlantilla.js";

const base: PlantillaNueva = {
  nombre: "promo_agosto",
  idioma: "es_PE",
  categoria: "MARKETING",
  cuerpo: "Hola, tenemos una promo.",
};
const con = (p: Partial<PlantillaNueva>) => revisar({ ...base, ...p });

test("una plantilla bien escrita no tiene reparos", () => {
  assert.deepEqual(revisar(base), []);
});

test("EL NOMBRE SE SUGIERE, NO SE RECHAZA A SECAS", () => {
  // Rechazar por una mayuscula, cuando la correccion es mecanica, es hacerle
  // hacer al humano el trabajo de la maquina.
  assert.equal(sugerirNombre("Promo 3x1 Agosto"), "promo_3x1_agosto");
  assert.equal(sugerirNombre("Inscripción — Diplomado"), "inscripcion_diplomado");
  assert.equal(sugerirNombre("  ¡¡ Foro !!  "), "foro");
});

test("el reparo del nombre TRAE la sugerencia", () => {
  const r = con({ nombre: "Promo Agosto" });
  assert.equal(r.length, 1);
  assert.match(r[0].arreglo, /promo_agosto/);
});

test("las reglas reales del nombre", () => {
  assert.equal(nombreEsValido("promo_3x1"), true);
  assert.equal(nombreEsValido("Promo"), false, "mayúsculas no");
  assert.equal(nombreEsValido("promo-3x1"), false, "guiones no");
  assert.equal(nombreEsValido("promo 3x1"), false, "espacios no");
  assert.equal(nombreEsValido(""), false);
  // 512, no 60 — el largo que casi todos asumen mal.
  assert.equal(nombreEsValido("a".repeat(512)), true);
  assert.equal(nombreEsValido("a".repeat(513)), false);
});

test("🔴 VARIABLE AL PRINCIPIO O AL FINAL: Meta rechaza con 2388299", () => {
  // Se atrapa acá porque el ciclo con Meta es de 24 h.
  assert.match(con({ cuerpo: "{{1}}, tenemos una promo" })[0].problema, /principio o al final/);
  assert.match(con({ cuerpo: "Te esperamos {{1}}" })[0].problema, /principio o al final/);
  assert.deepEqual(con({ cuerpo: "Hola {{1}}, te esperamos" }), []);
});

test("🔴 VARIABLES PEGADAS: Meta rechaza con 2388293", () => {
  const r = con({ cuerpo: "Hola {{1}}{{2}} que tal" });
  assert.match(r[0].problema, /pegadas/);
  assert.match(r[0].arreglo, /Separalas/);
});

test("las variables tienen que ir de 1 en adelante y sin saltos", () => {
  assert.deepEqual(con({ cuerpo: "Hola {{1}} y {{2}} listo" }), []);
  const salto = con({ cuerpo: "Hola {{1}} y {{3}} listo" });
  assert.match(salto[0].problema, /sin saltos/);
  assert.match(salto[0].arreglo, /1, 2/);
});

test("variablesDe extrae los números en orden", () => {
  assert.deepEqual(variablesDe("Hola {{1}}, tu curso {{2}} empieza"), [1, 2]);
  assert.deepEqual(variablesDe("sin variables"), []);
});

test("los largos son los REALES de Meta", () => {
  assert.deepEqual(con({ cuerpo: "a".repeat(1024) }), [], "1024 entra");
  const largo = con({ cuerpo: "a".repeat(1025) });
  assert.match(largo[0].problema, /1025/);
  assert.match(largo[0].arreglo, /Sacá 1/);

  assert.deepEqual(con({ headerTexto: "a".repeat(60) }), []);
  assert.match(con({ headerTexto: "a".repeat(61) })[0].problema, /encabezado/);
  assert.match(con({ pie: "a".repeat(61) })[0].problema, /pie/);
});

test("la categoría tiene que ser una de las TRES de hoy", () => {
  for (const c of ["MARKETING", "UTILITY", "AUTHENTICATION"]) {
    assert.deepEqual(con({ categoria: c }), []);
  }
  // Los valores viejos (pre-2023) del enum de FILTRO no sirven para crear.
  const vieja = con({ categoria: "TRANSACTIONAL" });
  assert.match(vieja[0].problema, /TRANSACTIONAL/);
  assert.match(vieja[0].arreglo, /MARKETING/);
});

test("el reparo del idioma avisa que es una ETIQUETA", () => {
  // Cicatriz real: promo_3x1_cursos está registrada como `en` con el cuerpo en
  // español, y pedirla como `es` da 132001.
  const r = con({ idioma: "" });
  assert.match(r[0].arreglo, /EXACTO/);
});

test("el cuerpo vacío es un reparo, no un crash", () => {
  assert.match(con({ cuerpo: "   " })[0].problema, /vacío/);
});

test("varios problemas salen TODOS, no de a uno", () => {
  // Corregir, mandar, esperar 24 h y descubrir el siguiente es el peor lazo.
  const r = revisar({ nombre: "Mala Idea", idioma: "", categoria: "NADA", cuerpo: "" });
  assert.ok(r.length >= 4, `salieron ${r.length}`);
  assert.deepEqual(
    [...new Set(r.map((x) => x.campo))].sort(),
    ["categoria", "cuerpo", "idioma", "nombre"],
  );
});

test("cada reparo trae un ARREGLO, no sólo el reproche", () => {
  const r = revisar({ nombre: "X X", idioma: "", categoria: "NADA", cuerpo: "{{1}} hola {{2}}{{3}}" });
  for (const x of r) assert.ok(x.arreglo.length > 5, `«${x.problema}» sin arreglo`);
});
