import { test } from "node:test";
import assert from "node:assert/strict";
import { ALIAS_SEMILLA } from "./alias.js";
import { derivarInteres } from "./derivar.js";

/**
 * LA PRECEDENCIA del interés derivado — pura, sin base (#102).
 *
 * Lo que se fija acá es la regla que el dueño ya cerró en #72 y que la épica
 * repite: **lo que la vendedora asentó manda sobre lo que se deduce**, y
 * deducir de lo que la persona ELIGIÓ (el formulario) manda sobre deducir de
 * DÓNDE VINO (el anuncio). Y sobre todo: cuando no se puede deducir, no se
 * inventa.
 */

const anuncio = (texto: string) => ({ fuente: "anuncio" as const, texto });
const lead = (texto: string) => ({ fuente: "lead" as const, texto });

test("sin interés registrado, la campaña del anuncio propone el curso", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [anuncio("[JUL] INTELIGENCIA | WSP")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d?.curso, "Inteligencia y Contrainteligencia");
  assert.equal(d?.familia, "DIPICOT");
  assert.equal(d?.fuente, "anuncio");
  assert.equal(d?.textoOrigen, "[JUL] INTELIGENCIA | WSP");
});

test("un interés YA registrado manda: no se propone nada", () => {
  const d = derivarInteres({
    registrados: ["Diploma de Especialización en Inteligencia y Contrainteligencia 14"],
    candidatos: [anuncio("[JUL] INTELIGENCIA | WSP")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d, null);
});

test("el formulario que la persona llenó gana sobre el anuncio por el que entró", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [lead("Diploma técnico en Osint & Socmint"), anuncio("[JUL] INTELIGENCIA | WSP")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d?.familia, "DIPOSOC");
  assert.equal(d?.fuente, "lead");
});

test("si el candidato de más precedencia no mapea, lo intenta el siguiente", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [lead("landing"), anuncio("[JUL] INTELIGENCIA | WSP")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d?.familia, "DIPICOT");
  assert.equal(d?.fuente, "anuncio");
});

test("sin alias que matchee NO se inventa: se devuelve el título crudo, sin familia", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [anuncio("Reel spot antiguo")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d?.curso, null);
  assert.equal(d?.familia, null);
  assert.equal(d?.textoOrigen, "Reel spot antiguo");
});

test("sin candidatos no hay propuesta (una conversación que llegó sola)", () => {
  assert.equal(derivarInteres({ registrados: [], candidatos: [], aliases: ALIAS_SEMILLA }), null);
});

test("un candidato en blanco no cuenta como candidato", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [anuncio("   "), lead("Curso de Oratoria para Políticos")],
    aliases: ALIAS_SEMILLA,
  });
  assert.equal(d?.familia, "EPCOORP");
});

test("sin alias cargados (tabla vacía o sin migrar) no propone nada mapeado", () => {
  const d = derivarInteres({
    registrados: [],
    candidatos: [anuncio("[JUL] INTELIGENCIA | WSP")],
    aliases: [],
  });
  assert.equal(d?.curso, null);
  assert.equal(d?.textoOrigen, "[JUL] INTELIGENCIA | WSP");
});

/**
 * EL ANUNCIO QUE NO DICE NADA (26-jul-2026). «Adquiérelo ahora» (22 personas),
 * «No lo dejes pasar» (17) y «FORMA PARTE» (2) son los tres anuncios con más
 * volumen sin mapear, y ninguno nombra un curso: la única llave es su `adId`.
 */
test("un anuncio genérico mapeado por adId propone el curso igual", () => {
  const aliases = [
    ...ALIAS_SEMILLA,
    {
      alias: "Anuncio «Adquiérelo ahora»",
      familia: "DIPICOT",
      nombreCurso: "Inteligencia y Contrainteligencia",
      adId: "120215551234567",
    },
  ];

  const sinMapeo = derivarInteres({
    registrados: [],
    candidatos: [{ fuente: "anuncio", texto: "Adquiérelo ahora", adId: "otro-id" }],
    aliases,
  });
  assert.equal(sinMapeo?.familia, null, "sin mapeo sigue sin inventarse un curso");

  const conMapeo = derivarInteres({
    registrados: [],
    candidatos: [{ fuente: "anuncio", texto: "Adquiérelo ahora", adId: "120215551234567" }],
    aliases,
  });
  assert.equal(conMapeo?.familia, "DIPICOT");
  assert.equal(conMapeo?.curso, "Inteligencia y Contrainteligencia");
});

test("el formulario sigue mandando sobre el anuncio, aunque el anuncio esté mapeado por adId", () => {
  const aliases = [
    ...ALIAS_SEMILLA,
    { alias: "Anuncio X", familia: "DIPICOT", nombreCurso: "Inteligencia y Contrainteligencia", adId: "77" },
  ];
  const d = derivarInteres({
    registrados: [],
    candidatos: [
      lead("Diploma técnico en Osint & Socmint"),
      { fuente: "anuncio", texto: null, adId: "77" },
    ],
    aliases,
  });
  assert.equal(d?.familia, "DIPOSOC", "lo que la persona eligió gana sobre de dónde vino");
});
