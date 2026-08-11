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
  const prompt = armarSystemPrompt({ hechos: [...PERFIL_CAMPANA_BETTO.hechos], piezas: [], lecciones: [] }, PERFIL_CAMPANA_BETTO);

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

  test("habla en primera persona, como el candidato (decisión del dueño)", () => {
    assert.match(prompt, /Eres Betto Barrionuevo Romero/);
    assert.match(prompt, /Escribes en primera persona/);
  });

  test("dice a qué postula y a qué elección", () => {
    assert.match(prompt, /Gobernador Regional/);
    assert.match(prompt, /Áncash/);
    assert.match(prompt, /PODEMOS PERÚ/);
    assert.match(prompt, /4 de octubre de 2026/);
  });

  test("el primer contacto saluda y agradece antes de preguntar", () => {
    assert.match(prompt, /soy Betto Barrionuevo\. Gracias por escribirme/);
    assert.match(prompt, /pregunta su NOMBRE/);
  });

  test("🔴 le prohíbe prometer, y eso incluye plata y gestiones", () => {
    // Acá el daño de una frase de más no es una venta perdida: es un compromiso
    // público que alguien va a reclamar, y va firmado con su nombre.
    assert.match(prompt, /NUNCA prometas NADA/);
    assert.match(prompt, /NUNCA pidas ni ofrezcas dinero/);
  });

  test("🔴 no afirma ser humano si le preguntan — escala", () => {
    // Hablar en su voz es una cosa; jurar que del otro lado hay una persona es
    // la que se convierte en la nota de prensa.
    assert.match(prompt, /NUNCA\s+afirmes ser una persona/);
    assert.match(prompt, /pregunto_si_es_bot/);
  });

  test("🔴 no inventa propuestas ni plan de gobierno", () => {
    assert.match(prompt, /NUNCA inventes propuestas, planes de gobierno/);
    assert.match(prompt, /preferible quedar corto que afirmar algo falso/);
  });

  test("no opina de otros candidatos ni responde ataques", () => {
    assert.match(prompt, /NUNCA opines sobre otros candidatos/);
  });

  test("los datos afirmables son SOLO su biografía pública, sin propuestas", () => {
    const textos = PERFIL_CAMPANA_BETTO.hechos.map((h) => h.texto).join(" ");
    assert.match(textos, /Gobernador Regional de Áncash/);
    assert.match(textos, /contador público/);
    for (const prohibido of ["propongo", "haré", "vamos a construir", "prometo"]) {
      assert.ok(!textos.includes(prohibido), `un dato afirmable no puede decir «${prohibido}»`);
    }
  });
});

describe("el guardrail sigue al perfil, no a la Escuela", () => {
  test("presentarse como Betto es CORRECTO en su propia línea", () => {
    const v = evaluarReglas("Hola, soy Betto Barrionuevo. Gracias por escribirme.", PERFIL_CAMPANA_BETTO);
    assert.equal(v.filter((x) => x.regla === "identidad").length, 0);
  });

  test("🔴 pero presentarse con OTRO nombre se sigue marcando", () => {
    const v = evaluarReglas("Hola, soy Juan Pérez del comando.", PERFIL_CAMPANA_BETTO);
    assert.ok(v.some((x) => x.regla === "identidad"), "tenía que marcar identidad");
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
