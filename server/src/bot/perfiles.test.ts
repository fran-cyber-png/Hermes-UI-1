import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { perfilDeLinea, PERFIL_ESCUELA, PERFIL_CAMPANA_BETTO } from "./perfiles.js";
import { armarSystemPrompt } from "./prompt.js";
import { evaluarReglas } from "./reglas.js";

const LINEA_CAMPANA = "51963139984";
const LINEA_ESCUELA = "51986394450";

const vacio = { hechos: [], piezas: [], lecciones: [] };

describe("a qué línea le toca qué perfil", () => {
  test("una línea desconocida cae en la Escuela — lo de antes sigue igual", () => {
    // Es la propiedad que permitió tocar esto sin auditar las cuatro líneas que
    // hoy corren: sin entrada en el mapa, nada cambia.
    assert.equal(perfilDeLinea(LINEA_ESCUELA).clave, "escuela");
    assert.equal(perfilDeLinea(undefined).clave, "escuela");
    assert.equal(perfilDeLinea("").clave, "escuela");
    assert.equal(perfilDeLinea("51999999999").clave, "escuela");
  });

  test("la línea de campaña tiene el suyo", () => {
    assert.equal(perfilDeLinea(LINEA_CAMPANA).clave, "campana-betto");
    assert.equal(perfilDeLinea(` ${LINEA_CAMPANA} `).clave, "campana-betto");
  });
});

describe("el prompt de campaña no puede sonar a la Escuela", () => {
  const prompt = armarSystemPrompt(vacio, PERFIL_CAMPANA_BETTO);

  test("🔴 no nombra a la asesora ni el negocio de la Escuela", () => {
    // El defecto que este archivo existe para tapar: con el prompt fijo, prender
    // el bot en esta línea ponía a Sofía a ofrecer diplomados a los vecinos.
    for (const prohibido of ["Sofía", "asesora comercial", "diplomado", "Escuela de Goberna", "DIPICOT"]) {
      assert.ok(
        !prompt.includes(prohibido),
        `el prompt de campaña no puede decir «${prohibido}»`,
      );
    }
  });

  test("dice de quién es la línea y a qué elección", () => {
    assert.match(prompt, /Betto Barrionuevo/);
    assert.match(prompt, /Gobernador Regional/);
    assert.match(prompt, /Áncash/);
    assert.match(prompt, /PODEMOS PERÚ/);
    assert.match(prompt, /4 de octubre de 2026/);
  });

  test("🔴 le prohíbe hablar como el candidato — es una persona real", () => {
    // Cada frase en primera persona sería una declaración suya, citable.
    assert.match(prompt, /NO eres Betto/);
    assert.match(prompt, /NUNCA hables en primera persona como Betto/);
  });

  test("🔴 le prohíbe prometer, y eso incluye plata y gestiones", () => {
    assert.match(prompt, /NUNCA prometas NADA/);
    assert.match(prompt, /NUNCA pidas ni ofrezcas dinero/);
  });

  test("no opina de otros candidatos ni responde ataques", () => {
    assert.match(prompt, /NUNCA opines sobre otros candidatos/);
  });

  test("sin datos afirmables, el prompt DICE que escala — no improvisa", () => {
    assert.equal(PERFIL_CAMPANA_BETTO.hechos.length, 0);
    assert.match(prompt, /No hay datos afirmables configurados todavía/);
  });
});

describe("el guardrail sigue al perfil, no a la Escuela", () => {
  test("🔴 «soy Betto» es una violación de identidad en su propia línea", () => {
    const v = evaluarReglas("Hola, soy Betto y le agradezco su mensaje.", PERFIL_CAMPANA_BETTO);
    assert.ok(v.some((x) => x.regla === "identidad"), "tenía que marcar identidad");
  });

  test("presentarse como el equipo NO se marca", () => {
    const v = evaluarReglas(
      "Hola, le saluda el equipo de campaña de Betto Barrionuevo. ¿Cuál es su nombre?",
      PERFIL_CAMPANA_BETTO,
    );
    assert.equal(v.filter((x) => x.regla === "identidad").length, 0);
  });

  test("🔴 en campaña NO hay sedes: nombrar una es inventarla", () => {
    // Con las sedes de la Escuela clavadas, «nuestra sede en Lima» pasaba acá —
    // el guardrail habría aprobado una oficina que no existe.
    const v = evaluarReglas("Nuestra sede en Lima lo puede atender.", PERFIL_CAMPANA_BETTO);
    assert.ok(v.some((x) => x.regla === "sede_inexistente"));
  });

  test("y en la Escuela sigue siendo verdad lo de siempre", () => {
    assert.equal(evaluarReglas("Nuestra sede en Lima lo puede atender.", PERFIL_ESCUELA).length, 0);
    assert.ok(
      evaluarReglas("Nuestra sede en Panamá lo puede atender.", PERFIL_ESCUELA)
        .some((x) => x.regla === "sede_inexistente"),
    );
  });

  test("sin perfil, el guardrail juzga con el de la Escuela (el default de antes)", () => {
    assert.equal(evaluarReglas("Nuestra sede en Lima lo puede atender.").length, 0);
  });
});
