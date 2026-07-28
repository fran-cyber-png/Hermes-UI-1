import test from "node:test";
import assert from "node:assert/strict";
import { exigeCurso, expandirCuerpo, formatearPrecio, saludoDeLaHora } from "./expandir.js";

test("las tres variables se reemplazan", () => {
  const r = expandirCuerpo("Hola {nombre}, el {curso} está en {precio}", {
    nombre: "Ana",
    curso: "Diploma de Inteligencia 26",
    precio: 250,
    moneda: "S/",
  });
  assert.equal(r.texto, "Hola Ana, el Diploma de Inteligencia 26 está en S/250");
  assert.deepEqual(r.faltantes, []);
});

test("sin moneda NO hay precio: hueco, jamás un número suelto", () => {
  const r = expandirCuerpo("La inversión es {precio}", { precio: 250, moneda: "" });
  assert.equal(r.texto, "La inversión es [precio]");
  assert.deepEqual(r.faltantes, ["precio"]);
});

test("un precio 0 (lo que devuelve Cerberus cuando falta) es hueco, no «0»", () => {
  assert.equal(formatearPrecio(0, "S/"), null);
  assert.equal(expandirCuerpo("{precio}", { precio: 0, moneda: "S/" }).texto, "[precio]");
});

test("un precio nulo o ausente es hueco", () => {
  assert.equal(expandirCuerpo("{precio}", {}).texto, "[precio]");
  assert.equal(expandirCuerpo("{precio}", { precio: null, moneda: "S/" }).texto, "[precio]");
});

test("un nombre vacío deja el hueco en vez de un «Hola ,»", () => {
  const r = expandirCuerpo("Hola {nombre}", { nombre: "   " });
  assert.equal(r.texto, "Hola [nombre]");
  assert.deepEqual(r.faltantes, ["nombre"]);
});

test("la misma variable dos veces se reemplaza dos veces y falta una sola vez", () => {
  const r = expandirCuerpo("{nombre}, te repito {nombre}", {});
  assert.equal(r.texto, "[nombre], te repito [nombre]");
  assert.deepEqual(r.faltantes, ["nombre"]);
});

test("las llaves que no son variables quedan intactas", () => {
  const r = expandirCuerpo("Usá {esto} y {nombre}", { nombre: "Ana" });
  assert.equal(r.texto, "Usá {esto} y Ana");
});

test("el formato de moneda respeta cómo se escribe de este lado", () => {
  assert.equal(formatearPrecio(250, "S/"), "S/250");
  assert.equal(formatearPrecio(250, "USD"), "USD 250");
  assert.equal(formatearPrecio(199.5, "S/"), "S/199.50");
  assert.equal(formatearPrecio(250.0, "S/"), "S/250");
});

test("un cuerpo con {curso} o {precio} exige tener un curso atado", () => {
  assert.equal(exigeCurso("Hola {nombre}"), false);
  assert.equal(exigeCurso("El {curso} arranca el lunes"), true);
  assert.equal(exigeCurso("Sale {precio}"), true);
});

test("los emojis del flyer sobreviven la expansión", () => {
  const r = expandirCuerpo("🕵️‍♂️ {curso}\n\nInversión: {precio}", {
    curso: "Diploma de Inteligencia 26",
    precio: 250,
    moneda: "S/",
  });
  assert.equal(r.texto, "🕵️‍♂️ Diploma de Inteligencia 26\n\nInversión: S/250");
});

const conHora = (h: number) => new Date(2026, 6, 27, h, 0, 0);

test("{saludo} cambia con la hora local", () => {
    assert.equal(saludoDeLaHora(conHora(9)), "Buenos días");
    assert.equal(saludoDeLaHora(conHora(15)), "Buenas tardes");
    assert.equal(saludoDeLaHora(conHora(23)), "Buenas noches");
  });

test("{saludo}: los bordes son los de acá: 12 ya es tarde, 19 ya es noche", () => {
    assert.equal(saludoDeLaHora(conHora(11)), "Buenos días");
    assert.equal(saludoDeLaHora(conHora(12)), "Buenas tardes");
    assert.equal(saludoDeLaHora(conHora(18)), "Buenas tardes");
    assert.equal(saludoDeLaHora(conHora(19)), "Buenas noches");
  });

test("{saludo} se expande en el cuerpo y NO entra en faltantes", () => {
    // Es la diferencia con las otras tres: el reloj siempre está, así que un
    // `[saludo]` en un mensaje que sale sería romper algo infalible.
    const r = expandirCuerpo("{saludo},\n\nMi nombre es Walter.", { ahora: conHora(23) });
    assert.equal(r.texto, "Buenas noches,\n\nMi nombre es Walter.");
    assert.deepEqual(r.faltantes, []);
  });

test("{saludo} convive con las que sí pueden faltar", () => {
    const r = expandirCuerpo("{saludo}, el curso sale {precio}", { ahora: conHora(9) });
    assert.match(r.texto, /^Buenos días/);
    assert.match(r.texto, /\[precio\]/);
    assert.deepEqual(r.faltantes, ["precio"]);
  });
