import { test } from "node:test";
import assert from "node:assert/strict";
import {
  familiaDeAnuncio,
  familiaDeTexto,
  normalizarTexto,
  ALIAS_SEMILLA,
  CAMPANAS_CON_VOLUMEN,
} from "./alias.js";

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

test("cada alias DE TEXTO de la semilla se matchea a sí mismo (no hay filas muertas)", () => {
  for (const a of ALIAS_SEMILLA.filter((x) => !x.adId)) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, a.alias)?.familia, a.familia, a.alias);
  }
});

/**
 * ══ EL MAPEO POR ANUNCIO (adId) ═════════════════════════════════════════════
 *
 * Los tres anuncios con más volumen sin mapear —«Adquiérelo ahora» (22
 * personas), «No lo dejes pasar» (17), «FORMA PARTE» (2)— NO nombran ningún
 * curso: ningún alias de texto los puede resolver sin inventar. Lo único que los
 * identifica es su `adId`, que ya viaja en `origen.adId`.
 */
test("un anuncio genérico se resuelve por adId, no por su título", () => {
  const aliases = [
    { alias: "Anuncio «Adquiérelo ahora»", familia: "DIPICOT", nombreCurso: "Inteligencia y Contrainteligencia", adId: "120210000000000001" },
  ];

  // Por texto NO matchea (y no debe: el título no dice nada).
  assert.equal(familiaDeTexto(aliases, "Adquiérelo ahora"), null);
  assert.equal(familiaDeTexto(aliases, "Anuncio «Adquiérelo ahora»"), null);

  const r = familiaDeAnuncio(aliases, { adId: "120210000000000001", titulo: "Adquiérelo ahora" });
  assert.equal(r?.familia, "DIPICOT");
});

test("el adId manda sobre el título: un anuncio mapeado a mano gana", () => {
  const aliases = [
    ...ALIAS_SEMILLA,
    { alias: "Anuncio de prueba", familia: "DIPOSOC", nombreCurso: "OSINT & SOCMINT", adId: "999" },
  ];
  // El título dice «INTELIGENCIA» (→ DIPICOT) pero el anuncio está mapeado a OSINT.
  const r = familiaDeAnuncio(aliases, { adId: "999", titulo: "[JUL] INTELIGENCIA | WSP" });
  assert.equal(r?.familia, "DIPOSOC", "un mapeo humano por adId no lo pisa el texto");
});

test("sin adId mapeado, el anuncio cae en el matcheo por título de siempre", () => {
  const r = familiaDeAnuncio(ALIAS_SEMILLA, { adId: "no-mapeado", titulo: "Inteligencia Estratégica" });
  assert.equal(r?.familia, "DIPICOT");
  assert.equal(familiaDeAnuncio(ALIAS_SEMILLA, { adId: "x", titulo: "Reel spot antiguo" }), null);
});

/**
 * ══ LA RED ANTI-GAP ═════════════════════════════════════════════════════════
 *
 * El pedido del dueño (2026-07-26): «definir bien flyer + campaña a qué cursos
 * van para que no tengamos gaps». `CAMPANAS_CON_VOLUMEN` es la lista MEDIDA
 * contra producción de los textos por los que llega la gente; este test falla si
 * alguno se queda sin familia. Es la única forma de que un gap no vuelva a
 * descubrirse mirando un dashboard tres semanas después.
 */
test("ninguna campaña con volumen queda sin familia", () => {
  const huerfanas = CAMPANAS_CON_VOLUMEN.filter((c) => familiaDeTexto(ALIAS_SEMILLA, c.texto) === null);
  assert.deepEqual(
    huerfanas.map((c) => c.texto),
    [],
    "estas campañas tienen leads y ningún alias las mapea",
  );
});

test("cada campaña con volumen cae en la familia que dice el catálogo de Cerberus", () => {
  for (const c of CAMPANAS_CON_VOLUMEN) {
    assert.equal(familiaDeTexto(ALIAS_SEMILLA, c.texto)?.familia, c.familia, c.texto);
  }
});

test("«Senior» es una familia PROPIA: OpSic Senior no es OpSic", () => {
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "OpSic")?.familia, "DIPOPPS");
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "OpSic Senior")?.familia, "DIPOPPSS");
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Operaciones Psicológicas y Psicosociales Senior")?.familia,
    "DIPOPPSS",
  );
});

test("«Dirección Corporativa de Seguridad» es su propio producto, no el Director de Seguridad", () => {
  assert.equal(
    familiaDeTexto(ALIAS_SEMILLA, "Dirección Corporativa De Seguridad")?.familia,
    "GENCDE6AE",
  );
  assert.equal(familiaDeTexto(ALIAS_SEMILLA, "Director de Seguridad")?.familia, "DIPDIRS");
});
