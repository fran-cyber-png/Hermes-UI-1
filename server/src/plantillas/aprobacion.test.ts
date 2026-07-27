import test from "node:test";
import assert from "node:assert/strict";
import { decidirAprobacion, type PlantillaAprobable } from "./aprobacion.js";

/**
 * LA DECISIÓN DE APROBAR, PURA. Lo que se fija acá es la regla que faltaba: una
 * propuesta no se aprueba sin resolver a qué curso corresponde, porque sin eso
 * queda aprobada y sin matchear nunca con nadie — que es exactamente el estado
 * en el que estaban las dos propuestas de producción.
 */

const propuesta = (extra: Partial<PlantillaAprobable> = {}): PlantillaAprobable => ({
  estado: "propuesta",
  familiaCurso: null,
  pasos: [{ texto: "Te comparto la información del diploma" }],
  ...extra,
});

test("con la familia que infirió el minado, confirmar alcanza", () => {
  const d = decidirAprobacion(propuesta({ familiaCurso: "DIPICOT" }));
  assert.deepEqual(d, { ok: true, familiaCurso: "DIPICOT" });
});

test("quien revisa puede CAMBIAR la familia inferida", () => {
  const d = decidirAprobacion(propuesta({ familiaCurso: "DIPICOT" }), { familiaCurso: "DIPOSOC" });
  assert.deepEqual(d, { ok: true, familiaCurso: "DIPOSOC" });
});

test("sin familia y sin decir nada NO se aprueba: el silencio es el bug", () => {
  const d = decidirAprobacion(propuesta());
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.motivo, "falta_familia");
});

test("«sirve para cualquier curso» es una decisión, y alcanza", () => {
  const d = decidirAprobacion(propuesta(), { familiaCurso: null });
  assert.deepEqual(d, { ok: true, familiaCurso: null });
});

test("«cualquier curso» NO alcanza si el texto usa {curso} o {precio}", () => {
  const conVariables = propuesta({ pasos: [{ texto: "El {curso} está en {precio}" }] });
  const d = decidirAprobacion(conVariables, { familiaCurso: null });
  assert.equal(d.ok, false);
  assert.equal(d.ok === false && d.motivo, "falta_familia");
  assert.match(d.ok === false ? d.mensaje : "", /\{curso\}/);
});

test("una que ya estaba aprobada no se vuelve a aprobar", () => {
  const d = decidirAprobacion(propuesta({ estado: "aprobada", familiaCurso: "DIPICOT" }));
  assert.equal(d.ok === false && d.motivo, "ya_aprobada");
});

test("una secuencia sin pasos no es un mensaje", () => {
  const d = decidirAprobacion(propuesta({ familiaCurso: "DIPICOT", pasos: [] }));
  assert.equal(d.ok === false && d.motivo, "sin_pasos");
});

/**
 * Aprobar es decir «el texto está bien». La imagen se carga después, y quien
 * frena el envío de un paso incompleto es la ruta (guarda 2), no esto.
 */
test("un paso con la imagen pendiente SE PUEDE aprobar: lo que no se puede es mandarlo", () => {
  const sinImagen = propuesta({ familiaCurso: "DIPICOT", pasos: [{ texto: null }] });
  assert.equal(decidirAprobacion(sinImagen).ok, true);
});

test("una familia en blanco se trata como «sin familia», no como una familia rara", () => {
  const d = decidirAprobacion(propuesta({ familiaCurso: "  " }));
  assert.equal(d.ok, false);
});
