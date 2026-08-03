import { describe, it } from "node:test";
import assert from "node:assert";
import { evaluarReglas, contarViolaciones, type ClaveRegla } from "./reglas.js";

const reglasDe = (t: string | null): ClaveRegla[] => evaluarReglas(t).map((v) => v.regla);

/**
 * Los textos son LITERALES del corpus de producción (3-ago-2026) siempre que se
 * puede. Un test de reglas escrito con ejemplos inventados mide la imaginación
 * de quien lo escribió; escrito con lo que el bot dijo de verdad, mide el bot.
 */
describe("evaluarReglas — lo que el bot dijo de verdad y rompía una regla", () => {
  it("regla 0b · preguntó el país (9 veces en producción)", () => {
    assert.deepEqual(
      reglasDe("Tienes razón, disculpa la confusión. ¿De qué país eres tú? Así me aseguro de darte la información correcta"),
      ["pregunta_pais"],
    );
  });

  it("regla 2 · inventó una sede que no existe", () => {
    // El caso real: CONTEXTO_NEGOCIO lista Miami, CDMX, Lima, Guayaquil, Santa
    // Cruz y Río. Panamá no está — y encima le mintió sobre desde dónde escribe.
    assert.ok(
      reglasDe("Te escribo desde Panamá, que es donde está tu número de teléfono. Nuestra sede en la región es en Panamá.").includes("sede_inexistente"),
    );
  });

  it("identidad · se presentó como otra asesora (39 veces en producción)", () => {
    assert.deepEqual(
      reglasDe("Hola, soy Kathy Alva, asesora académica de Goberna. ¿Cuál es tu nombre?"),
      ["identidad"],
    );
  });

  it("regla 6b · anunció que otra persona lo contactaría (3 veces)", () => {
    assert.ok(reglasDe("En un momento una asesora se comunica contigo.").includes("anuncia_otra_persona"));
    assert.ok(reglasDe("Nuestro equipo te escribe en breve.").includes("anuncia_otra_persona"));
  });

  it("regla 1 · escribió una cifra de precio en el texto", () => {
    assert.ok(reglasDe("El precio regular es $199 USD y hoy está en promoción.").includes("cifra_de_precio"));
    assert.ok(reglasDe("En Perú son S/ 500.").includes("cifra_de_precio"));
  });

  it("regla 3 · dijo ser un bot", () => {
    assert.ok(reglasDe("Soy un asistente virtual de Goberna.").includes("dice_ser_bot"));
    assert.ok(reglasDe("Este es un mensaje automático.").includes("dice_ser_bot"));
  });
});

/**
 * ══ EL FALSO POSITIVO ES EL ENEMIGO ══════════════════════════════════════════
 *
 * Una regla que marca de más se desactiva sola: nadie le cree a un tablero que
 * grita. Todos estos textos son CORRECTOS —varios son literalmente lo que el
 * prompt PIDE— y ninguno puede marcarse.
 */
describe("evaluarReglas — lo correcto NO se marca", () => {
  it("la presentación correcta no dispara identidad", () => {
    assert.deepEqual(
      reglasDe("Hola, te saluda Sofía Rodríguez, asesora comercial de Goberna. Antes de todo, ¿cuál es tu nombre?"),
      [],
    );
  });

  it("«soy Sofía» a secas tampoco", () => {
    assert.deepEqual(reglasDe("Hola, soy Sofía, asesora comercial."), []);
  });

  it("nombrar a un docente NO es adoptar su identidad", () => {
    // La regla mira dónde el bot SE PRESENTA. Este texto nombra a otra persona
    // en el cuerpo, que es correcto y frecuentísimo.
    assert.deepEqual(reglasDe("Enseñan cinco especialistas, entre ellos Roberth Bazan."), []);
  });

  it("«dame un minuto y te confirmo» es lo que la regla 6b PIDE, no lo que prohíbe", () => {
    assert.deepEqual(reglasDe("Dame un minuto y te confirmo el dato."), []);
    assert.deepEqual(reglasDe("Déjame revisarlo y te digo."), []);
  });

  it("un número que no es plata no es una cifra de precio", () => {
    // El falso positivo más fácil de cometer: el catálogo está lleno de números.
    assert.deepEqual(reglasDe("El diploma dura 3 semanas: son 8 sesiones del 10 al 31 de agosto."), []);
    assert.deepEqual(reglasDe("El certificado acredita 120 horas académicas."), []);
    assert.deepEqual(reglasDe("Se puede pagar en 2 cuotas."), []);
  });

  it("dar una sede REAL no se marca", () => {
    assert.deepEqual(reglasDe("Nuestra sede en Perú está en Lima, Av. Manuel Olguín 335."), []);
    assert.deepEqual(reglasDe("Tenemos sede en Miami."), []);
  });

  it("hablar del país sin PREGUNTARLO no se marca", () => {
    assert.deepEqual(reglasDe("El diplomado se cursa desde cualquier país, es 100% virtual."), []);
    assert.deepEqual(reglasDe("Los precios se manejan en la moneda de tu país."), []);
  });

  it("un texto vacío o nulo no rompe nada", () => {
    assert.deepEqual(reglasDe(null), []);
    assert.deepEqual(reglasDe("   "), []);
  });
});

describe("contarViolaciones", () => {
  it("cuenta por regla, sobre varias respuestas", () => {
    const cuenta = contarViolaciones([
      "Hola, soy Kathy Alva, asesora académica.",
      "¿De qué país eres tú?",
      "Hola, te saluda Sofía Rodríguez.",
      null,
    ]);
    assert.equal(cuenta.identidad, 1);
    assert.equal(cuenta.pregunta_pais, 1);
    assert.equal(cuenta.cifra_de_precio, 0);
  });

  it("un conjunto limpio da todo en cero", () => {
    const cuenta = contarViolaciones(["Hola, te saluda Sofía Rodríguez.", "Claro, te cuento."]);
    assert.equal(Object.values(cuenta).reduce((a, b) => a + b, 0), 0);
  });
});
